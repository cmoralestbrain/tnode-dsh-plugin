import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configDir, loadCredentials } from "./credentials.js";
import { fetchNodeTokens, fetchUserNodes, refreshSession } from "./firebase.js";
import { endpointOf } from "./net.js";
import { run } from "./exec.js";
const ENVS = ["prod", "beta"];
export function fleetConfigPath() {
    return process.env.TNODE_FLEET_FILE || join(configDir(), "fleet.json");
}
export function loadFleetConfig(path = fleetConfigPath()) {
    if (!existsSync(path))
        return [];
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        throw new Error(`fleet.json inválido: ${path}`);
    }
    const raw = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray(parsed.nodes)
            ? parsed.nodes
            : [];
    return raw
        .filter((item) => Boolean(item) && typeof item === "object")
        .map((item) => ({
        id: String(item.id ?? ""),
        name: String(item.name ?? item.id ?? ""),
        env: (item.env === "beta" ? "beta" : "prod"),
        role: typeof item.role === "string" ? item.role : undefined,
        kind: (item.kind === "pi" ? "pi" : "openclaw"),
        ssh: typeof item.ssh === "string" ? item.ssh : undefined,
        serverUrl: typeof item.serverUrl === "string" ? item.serverUrl : undefined,
        source: "config",
    }))
        .filter((item) => item.id.length > 0);
}
/** Firestore (prod+beta) + fleet.json; config gana en ssh/nombre. */
export async function loadFleetInventory() {
    const entries = new Map();
    const tokens = new Map();
    const sessions = [];
    for (const env of ENVS) {
        const credentials = loadCredentials(env);
        if (!credentials)
            continue;
        try {
            const refreshed = await refreshSession(credentials);
            const nodes = await fetchUserNodes(refreshed.idToken, credentials.projectId);
            const nodeTokens = await fetchNodeTokens(refreshed.idToken, credentials.projectId);
            sessions.push(env);
            for (const [host, token] of Object.entries(nodeTokens))
                tokens.set(`${env}:${host}`, token);
            for (const node of nodes) {
                entries.set(`${env}:${node.id}`, {
                    id: node.id,
                    name: node.name,
                    env,
                    role: node.role,
                    kind: "openclaw",
                    serverUrl: node.serverUrl,
                    source: "firestore",
                });
            }
        }
        catch {
            // Sesión inválida/expirada: el inventario sigue con lo demás.
        }
    }
    for (const configEntry of loadFleetConfig()) {
        const key = `${configEntry.env}:${configEntry.id}`;
        const existing = entries.get(key);
        entries.set(key, {
            ...existing,
            ...configEntry,
            serverUrl: configEntry.serverUrl ?? existing?.serverUrl,
            source: "config",
        });
    }
    const sorted = [...entries.values()].sort((a, b) => a.env.localeCompare(b.env) || a.name.localeCompare(b.name, "es"));
    return { entries: sorted, tokens, sessions };
}
export function tokenFor(inventory, entry) {
    const endpoint = endpointOf(entry.serverUrl ?? "");
    if (!endpoint)
        return undefined;
    return (inventory.tokens.get(`${entry.env}:${endpoint.host}:${endpoint.port}`) ??
        inventory.tokens.get(`${entry.env}:${endpoint.host}:443`) ??
        inventory.tokens.get(`${entry.env}:${endpoint.host}`));
}
export function parseOpenclawVersion(text) {
    const match = text.match(/OpenClaw\s+([0-9]+\.[0-9]+\.[0-9]+)/i) ?? text.match(/\b([0-9]+\.[0-9]+\.[0-9]+)\b/);
    return match?.[1] ?? null;
}
export function parseInstallerVersion(manifestText) {
    try {
        const parsed = JSON.parse(manifestText);
        return typeof parsed.installerVersion === "string" ? parsed.installerVersion : null;
    }
    catch {
        return null;
    }
}
export function driftStatus(actual, target) {
    if (!actual)
        return "unknown";
    return actual === target ? "ok" : "drift";
}
export function ssh(target, command, timeoutMs = 30_000) {
    return run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=15", target, command], { timeoutMs });
}
export const VERSION_COMMAND = "openclaw --version 2>/dev/null; echo '---'; cat \"${OPENCLAW_HOME:-$HOME/.openclaw}/components-manifest.json\" 2>/dev/null || cat /home/tnode/.openclaw/components-manifest.json 2>/dev/null || true";
export const PI_VERSION_COMMAND = "cat /home/tnode/pi-host-app/.installed-version 2>/dev/null || true";
export function parsePiVersion(text) {
    const match = text.trim().match(/\b([0-9]+\.[0-9]+\.[0-9]+)\b/);
    return match?.[1] ?? null;
}
//# sourceMappingURL=fleet.js.map