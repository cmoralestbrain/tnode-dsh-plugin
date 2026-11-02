import { createConnection } from "node:net";
/** Prueba TCP al host/puerto; no envía datos ni usa tokens. */
export function probeHost(host, port, timeoutMs = 3000) {
    const started = Date.now();
    return new Promise((resolve) => {
        const socket = createConnection({ host, port });
        let done = false;
        const finish = (ok, error) => {
            if (done)
                return;
            done = true;
            socket.destroy();
            resolve({ ok, ms: Date.now() - started, error });
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false, "timeout"));
        socket.once("error", (error) => finish(false, error.code ?? error.message));
    });
}
/** Deriva host/puerto del `serverUrl` (ws/wss) del nodo. */
export function endpointOf(serverUrl) {
    if (!serverUrl)
        return null;
    try {
        const url = new URL(serverUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://"));
        const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
        return { host: url.hostname, port };
    }
    catch {
        return null;
    }
}
/** Códigos de Cloudflare que significan "túnel sin connector" (nodo apagado). */
export function isOriginUp(status) {
    return ![502, 503, 530].includes(status);
}
/** GET al host por HTTPS: distingue gateway vivo (426/404/200) de túnel caído (530). */
export async function probeHttps(host, timeoutMs = 6000) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`https://${host}/`, { method: "GET", redirect: "manual", signal: controller.signal });
        const ok = isOriginUp(response.status);
        return {
            ok,
            ms: Date.now() - started,
            status: response.status,
            error: ok ? undefined : `HTTP ${response.status}`,
        };
    }
    catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        return { ok: false, ms: Date.now() - started, error: aborted ? "timeout" : String(error) };
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=net.js.map