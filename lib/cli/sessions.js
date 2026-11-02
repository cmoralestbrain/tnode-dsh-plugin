import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./credentials.js";
export function sessionsFile() {
    return join(configDir(), "sessions.json");
}
function loadSessions() {
    try {
        const parsed = JSON.parse(readFileSync(sessionsFile(), "utf8"));
        return parsed.sessions ?? {};
    }
    catch {
        return {};
    }
}
function saveSessions(sessions) {
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(sessionsFile(), `${JSON.stringify({ version: 1, sessions }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(sessionsFile(), 0o600);
}
/** Stable canonical session per environment/node; mimics the mobile `tnode-mobile-*`. */
export function sessionKeyFor(env, nodeId) {
    const sessions = loadSessions();
    const key = `${env}:${nodeId}`;
    const existing = sessions[key];
    if (typeof existing === "string" && existing.startsWith("agent:main:tnode-mobile-"))
        return existing;
    const created = `agent:main:tnode-mobile-${randomUUID()}`;
    sessions[key] = created;
    saveSessions(sessions);
    return created;
}
//# sourceMappingURL=sessions.js.map