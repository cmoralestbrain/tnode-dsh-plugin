export function mapHealth(payload) {
    const number = (value) => (typeof value === "number" ? value : undefined);
    const ctxRaw = payload.ctx && typeof payload.ctx === "object" ? payload.ctx : undefined;
    return {
        cpu: number(payload.cpu) ?? 0,
        ram: number(payload.ram) ?? 0,
        disk: number(payload.disk) ?? 0,
        ramUsedMb: number(payload.ramUsedMb),
        ramTotalMb: number(payload.ramTotalMb),
        diskUsedGb: number(payload.diskUsedGb),
        diskTotalGb: number(payload.diskTotalGb),
        cpuCores: number(payload.cpuCores),
        uptimeSec: number(payload.uptimeSec),
        loadAvg1m: number(payload.loadAvg1m),
        ctx: ctxRaw
            ? {
                used: number(ctxRaw.used),
                max: number(ctxRaw.max),
                pct: number(ctxRaw.pct),
                fresh: typeof ctxRaw.fresh === "boolean" ? ctxRaw.fresh : undefined,
                model: typeof ctxRaw.model === "string" ? ctxRaw.model : undefined,
            }
            : undefined,
    };
}
export function formatPercent(value) {
    if (value === undefined || Number.isNaN(value))
        return "—";
    const pct = value <= 1 ? value * 100 : value;
    return `${Math.round(pct)}%`;
}
export function formatUptime(seconds) {
    if (!seconds || seconds <= 0)
        return "—";
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0)
        return `${days}d ${hours}h`;
    if (hours > 0)
        return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}
/** Conecta al gateway y espera el snapshot del stream `health`. */
export function fetchHealth(host, token, timeoutMs = 8000) {
    const WebSocketCtor = globalThis.WebSocket;
    if (!WebSocketCtor) {
        return Promise.resolve({ ok: false, error: "WebSocket no disponible (requiere Node ≥ 22)" });
    }
    return new Promise((resolve) => {
        const ws = new WebSocketCtor(`wss://${host}/ws`);
        let settled = false;
        let sentConnect = false;
        const done = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            try {
                ws.close();
            }
            catch {
                /* noop */
            }
            resolve(result);
        };
        const timer = setTimeout(() => done({ ok: false, error: "timeout" }), timeoutMs);
        ws.addEventListener("message", (event) => {
            let message;
            try {
                message = JSON.parse(String(event.data));
            }
            catch {
                return;
            }
            if (message.type === "event" && message.event === "connect.challenge" && !sentConnect) {
                sentConnect = true;
                ws.send(JSON.stringify({
                    type: "req",
                    id: "health-1",
                    method: "connect",
                    params: {
                        minProtocol: 4,
                        maxProtocol: 4,
                        client: {
                            id: "openclaw-ios",
                            displayName: "TNode CLI",
                            version: "0.1.0",
                            platform: "ios",
                            deviceFamily: "phone",
                            mode: "ui",
                        },
                        auth: { token },
                        role: "operator",
                        scopes: ["operator.read"],
                        caps: [],
                    },
                }));
                return;
            }
            if (message.type === "res" && message.id === "health-1" && message.ok !== true) {
                const error = message.error;
                const code = error?.details?.code ??
                    (error?.message?.includes("token mismatch") ? "AUTH_TOKEN_MISMATCH" : error?.code) ??
                    "connect_rejected";
                done({ ok: false, error: code });
                return;
            }
            if (message.type === "event" && message.stream === "health") {
                done({ ok: true, health: mapHealth((message.payload ?? {})) });
            }
        });
        ws.addEventListener("error", () => done({ ok: false, error: "ws_error" }));
        ws.addEventListener("close", () => done({ ok: false, error: "closed" }));
    });
}
/** Normaliza un payload `agent` del gateway para el flujo de chat. */
export function chatEvent(payload) {
    const data = payload.data && typeof payload.data === "object" ? payload.data : {};
    return {
        sessionKey: typeof payload.sessionKey === "string" ? payload.sessionKey : undefined,
        runId: typeof payload.runId === "string" ? payload.runId : undefined,
        delta: payload.stream === "assistant" && typeof data.delta === "string" ? data.delta : undefined,
        end: payload.stream === "lifecycle" && data.phase === "end",
    };
}
/** Envía un mensaje one-shot (`chat.send`) y espera el `lifecycle.end`. */
export function sendChat(host, token, message, options = {}) {
    const WebSocketCtor = globalThis.WebSocket;
    if (!WebSocketCtor) {
        return Promise.resolve({ ok: false, error: "WebSocket no disponible (requiere Node ≥ 22)" });
    }
    const timeoutMs = options.timeoutMs ?? 120_000;
    const sessionKey = options.sessionKey ?? `tnode-cli-${crypto.randomUUID()}`;
    const idempotencyKey = `cli-${crypto.randomUUID()}`;
    return new Promise((resolve) => {
        const ws = new WebSocketCtor(`wss://${host}/ws`);
        let settled = false;
        let sentConnect = false;
        let reply = "";
        let runId;
        const done = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            try {
                ws.close();
            }
            catch {
                /* noop */
            }
            resolve(result);
        };
        const timer = setTimeout(() => done({ ok: false, reply, runId, sessionKey, error: "timeout" }), timeoutMs);
        ws.addEventListener("message", (event) => {
            let frame;
            try {
                frame = JSON.parse(String(event.data));
            }
            catch {
                return;
            }
            if (frame.type === "event" && frame.event === "connect.challenge" && !sentConnect) {
                sentConnect = true;
                ws.send(JSON.stringify({
                    type: "req",
                    id: "connect-1",
                    method: "connect",
                    params: {
                        minProtocol: 4,
                        maxProtocol: 4,
                        client: {
                            id: "openclaw-ios",
                            displayName: "TNode CLI",
                            version: "0.1.0",
                            platform: "ios",
                            deviceFamily: "phone",
                            mode: "ui",
                        },
                        auth: { token },
                        role: "operator",
                        scopes: ["operator.read", "operator.write"],
                        caps: [],
                    },
                }));
                return;
            }
            if (frame.type === "res" && frame.id === "connect-1") {
                if (frame.ok !== true) {
                    const error = frame.error;
                    const code = error?.details?.code ??
                        (error?.message?.includes("token mismatch") ? "AUTH_TOKEN_MISMATCH" : error?.code) ??
                        "connect_rejected";
                    done({ ok: false, error: code, sessionKey });
                    return;
                }
                ws.send(JSON.stringify({
                    type: "req",
                    id: "chat-1",
                    method: "chat.send",
                    params: { sessionKey, message, idempotencyKey },
                }));
                return;
            }
            if (frame.type === "res" && frame.id === "chat-1" && frame.ok !== true) {
                const error = frame.error;
                done({ ok: false, error: error?.code ?? error?.message ?? "chat_rejected", sessionKey });
                return;
            }
            if (frame.type === "event" && frame.event === "agent") {
                const payload = (frame.payload ?? {});
                const parsed = chatEvent(payload);
                if (parsed.sessionKey && parsed.sessionKey !== sessionKey)
                    return;
                if (parsed.runId)
                    runId = parsed.runId;
                if (parsed.delta) {
                    reply += parsed.delta;
                    try {
                        options.onDelta?.(parsed.delta);
                    }
                    catch {
                        /* el consumidor no debe romper el stream */
                    }
                }
                if (parsed.end) {
                    done({ ok: true, reply: reply.trim(), runId, sessionKey });
                }
            }
        });
        ws.addEventListener("error", () => done({ ok: false, error: "ws_error", sessionKey }));
        ws.addEventListener("close", () => {
            if (reply.trim())
                done({ ok: true, reply: reply.trim(), runId, sessionKey });
            else
                done({ ok: false, error: "closed", sessionKey });
        });
    });
}
//# sourceMappingURL=ws.js.map