import { randomUUID } from "node:crypto";
export function normalizeBaseUrl(raw) {
    const value = raw.trim();
    if (!value)
        throw new Error("URL vacía");
    const url = new URL(/^(https?|wss?):\/\//.test(value) ? value : `https://${value}`);
    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/a2a" || path === "/ws" || path === "/.well-known/agent-card.json")
        url.pathname = "";
    const protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
    return `${protocol}//${url.host}`;
}
export function hostKey(baseUrl) {
    return new URL(baseUrl).host;
}
export function isTerminalState(state) {
    const value = (state ?? "").toUpperCase().replace(/^TASK_STATE_/, "");
    return value === "COMPLETED" || value === "FAILED" || value === "CANCELED" || value === "REJECTED";
}
function unwrapResult(result) {
    if (result && typeof result === "object" && "task" in result) {
        const task = result.task;
        if (task && typeof task === "object")
            return task;
    }
    return (result ?? {});
}
export function extractTaskText(task) {
    if (task.task && typeof task.task === "object")
        return extractTaskText(task.task);
    // A2A entrega el stream en muchos `parts` (chunks de tokens). Se concatenan
    // sin separador; un salto por chunk rompe el párrafo en columnas.
    const collect = (parts) => (parts ?? [])
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("")
        .trim();
    const artifacts = (task.artifacts ?? []).map((artifact) => collect(artifact.parts)).filter(Boolean);
    return artifacts.join("\n") || collect(task.parts) || collect(task.status?.message?.parts);
}
export function buildSendParams(message, contextId) {
    return {
        message: {
            messageId: randomUUID(),
            role: "ROLE_USER",
            parts: [{ text: message }],
            ...(contextId ? { contextId } : {}),
        },
    };
}
async function requestJson(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const text = await response.text();
        let payload;
        try {
            payload = JSON.parse(text);
        }
        catch {
            throw new Error(`Respuesta no JSON (HTTP ${response.status})`);
        }
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${String(payload.error ?? text).slice(0, 300)}`);
        }
        if (payload.error) {
            const error = payload.error;
            throw new Error(`JSON-RPC ${error.code ?? "?"}: ${error.message ?? "error"}`);
        }
        return unwrapResult(payload.result ?? payload);
    }
    catch (error) {
        if (error instanceof Error && error.name === "AbortError")
            throw new Error(`timeout tras ${timeoutMs}ms`);
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
export async function fetchA2aCard(baseUrl, timeoutMs = 15_000) {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/.well-known/agent-card.json`, {
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok)
        throw new Error(`card HTTP ${response.status}`);
    return (await response.json());
}
export async function a2aRpc(baseUrl, apiKey, method, params, timeoutMs = 180_000) {
    const headers = { "content-type": "application/json" };
    if (apiKey)
        headers["X-API-Key"] = apiKey;
    return (await requestJson(`${normalizeBaseUrl(baseUrl)}/a2a`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: `tnode-${randomUUID()}`, method, params }),
    }, timeoutMs));
}
export async function sendA2aMessage(baseUrl, apiKey, message, options = {}) {
    return a2aRpc(baseUrl, apiKey, "SendMessage", buildSendParams(message, options.contextId), options.timeoutMs);
}
export async function getA2aTask(baseUrl, apiKey, id, timeoutMs = 30_000) {
    return a2aRpc(baseUrl, apiKey, "GetTask", { id }, timeoutMs);
}
export async function cancelA2aTask(baseUrl, apiKey, id, timeoutMs = 30_000) {
    return a2aRpc(baseUrl, apiKey, "CancelTask", { id }, timeoutMs);
}
/** A2A may answer a blocking task or leave it `working`; poll GetTask until terminal. */
export async function waitForA2aTask(baseUrl, apiKey, task, options = {}) {
    const id = task.id;
    if (!id || isTerminalState(task.status?.state))
        return task;
    const deadline = Date.now() + (options.timeoutMs ?? 180_000);
    let current = task;
    while (Date.now() < deadline) {
        if (isTerminalState(current.status?.state))
            return current;
        await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 1000));
        current = await getA2aTask(baseUrl, apiKey, id, Math.max(5000, deadline - Date.now()));
    }
    return current;
}
//# sourceMappingURL=a2a.js.map