import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./credentials.js";
import { ENVIRONMENTS, decodeJwt } from "./firebase.js";
export function harnessSessionPath() {
    return join(configDir(), "harness.json");
}
function readFile() {
    try {
        const parsed = JSON.parse(readFileSync(harnessSessionPath(), "utf8"));
        return parsed.sessions ? parsed : { version: 1, sessions: {} };
    }
    catch {
        return { version: 1, sessions: {} };
    }
}
function writeSession(session) {
    const file = readFile();
    file.sessions[session.env] = session;
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(harnessSessionPath(), `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    chmodSync(harnessSessionPath(), 0o600);
}
export function clearHarnessSession(env) {
    const file = readFile();
    delete file.sessions[env];
    writeFileSync(harnessSessionPath(), `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
}
function functionsBase(env) {
    return `https://us-central1-${ENVIRONMENTS[env].projectId}.cloudfunctions.net`;
}
async function postJson(url, body) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({})));
    return { status: response.status, data };
}
/** Firebase custom token → idToken. Never stores the Firebase refresh token. */
async function exchangeCustomToken(env, customToken) {
    const { status, data } = await postJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(ENVIRONMENTS[env].apiKey)}`, { token: customToken, returnSecureToken: true });
    if (status !== 200 || typeof data.idToken !== "string") {
        throw new Error(`No se pudo canjear el custom token (HTTP ${status})`);
    }
    const claims = decodeJwt(data.idToken);
    const expiresIn = Number(data.expiresIn) || 3600;
    return {
        idToken: data.idToken,
        idTokenExpiresAt: Date.now() + expiresIn * 1000,
        uid: String(claims.user_id ?? claims.sub ?? ""),
        email: String(claims.email ?? ""),
    };
}
export async function startHarnessDevice(env) {
    const { status, data } = await postJson(`${functionsBase(env)}/harnessDeviceStart`, { client_name: "DeepSeek Harness" });
    if (status !== 200 || typeof data.user_code !== "string" || typeof data.device_code !== "string") {
        throw new Error(`No se pudo iniciar el device flow (HTTP ${status})`);
    }
    return data;
}
export async function pollHarnessDevice(env, deviceCode) {
    const { status, data } = await postJson(`${functionsBase(env)}/harnessToken`, {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
    });
    if (status !== 200) {
        const error = String(data.error ?? "");
        if (error === "authorization_pending")
            return { status: "pending" };
        if (error === "slow_down")
            return { status: "slow_down" };
        if (error === "access_denied")
            return { status: "denied" };
        return { status: "expired" };
    }
    const token = data;
    if (!token.firebase_custom_token || !token.refresh_token) {
        throw new Error("harnessToken no devolvió tokens");
    }
    const id = await exchangeCustomToken(env, token.firebase_custom_token);
    const session = {
        env,
        projectId: ENVIRONMENTS[env].projectId,
        apiKey: ENVIRONMENTS[env].apiKey,
        deviceId: token.device_id,
        nodeIds: Array.isArray(token.nodes) ? token.nodes : [],
        scopes: typeof token.scope === "string" ? token.scope.split(" ").filter(Boolean) : [],
        refreshToken: token.refresh_token,
        idToken: id.idToken,
        idTokenExpiresAt: id.idTokenExpiresAt,
        uid: id.uid,
        email: id.email,
        createdAt: new Date().toISOString(),
    };
    writeSession(session);
    return { status: "approved", session };
}
async function refreshSession(session) {
    const { status, data } = await postJson(`${functionsBase(session.env)}/harnessRefresh`, {
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
    });
    if (status !== 200)
        throw new Error(`No se pudo renovar el harness (HTTP ${status})`);
    const token = data;
    if (!token.firebase_custom_token || !token.refresh_token)
        throw new Error("harnessRefresh sin tokens");
    const id = await exchangeCustomToken(session.env, token.firebase_custom_token);
    const next = {
        ...session,
        nodeIds: Array.isArray(token.nodes) ? token.nodes : session.nodeIds,
        scopes: typeof token.scope === "string" ? token.scope.split(" ").filter(Boolean) : session.scopes,
        refreshToken: token.refresh_token,
        idToken: id.idToken,
        idTokenExpiresAt: id.idTokenExpiresAt,
        uid: id.uid || session.uid,
        email: id.email || session.email,
    };
    writeSession(next);
    return next;
}
/** Returns a valid device session, refreshing it when needed; null when not paired. */
export async function loadHarnessSession(env) {
    const file = readFile();
    const session = file.sessions[env];
    if (!session)
        return null;
    if (session.idTokenExpiresAt > Date.now() + 60_000)
        return session;
    try {
        return await refreshSession(session);
    }
    catch {
        if (existsSync(harnessSessionPath()))
            clearHarnessSession(env);
        return null;
    }
}
//# sourceMappingURL=harness-auth.js.map