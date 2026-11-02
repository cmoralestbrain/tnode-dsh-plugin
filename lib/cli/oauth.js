import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { loadCredentials, saveCredentials } from "./credentials.js";
import { ENVIRONMENTS, decodeJwt } from "./firebase.js";
const TIMEOUT_MS = 10 * 60 * 1000;
function openBrowser(url) {
    try {
        if (process.platform === "darwin") {
            const preferred = process.env.TNODE_BROWSER;
            spawn("open", preferred ? ["-a", preferred, url] : [url], { detached: true, stdio: "ignore" }).unref();
        }
        else if (process.platform === "linux") {
            spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
        }
    }
    catch {
        // El usuario puede abrir la URL manualmente si el host la expone.
    }
}
function loginPage(config, state) {
    return `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TNode · iniciar sesión</title>
<body style="margin:0;background:#0b0f14;color:#e6edf3;font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh">
<main style="max-width:420px;padding:40px 28px;text-align:center">
  <div style="font-size:44px">🤖</div>
  <h1 style="font-size:24px;margin:16px 0 8px">Entrar a TNode</h1>
  <p style="color:#8b949e;line-height:1.5">Usa la misma cuenta de Google que en la app. Al terminar, vuelve al panel del harness.</p>
  <button id="go" style="margin-top:24px;background:#2f81f7;color:#fff;border:0;border-radius:10px;padding:14px 22px;font-size:16px;font-weight:600;cursor:pointer">Continuar con Google</button>
  <p id="err" style="color:#f85149;margin-top:18px;font-size:14px;white-space:pre-wrap"></p>
  <p id="done" style="color:#3fb950;margin-top:18px;font-size:15px;display:none">Listo. Ya puedes volver al panel.</p>
</main>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
<script>
  var firebaseConfig = ${JSON.stringify({ apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId })};
  var state = ${JSON.stringify(state)};
  firebase.initializeApp(firebaseConfig);

  function report(payload) {
    return fetch('/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  document.getElementById('go').addEventListener('click', async function () {
    document.getElementById('err').textContent = '';
    try {
      var provider = new firebase.auth.GoogleAuthProvider();
      var result = await firebase.auth().signInWithPopup(provider);
      var idToken = await result.user.getIdToken();
      var response = await report({
        state: state,
        idToken: idToken,
        refreshToken: result.user.refreshToken,
        email: result.user.email,
        uid: result.user.uid
      });
      if (response.ok) {
        document.getElementById('done').style.display = 'block';
        document.getElementById('go').style.display = 'none';
      } else {
        document.getElementById('err').textContent = 'El host rechazó la sesión.';
      }
    } catch (error) {
      var message = (error && error.code ? error.code + ': ' : '') + (error && error.message ? error.message : String(error));
      document.getElementById('err').textContent = message;
      report({ state: state, error: message }).catch(function () {});
    }
  });
</script>
</body>
</html>`;
}
async function readJsonBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > 256 * 1024)
            return null;
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch {
        return null;
    }
}
/** Google popup on localhost; saves the same credentials file the CLI/bridge reads. */
export async function loginWithBrowser(envName, options = {}) {
    const config = ENVIRONMENTS[envName];
    if (!config)
        throw new Error(`entorno desconocido: ${envName}`);
    const existing = loadCredentials(envName);
    if (existing && !options.force)
        return { uid: existing.uid, email: existing.email ?? "" };
    const port = options.port ?? Number(process.env.TNODE_LOGIN_PORT ?? 8765);
    const state = randomBytes(16).toString("hex");
    let settle = () => undefined;
    const result = new Promise((resolve) => {
        settle = resolve;
    });
    let finished = false;
    const finish = (value) => {
        if (finished)
            return;
        finished = true;
        settle(value);
    };
    const server = createServer(async (request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/") {
            response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            response.end(loginPage(config, state));
            return;
        }
        if (request.method === "POST" && url.pathname === "/callback") {
            const payload = await readJsonBody(request);
            if (!payload || payload.state !== state) {
                response.writeHead(400, { "content-type": "text/plain" });
                response.end("state inválido");
                return;
            }
            if (payload.error)
                finish({ ok: false, error: payload.error });
            else if (!payload.idToken || !payload.refreshToken)
                finish({ ok: false, error: "sin idToken/refreshToken" });
            else
                finish({ ok: true, payload });
            response.writeHead(200, { "content-type": "text/plain" });
            response.end("ok");
            return;
        }
        response.writeHead(404);
        response.end("not found");
    });
    await new Promise((resolve, reject) => {
        server.once("error", (error) => {
            reject(error.code === "EADDRINUSE"
                ? new Error(`El puerto ${port} está ocupado; cierra el intento anterior.`)
                : error);
        });
        server.listen(port, "127.0.0.1", () => resolve());
    });
    const { port: actualPort } = server.address();
    const url = `http://localhost:${actualPort}/?state=${state}`;
    options.onUrl?.(url);
    openBrowser(url);
    const timer = setTimeout(() => finish({ ok: false, error: "tiempo de espera agotado" }), TIMEOUT_MS);
    const outcome = await result;
    clearTimeout(timer);
    server.close();
    if (!outcome.ok)
        throw new Error(`No se pudo iniciar sesión: ${outcome.error}`);
    const payload = outcome.payload;
    const claims = decodeJwt(payload.idToken);
    const uid = String(claims.user_id ?? payload.uid ?? "");
    const email = String(claims.email ?? payload.email ?? "");
    if (!uid)
        throw new Error("El token no contiene user_id");
    saveCredentials({
        version: 1,
        env: envName,
        projectId: config.projectId,
        apiKey: config.apiKey,
        refreshToken: payload.refreshToken,
        uid,
        email,
        savedAt: new Date().toISOString(),
    });
    return { uid, email };
}
//# sourceMappingURL=oauth.js.map