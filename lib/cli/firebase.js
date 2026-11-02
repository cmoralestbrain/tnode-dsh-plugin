/** Configuración pública de las apps (misma que firebase_options.dart). */
export const ENVIRONMENTS = {
    prod: {
        projectId: "tbrain-platform-7fc1f",
        apiKey: "AIzaSyBubGIdH8cXwQtmZyDS8KQKUqqO8VCAyN4",
        authDomain: "auth.tbrain.app",
        googleClientId: "623363076834-pitq7flu57tnc6f514aartmjlg14dbmi.apps.googleusercontent.com",
    },
    beta: {
        projectId: "tbrain-platform-beta",
        apiKey: "AIzaSyCXiEWnrz4Wn5ubSWZxx3NM6LCl2n1Kkak",
        authDomain: "tbrain-platform-beta.firebaseapp.com",
        googleClientId: "185094025379-dggmik2fkd2qdemsq074tkmkunf0hthp.apps.googleusercontent.com",
    },
};
export function decodeJwt(token) {
    const part = token.split(".")[1];
    if (!part)
        throw new Error("Token inválido");
    const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}
/** Canjea un ID token de Google (GSI) por una sesión de Firebase Auth. */
export async function exchangeGoogleCredential(credential, env, fetchImpl = fetch) {
    const response = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${env.apiKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            postBody: `id_token=${encodeURIComponent(credential)}&providerId=google.com`,
            requestUri: "http://localhost",
            returnSecureToken: true,
        }),
    });
    const payload = (await response.json().catch(() => null));
    if (!response.ok || !payload?.idToken || !payload.refreshToken) {
        throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
    }
    return {
        idToken: payload.idToken,
        refreshToken: payload.refreshToken,
        uid: payload.localId ?? "",
        email: payload.email ?? "",
    };
}
/** Canjea el refresh token por un ID token fresco. */
export async function refreshSession(credentials, fetchImpl = fetch) {
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
    });
    const response = await fetchImpl(`https://securetoken.googleapis.com/v1/token?key=${credentials.apiKey}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });
    const payload = (await response.json().catch(() => null));
    if (!response.ok || !payload?.id_token) {
        const message = payload?.error?.message ?? `HTTP ${response.status}`;
        throw new Error(`No se pudo renovar la sesión: ${message}`);
    }
    const claims = decodeJwt(payload.id_token);
    return {
        idToken: payload.id_token,
        refreshToken: payload.refresh_token ?? credentials.refreshToken,
        uid: payload.user_id ?? String(claims.user_id ?? ""),
        email: String(claims.email ?? ""),
        expiresAt: Number(claims.exp ?? 0) * 1000,
    };
}
const FIRESTORE = "https://firestore.googleapis.com/v1";
function str(fields, key) {
    const value = fields?.[key];
    return typeof value?.stringValue === "string" ? value.stringValue : null;
}
function bool(fields, key) {
    const value = fields?.[key];
    return value?.booleanValue === true;
}
export function mapNodeDoc(doc) {
    const id = String(doc.name ?? "").split("/").pop() ?? "";
    const fields = doc.fields;
    return {
        id,
        name: str(fields, "name") ?? "(sin nombre)",
        serverUrl: str(fields, "serverUrl") ?? "",
        role: str(fields, "accessRole") ?? "owner",
        icon: str(fields, "iconName") ?? "smart_toy",
        emoji: str(fields, "emoji"),
        sharedAuth: bool(fields, "usesSharedGatewayAuth"),
    };
}
export function hostOf(serverUrl) {
    if (!serverUrl)
        return "—";
    try {
        const url = new URL(serverUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://"));
        return url.host;
    }
    catch {
        return serverUrl;
    }
}
function mapSettingsNode(fields) {
    return {
        id: str(fields, "id") ?? "",
        name: str(fields, "name") ?? "(sin nombre)",
        serverUrl: str(fields, "serverUrl") ?? "",
        role: str(fields, "accessRole") ?? "owner",
        icon: str(fields, "iconName") ?? "smart_toy",
        emoji: str(fields, "emoji"),
        sharedAuth: bool(fields, "usesSharedGatewayAuth"),
    };
}
/** Lista los nodos de `users/{uid}.settings.nodes` (la misma lista que ve la app). */
export async function fetchUserNodes(idToken, projectId, fetchImpl = fetch) {
    const uid = String(decodeJwt(idToken).user_id ?? "");
    const url = `${FIRESTORE}/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
    const response = await fetchImpl(url, { headers: { authorization: `Bearer ${idToken}` } });
    const payload = (await response.json().catch(() => null));
    if (!response.ok)
        throw new Error(`Firestore: ${payload?.error?.message ?? `HTTP ${response.status}`}`);
    const settings = payload?.fields?.settings?.mapValue?.fields;
    const rawNodes = settings?.nodes
        ?.arrayValue?.values;
    if (!rawNodes) {
        // Fallback para cuentas que solo tienen docs en la colección nodes.
        return fetchNodes(idToken, projectId, fetchImpl);
    }
    return rawNodes
        .map((value) => mapSettingsNode(value.mapValue?.fields))
        .filter((node) => node.id && node.serverUrl)
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
}
/** Lista `users/{uid}/nodes` con el ID token del usuario (respeta reglas). */
export async function fetchNodes(idToken, projectId, fetchImpl = fetch) {
    const base = `${FIRESTORE}/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(decodeJwt(idToken).user_id)}/nodes`;
    const nodes = [];
    let pageToken;
    for (;;) {
        const url = new URL(base);
        url.searchParams.set("pageSize", "100");
        if (pageToken)
            url.searchParams.set("pageToken", pageToken);
        const response = await fetchImpl(url.toString(), { headers: { authorization: `Bearer ${idToken}` } });
        const payload = (await response.json().catch(() => null));
        if (!response.ok) {
            throw new Error(`Firestore: ${payload?.error?.message ?? `HTTP ${response.status}`}`);
        }
        for (const doc of payload?.documents ?? [])
            nodes.push(mapNodeDoc(doc));
        if (!payload?.nextPageToken)
            break;
        pageToken = payload.nextPageToken;
    }
    return nodes.sort((a, b) => a.name.localeCompare(b.name, "es"));
}
/** Tokens por host (`host:443`) desde users/{uid}/credentials/main. Nunca se imprimen. */
export async function fetchNodeTokens(idToken, projectId, fetchImpl = fetch) {
    const uid = String(decodeJwt(idToken).user_id ?? "");
    const url = `${FIRESTORE}/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}/credentials/main`;
    const response = await fetchImpl(url, { headers: { authorization: `Bearer ${idToken}` } });
    const payload = (await response.json().catch(() => null));
    if (!response.ok)
        throw new Error(`Firestore: ${payload?.error?.message ?? `HTTP ${response.status}`}`);
    const map = payload?.fields?.nodeTokens
        ?.mapValue?.fields;
    return Object.fromEntries(Object.entries(map ?? {}).map(([host, value]) => [host, value?.stringValue ?? ""]).filter(([, token]) => token));
}
//# sourceMappingURL=firebase.js.map