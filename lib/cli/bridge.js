import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { configDir, loadCredentials } from "./credentials.js";
import { decodeJwt, fetchNodeTokens, fetchUserNodes, refreshSession } from "./firebase.js";
import { loadFleetConfig } from "./fleet.js";
import { endpointOf } from "./net.js";
import { OwnerTransport } from "./owner-transport.js";
import { sessionKeyFor } from "./sessions.js";
import { sendChat } from "./ws.js";
class AuthRequiredError extends Error {
    env;
    constructor(env) {
        super(`sin sesión ${env}`);
        this.env = env;
    }
}
export function bridgeTokenPath() {
    return join(configDir(), "bridge-token");
}
export function bridgeToken() {
    const path = bridgeTokenPath();
    try {
        const existing = readFileSync(path, "utf8").trim();
        if (existing.length >= 20)
            return existing;
    }
    catch {
        // create below
    }
    const token = randomBytes(24).toString("base64url");
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${token}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
    return token;
}
function json(res, status, body) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
}
function sse(res) {
    res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
    });
    return (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
}
async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 1_000_000)
            throw new Error("body demasiado grande");
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}
async function ownerTarget(nodeId, env, sessionOverride) {
    const credentials = loadCredentials(env);
    if (!credentials)
        throw new AuthRequiredError(env);
    const session = await refreshSession(credentials);
    const nodes = await fetchUserNodes(session.idToken, credentials.projectId);
    const node = nodes.find((item) => item.id === nodeId);
    if (!node)
        throw new Error(`no existe el nodo ${nodeId}`);
    const endpoint = endpointOf(node.serverUrl);
    if (!endpoint || !node.serverUrl.startsWith("wss://"))
        throw new Error("nodo sin wss");
    const kind = loadFleetConfig().find((entry) => entry.id === node.id && entry.env === env)?.kind ?? "openclaw";
    let token;
    if (kind === "pi") {
        const tokens = await fetchNodeTokens(session.idToken, credentials.projectId);
        token = tokens[`${endpoint.host}:443`] ?? tokens[`${endpoint.host}:${endpoint.port}`] ?? tokens[endpoint.host];
        if (!token)
            throw new Error("sin gatewayToken para el nodo Pi");
    }
    const sessionKey = sessionOverride?.trim()
        ? sessionOverride.trim().startsWith("agent:")
            ? sessionOverride.trim()
            : `agent:main:${sessionOverride.trim()}`
        : sessionKeyFor(env, node.id);
    return {
        host: endpoint.host,
        name: node.name,
        sessionKey,
        idToken: session.idToken,
        kind,
        token,
    };
}
export async function startBridge(options = {}) {
    const token = bridgeToken();
    const server = createServer(async (req, res) => {
        const origin = req.headers.origin ?? "";
        const localOrigin = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) || origin === "dsh-app://app";
        if (options.allowLocalOrigins && localOrigin) {
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Vary", "Origin");
        }
        else {
            res.setHeader("Access-Control-Allow-Origin", "*");
        }
        res.setHeader("Access-Control-Allow-Headers", "content-type,x-bridge-token");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname === "/health") {
            json(res, 200, { ok: true });
            return;
        }
        const authorized = req.headers["x-bridge-token"] === token || (options.allowLocalOrigins && localOrigin);
        if (!authorized) {
            json(res, 401, { error: "token de bridge inválido" });
            return;
        }
        try {
            if (req.method === "GET" && url.pathname === "/api/nodes") {
                const env = (url.searchParams.get("env") ?? "beta");
                if (env !== "prod" && env !== "beta")
                    throw new Error("env inválido");
                const credentials = loadCredentials(env);
                if (!credentials)
                    throw new AuthRequiredError(env);
                const session = await refreshSession(credentials);
                const nodes = await fetchUserNodes(session.idToken, credentials.projectId);
                const config = loadFleetConfig();
                json(res, 200, {
                    env,
                    nodes: nodes.map((node) => ({
                        id: node.id,
                        name: node.name,
                        host: endpointOf(node.serverUrl)?.host ?? null,
                        role: node.role,
                        kind: config.find((entry) => entry.id === node.id && entry.env === env)?.kind ?? "openclaw",
                        hasTunnel: Boolean(node.serverUrl),
                    })),
                });
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/sessions") {
                const nodeId = url.searchParams.get("nodeId");
                const env = (url.searchParams.get("env") ?? "beta");
                if (!nodeId)
                    throw new Error("falta nodeId");
                if (env !== "prod" && env !== "beta")
                    throw new Error("env inválido");
                const credentials = loadCredentials(env);
                if (!credentials)
                    throw new AuthRequiredError(env);
                const session = await refreshSession(credentials);
                const uid = decodeJwt(session.idToken).user_id;
                const endpoint = `https://firestore.googleapis.com/v1/projects/${credentials.projectId}/databases/(default)/documents/users/${uid}/nodes/${nodeId}/chats?pageSize=300`;
                const response = await fetch(endpoint, { headers: { authorization: `Bearer ${session.idToken}` } });
                if (!response.ok)
                    throw new Error(`Firestore HTTP ${response.status}`);
                const payload = (await response.json());
                const grouped = new Map();
                for (const doc of payload.documents ?? []) {
                    const fields = doc.fields ?? {};
                    const sessionKey = fields.sessionKey?.stringValue;
                    const content = fields.content?.stringValue;
                    if (!sessionKey || !content)
                        continue;
                    const role = fields.role?.stringValue ?? "assistant";
                    const createdAt = fields.createdAt?.stringValue ?? fields.createdAt?.timestampValue ?? "";
                    const entry = grouped.get(sessionKey) ?? { sessionKey, updatedAt: createdAt, messages: [] };
                    entry.messages.push({ role, content, createdAt });
                    if (createdAt > entry.updatedAt)
                        entry.updatedAt = createdAt;
                    grouped.set(sessionKey, entry);
                }
                const sessions = [...grouped.values()]
                    .map((entry) => ({
                    ...entry,
                    messages: entry.messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-100),
                    preview: entry.messages[entry.messages.length - 1]?.content.slice(0, 120) ?? "",
                }))
                    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                    .slice(0, 20);
                json(res, 200, { env, nodeId, sessions });
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/session") {
                const nodeId = url.searchParams.get("nodeId");
                const env = (url.searchParams.get("env") ?? "beta");
                if (!nodeId)
                    throw new Error("falta nodeId");
                if (env !== "prod" && env !== "beta")
                    throw new Error("env inválido");
                json(res, 200, { env, nodeId, sessionKey: sessionKeyFor(env, nodeId) });
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/chat") {
                const body = JSON.parse(await readBody(req));
                if (!body.nodeId || !body.message)
                    throw new Error("faltan nodeId/message");
                const env = body.env ?? "beta";
                if (env !== "prod" && env !== "beta")
                    throw new Error("env inválido");
                const target = await ownerTarget(body.nodeId, env, body.sessionKey);
                const send = sse(res);
                send("session", { sessionKey: target.sessionKey, node: target.name });
                if (target.kind === "pi") {
                    try {
                        const result = await sendChat(target.host, target.token, body.message, {
                            timeoutMs: body.timeoutMs ?? 300_000,
                            sessionKey: target.sessionKey,
                            onDelta: (delta) => send("delta", { delta }),
                        });
                        if (result.ok)
                            send("done", { reply: result.reply, runId: result.runId, sessionKey: result.sessionKey });
                        else
                            send("error", { message: result.error ?? "sin respuesta" });
                    }
                    catch (error) {
                        send("error", { message: error instanceof Error ? error.message : String(error) });
                    }
                    finally {
                        res.end();
                    }
                    return;
                }
                const transport = new OwnerTransport({
                    host: target.host,
                    idToken: target.idToken,
                    sessionKey: target.sessionKey,
                });
                req.on("close", () => transport.close());
                try {
                    const result = await transport.turn(body.message, {
                        timeoutMs: body.timeoutMs ?? 300_000,
                        onDelta: (delta) => send("delta", { delta }),
                    });
                    send("done", { reply: result.reply, runId: result.runId, sessionKey: result.sessionKey });
                }
                catch (error) {
                    send("error", { message: error instanceof Error ? error.message : String(error) });
                }
                finally {
                    transport.close();
                    res.end();
                }
                return;
            }
            json(res, 404, { error: "ruta no encontrada" });
        }
        catch (error) {
            if (error instanceof AuthRequiredError) {
                json(res, 401, { error: "auth_required", env: error.env, message: error.message });
                return;
            }
            json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
    });
    const requestedPort = options.port ?? 3987;
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(requestedPort, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : requestedPort;
    return {
        port,
        url: `http://127.0.0.1:${port}`,
        tokenPath: bridgeTokenPath(),
        close: () => new Promise((resolve, reject) => {
            server.closeAllConnections?.();
            server.close((error) => (error ? reject(error) : resolve()));
        }),
    };
}
//# sourceMappingURL=bridge.js.map