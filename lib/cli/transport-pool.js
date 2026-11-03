import { createHash, randomUUID } from "node:crypto";
import { chatEvent } from "./ws.js";
import { OwnerTransport } from "./owner-transport.js";
import { WebSocketConnection } from "./websocket.js";
const IDLE_MS = 5 * 60_000;
class PiSession {
    host;
    token;
    sessionKey;
    connection;
    connecting;
    pending;
    constructor(host, token, sessionKey) {
        this.host = host;
        this.token = token;
        this.sessionKey = sessionKey;
    }
    connect() {
        if (this.connection)
            return Promise.resolve();
        if (this.connecting)
            return this.connecting;
        this.connecting = new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                reject(new Error("timeout conectando a Pi"));
            }, 15_000);
            const finish = (error) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                this.connecting = undefined;
                if (error)
                    reject(error);
                else
                    resolve();
            };
            WebSocketConnection.connect(`wss://${this.host}/ws`, {})
                .then((connection) => {
                this.connection = connection;
                connection.setHandlers({
                    onMessage: (text) => this.handle(text, finish),
                    onClose: (code) => this.onClose(code),
                    onError: (error) => this.onError(error),
                });
            })
                .catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
        });
        return this.connecting;
    }
    handle(text, finishConnect) {
        let frame;
        try {
            frame = JSON.parse(text);
        }
        catch {
            return;
        }
        if (frame.type === "event" && frame.event === "connect.challenge") {
            try {
                this.connection?.send(JSON.stringify({
                    type: "req",
                    id: "connect-1",
                    method: "connect",
                    params: {
                        minProtocol: 4,
                        maxProtocol: 4,
                        client: {
                            id: "openclaw-ios",
                            displayName: "TNode DSH",
                            version: "0.1.0",
                            platform: "ios",
                            deviceFamily: "phone",
                            mode: "ui",
                        },
                        auth: { token: this.token },
                        role: "operator",
                        scopes: ["operator.read", "operator.write"],
                        caps: [],
                    },
                }));
            }
            catch (error) {
                finishConnect(error instanceof Error ? error : new Error(String(error)));
            }
            return;
        }
        if (frame.type === "res" && frame.id === "connect-1") {
            if (frame.ok === true) {
                finishConnect();
            }
            else {
                const error = frame.error;
                finishConnect(new Error(error?.code ?? error?.message ?? "connect_rejected"));
            }
            return;
        }
        if (frame.type === "res" && this.pending && String(frame.id).startsWith("chat-") && frame.ok !== true) {
            const error = frame.error;
            this.finishPending(new Error(error?.code ?? error?.message ?? "chat_rejected"));
            return;
        }
        if (frame.type === "event" && frame.event === "agent") {
            const pending = this.pending;
            if (!pending)
                return;
            const parsed = chatEvent((frame.payload ?? {}));
            if (parsed.sessionKey && parsed.sessionKey !== this.sessionKey)
                return;
            if (parsed.runId)
                pending.runId = parsed.runId;
            if (parsed.delta) {
                pending.reply += parsed.delta;
                try {
                    pending.onDelta?.(parsed.delta);
                }
                catch {
                    // el consumidor no rompe el stream
                }
            }
            if (parsed.end) {
                this.finishPending(null, pending.reply.trim());
            }
        }
    }
    async chat(message, options = {}) {
        await this.connect();
        if (this.pending)
            throw new Error("ya hay un turno en curso");
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => this.finishPending(new Error("timeout del turno Pi")), options.timeoutMs ?? 300_000);
            this.pending = { resolve, reject, timer, reply: "", runId: null, onDelta: options.onDelta };
            try {
                this.connection?.send(JSON.stringify({
                    type: "req",
                    id: `chat-${randomUUID()}`,
                    method: "chat.send",
                    params: { sessionKey: this.sessionKey, message, idempotencyKey: `dsh-${randomUUID()}` },
                }));
            }
            catch (error) {
                this.finishPending(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }
    onClose(code) {
        this.connection = undefined;
        this.finishPending(new Error(`transporte cerrado (${code})`));
    }
    onError(error) {
        this.connection = undefined;
        this.finishPending(error);
    }
    finishPending(error, reply) {
        const pending = this.pending;
        if (!pending)
            return;
        clearTimeout(pending.timer);
        this.pending = undefined;
        if (error)
            pending.reject(error);
        else
            pending.resolve({ reply: reply ?? pending.reply, runId: pending.runId, sessionKey: this.sessionKey });
    }
    close() {
        this.connection?.close();
        this.connection = undefined;
        this.finishPending(new Error("transporte cerrado"));
    }
}
const piPool = new Map();
const ownerPool = new Map();
function poolKey(host, sessionKey, token) {
    return `${host}|${sessionKey}|${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
}
function idleTimer(onIdle) {
    const timer = setTimeout(onIdle, IDLE_MS);
    timer.unref?.();
    return timer;
}
function serialize(entry, task) {
    const run = entry.tail.then(task, task);
    entry.tail = run.then(() => undefined, () => undefined);
    return run;
}
export function piTurn(options, message, callbacks = {}) {
    const key = poolKey(options.host, options.sessionKey, options.token);
    let entry = piPool.get(key);
    if (!entry) {
        const client = new PiSession(options.host, options.token, options.sessionKey);
        const newEntry = { client, tail: Promise.resolve(), lastUsed: Date.now(), idle: idleTimer(() => undefined) };
        newEntry.idle = idleTimer(() => {
            if (Date.now() - newEntry.lastUsed >= IDLE_MS - 1000) {
                piPool.delete(key);
                client.close();
            }
        });
        piPool.set(key, newEntry);
        entry = newEntry;
    }
    entry.lastUsed = Date.now();
    return serialize(entry, () => entry.client.chat(message, callbacks)).catch((error) => {
        piPool.delete(key);
        entry.client.close();
        throw error;
    });
}
export function ownerTurn(options, message, callbacks = {}) {
    const key = poolKey(options.host, options.sessionKey, options.idToken);
    let entry = ownerPool.get(key);
    if (!entry) {
        const transport = new OwnerTransport({ host: options.host, idToken: options.idToken, sessionKey: options.sessionKey });
        const newEntry = { transport, tail: Promise.resolve(), lastUsed: Date.now(), idle: idleTimer(() => undefined) };
        newEntry.idle = idleTimer(() => {
            if (Date.now() - newEntry.lastUsed >= IDLE_MS - 1000) {
                ownerPool.delete(key);
                transport.close();
            }
        });
        ownerPool.set(key, newEntry);
        entry = newEntry;
    }
    entry.lastUsed = Date.now();
    return serialize(entry, () => entry.transport.turn(message, callbacks)).catch((error) => {
        ownerPool.delete(key);
        entry.transport.close();
        throw error;
    });
}
export function disposeTransportPools() {
    for (const entry of piPool.values()) {
        clearTimeout(entry.idle);
        entry.client.close();
    }
    for (const entry of ownerPool.values()) {
        clearTimeout(entry.idle);
        entry.transport.close();
    }
    piPool.clear();
    ownerPool.clear();
}
//# sourceMappingURL=transport-pool.js.map