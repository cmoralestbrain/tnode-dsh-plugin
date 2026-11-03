window.__ModuleLoader__.load({
  id: "@tnode/dsh-plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require("react");
    const h = React.createElement;

    const STORAGE_URL = "tnode.bridge.url";

    function parseBlock(block) {
      let event = "message";
      const data = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (data.length === 0) return null;
      try {
        return { event, data: JSON.parse(data.join("\n")) };
      } catch {
        return null;
      }
    }

    async function readSse(response, onEvent) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const parsed = parseBlock(block);
          if (parsed) onEvent(parsed);
        }
      }
    }

    function renderInline(text) {
      const nodes = [];
      const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
      let last = 0;
      let match;
      let key = 0;
      while ((match = re.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index));
        const token = match[0];
        if (token.startsWith("**")) nodes.push(h("strong", { key: key++ }, token.slice(2, -2)));
        else if (token.startsWith("`")) nodes.push(h("code", { key: key++, style: { background: "rgba(255,255,255,.1)", padding: "1px 4px", borderRadius: 4 } }, token.slice(1, -1)));
        else nodes.push(h("em", { key: key++ }, token.slice(1, -1)));
        last = match.index + token.length;
      }
      if (last < text.length) nodes.push(text.slice(last));
      return nodes;
    }

    function TNodePanel() {
      const [bridge, setBridge] = React.useState(() => localStorage.getItem(STORAGE_URL) || "http://127.0.0.1:3987");
      const [env, setEnv] = React.useState(() => localStorage.getItem("tnode.env") || "beta");
      const [online, setOnline] = React.useState(false);
      const [nodes, setNodes] = React.useState([]);
      const [nodeId, setNodeId] = React.useState("");
      const [sessions, setSessions] = React.useState([]);
      const [sessionKey, setSessionKey] = React.useState("");
      const [messages, setMessages] = React.useState([]);
      const [input, setInput] = React.useState("");
      const [status, setStatus] = React.useState("");
      const [needsAuth, setNeedsAuth] = React.useState(false);
      const [authBusy, setAuthBusy] = React.useState(false);
      const [authUrl, setAuthUrl] = React.useState("");
      const [deviceInfo, setDeviceInfo] = React.useState(null);
      const [deviceBusy, setDeviceBusy] = React.useState(false);
      const [sessionKind, setSessionKind] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      const [reload, setReload] = React.useState(0);
      const [tick, setTick] = React.useState(0);
      const bottomRef = React.useRef(null);
      const listRef = React.useRef(null);
      const stickRef = React.useRef(true);
      const startedAtRef = React.useRef(0);

      React.useEffect(() => localStorage.setItem(STORAGE_URL, bridge), [bridge]);
      React.useEffect(() => localStorage.setItem("tnode.env", env), [env]);
      React.useEffect(() => {
        if (!busy) return;
        const timer = setInterval(() => setTick((value) => value + 1), 1000);
        return () => clearInterval(timer);
      }, [busy]);

      React.useEffect(() => {
        if (stickRef.current) bottomRef.current?.scrollIntoView?.({ block: "end" });
      }, [messages, tick]);

      React.useEffect(() => {
        if (!bridge) return;
        let cancelled = false;
        const check = async () => {
          try {
            const response = await fetch(`${bridge.replace(/\/$/, "")}/health`, { cache: "no-store" });
            if (!cancelled) setOnline(response.ok);
          } catch {
            if (!cancelled) setOnline(false);
          }
        };
        void check();
        const timer = setInterval(check, 5000);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      }, [bridge]);

      React.useEffect(() => {
        if (!needsAuth) return;
        let cancelled = false;
        const check = async () => {
          try {
            const response = await fetch(`${bridge.replace(/\/$/, "")}/api/auth/status?env=${env}`, { cache: "no-store" });
            const data = await response.json();
            if (cancelled) return;
            if (data.authenticated) {
              setNeedsAuth(false);
              setAuthUrl("");
              setStatus("");
              setReload((value) => value + 1);
            } else {
              if (data.url) setAuthUrl(data.url);
              if (data.error) setStatus(data.error);
            }
          } catch {
            // bridge caído; el poll de health lo muestra
          }
        };
        void check();
        const timer = setInterval(check, 2000);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      }, [needsAuth, bridge, env]);

      React.useEffect(() => {
        if (!needsAuth || !deviceInfo) return;
        let cancelled = false;
        const poll = async () => {
          try {
            const response = await fetch(`${bridge.replace(/\/$/, "")}/api/auth/device/poll`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ env }),
            });
            const data = await response.json();
            if (cancelled) return;
            if (data.status === "approved") {
              setDeviceInfo(null);
              setNeedsAuth(false);
              setStatus("");
              setReload((value) => value + 1);
            } else if (data.status === "denied") {
              setStatus("La app rechazó la conexión.");
              setDeviceInfo(null);
            } else if (data.status === "expired") {
              setStatus("El código expiró; genera uno nuevo.");
              setDeviceInfo(null);
            }
          } catch {
            // reintenta en el siguiente tick
          }
        };
        void poll();
        const timer = setInterval(poll, 5000);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      }, [needsAuth, deviceInfo, bridge, env]);

      async function connectDevice() {
        setDeviceBusy(true);
        setStatus("Generando código…");
        try {
          const response = await fetch(`${bridge.replace(/\/$/, "")}/api/auth/device/start`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ env }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
          setDeviceInfo(data);
          setStatus("En la app: Tu → Conectar harness → escribe el código.");
        } catch (error) {
          setStatus(`No pude generar el código: ${error.message}`);
        } finally {
          setDeviceBusy(false);
        }
      }

      async function connectGoogle() {
        setAuthBusy(true);
        setStatus("Abriendo Google…");
        try {
          const response = await fetch(`${bridge.replace(/\/$/, "")}/api/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ env }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
          if (data.url) setAuthUrl(data.url);
          setStatus("Completa el login en el navegador…");
        } catch (error) {
          setStatus(`No pude iniciar sesión: ${error.message}`);
        } finally {
          setAuthBusy(false);
        }
      }

      React.useEffect(() => {
        let cancelled = false;
        setStatus("Cargando nodos…");
        fetch(`${bridge.replace(/\/$/, "")}/api/nodes?env=${env}`)
          .then(async (response) => {
            if (response.status === 401) throw new Error("auth_required");
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((data) => {
            if (cancelled) return;
            setNeedsAuth(false);
            setSessionKind(data.session?.kind || "");
            const available = data.nodes || [];
            setNodes(available);
            setNodeId((current) => {
              if (available.some((node) => node.id === current)) return current;
              return available.find((node) => node.name === "TSporty")?.id ?? available[0]?.id ?? "";
            });
          })
          .catch((error) => {
            if (cancelled) return;
            if (error.message === "auth_required") {
              setNeedsAuth(true);
              setStatus("");
            } else {
              setStatus(`No pude cargar nodos: ${error.message}`);
            }
          });
        return () => {
          cancelled = true;
        };
      }, [bridge, env, reload]);

      React.useEffect(() => {
        if (!nodeId) return;
        let cancelled = false;
        fetch(`${bridge.replace(/\/$/, "")}/api/sessions?env=${env}&nodeId=${nodeId}`)
          .then(async (response) => {
            if (response.status === 401) throw new Error("auth_required");
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((data) => {
            if (cancelled) return;
            const list = data.sessions || [];
            setSessions(list);
            const current = list.find((item) => item.sessionKey === sessionKey);
            const chosen = current || list[0];
            if (chosen) {
              setSessionKey(chosen.sessionKey);
              setMessages((chosen.messages || []).map((message) => ({ role: message.role, text: message.content })));
            } else {
              setSessionKey(`agent:main:tnode-mobile-${crypto.randomUUID()}`);
              setMessages([]);
            }
            setStatus("");
          })
          .catch((error) => {
            if (cancelled) return;
            if (error.message === "auth_required") setNeedsAuth(true);
            else setStatus(`No pude cargar sesiones: ${error.message}`);
          });
        return () => {
          cancelled = true;
        };
      }, [bridge, env, nodeId, reload]);

      function openSession(key) {
        const found = sessions.find((item) => item.sessionKey === key);
        setSessionKey(key);
        setMessages(found ? found.messages.map((message) => ({ role: message.role, text: message.content })) : []);
      }

      function newSession() {
        setSessionKey(`agent:main:tnode-mobile-${crypto.randomUUID()}`);
        setMessages([]);
        setStatus("");
      }

      async function disconnectHarness() {
        if (!window.confirm("¿Desconectar este harness? Tendrás que vincularlo de nuevo.")) return;
        setStatus("Desconectando…");
        try {
          const response = await fetch(`${bridge.replace(/\/$/, "")}/api/auth/harness/disconnect`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ env }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
          setSessionKind("");
          setNodeId("");
          setNodes([]);
          setSessions([]);
          setSessionKey("");
          setMessages([]);
          setNeedsAuth(true);
          setStatus(data.revoked ? "Harness desconectado y revocado." : "Harness desconectado localmente.");
          setReload((value) => value + 1);
        } catch (error) {
          setStatus(`No pude desconectar: ${error.message}`);
        }
      }

      async function send() {
        const text = input.trim();
        if (!text || !nodeId || !sessionKey || busy) return;
        setInput("");
        setBusy(true);
        startedAtRef.current = Date.now();
        setStatus("");
        setMessages((current) => [...current, { role: "user", text }, { role: "assistant", text: "" }]);

        try {
          const response = await fetch(`${bridge.replace(/\/$/, "")}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ nodeId, env, message: text, sessionKey }),
          });
          if (response.status === 401) {
            setNeedsAuth(true);
            throw new Error("auth_required");
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          await readSse(response, ({ event, data }) => {
            if (event === "delta") {
              setMessages((current) => {
                const next = [...current];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") last.text += data.delta || "";
                return next;
              });
            } else if (event === "done") {
              setMessages((current) => {
                const next = [...current];
                const last = next[next.length - 1];
                if (last && last.role === "assistant" && data.reply) last.text = data.reply;
                return next;
              });
            } else if (event === "error") {
              setStatus(`Error: ${data.message}`);
            }
          });
        } catch (error) {
          if (error.message === "auth_required") setNeedsAuth(true);
          else {
            setOnline(false);
            setStatus(`Error: ${error.message}`);
          }
        } finally {
          setBusy(false);
        }
      }

      const box = { display: "flex", flexDirection: "column", height: "100%", gap: 8, padding: 12, color: "var(--dsh-text, #ddd)", fontSize: 13 };
      const inputStyle = { background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 8, color: "inherit", padding: "7px 9px", outline: "none" };
      const button = { background: "#3b6ef6", border: 0, borderRadius: 8, color: "#fff", padding: "7px 12px", cursor: "pointer" };
      const sessionLabel = (key) => key.replace("agent:main:", "").replace("tnode-mobile-", "m-").slice(0, 22);

      if (needsAuth) {
        return h("div", { style: box },
          h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
            h("strong", null, "TNode"),
            h("span", { style: { width: 8, height: 8, borderRadius: 4, background: online ? "#3fb950" : "#f85149" } }),
            h("span", { style: { opacity: 0.6, flex: 1 } }, `owner · ${env}`),
          ),
          h("input", { style: inputStyle, value: bridge, onChange: (event) => setBridge(event.target.value), placeholder: "http://127.0.0.1:3987" }),
          h("div", { style: { border: "1px solid rgba(255,255,255,.14)", borderRadius: 10, padding: 14, display: "grid", gap: 10 } },
            h("strong", null, "Conecta tu cuenta TNode"),
            h("div", { style: { opacity: 0.75, lineHeight: 1.45 } }, "Autoriza este harness con la misma cuenta de Google que usas en la app."),
            h("button", { style: { ...button, opacity: authBusy ? 0.6 : 1 }, disabled: authBusy, onClick: () => void connectGoogle() }, authBusy ? "Esperando…" : "Conectar con Google"),
            authUrl ? h("a", { href: authUrl, target: "_blank", rel: "noreferrer", style: { color: "#58a6ff", fontSize: 12 } }, "Abrir página de login") : null,
            h("div", { style: { borderTop: "1px solid rgba(255,255,255,.1)", opacity: 0.55, fontSize: 11, paddingTop: 8 } }, "o vincular con código"),
            deviceInfo
              ? h("div", { style: { display: "grid", gap: 6, justifyItems: "center" } },
                  deviceInfo.qr ? h("img", { src: deviceInfo.qr, width: 220, height: 220, alt: "QR para conectar el harness", style: { background: "#fff", padding: 8, borderRadius: 8 } }) : null,
                  h("div", { style: { fontSize: 26, letterSpacing: 3, fontWeight: 700, textAlign: "center", userSelect: "all" } }, deviceInfo.userCode),
                  h("div", { style: { opacity: 0.7, fontSize: 12 } }, "Abre la app → Tu → Conectar harness → escanea el QR o escribe este código."),
                )
              : h("button", { style: { ...button, background: "transparent", border: "1px solid rgba(255,255,255,.25)", opacity: deviceBusy ? 0.6 : 1 }, disabled: deviceBusy, onClick: () => void connectDevice() }, deviceBusy ? "Generando…" : "Vincular con código"),
            h("div", { style: { opacity: 0.55, fontSize: 11 } }, "Alternativa en Terminal:"),
            h("code", { style: { background: "rgba(255,255,255,.06)", padding: "8px 10px", borderRadius: 6, userSelect: "all" } }, `tnode login --env ${env}`),
            h("button", { style: { ...button, background: "transparent", border: "1px solid rgba(255,255,255,.2)" }, onClick: () => setReload((value) => value + 1) }, "Reintentar"),
          ),
          status ? h("div", { style: { color: "#f0b35b", fontSize: 12 } }, status) : null,
          !online ? h("div", { style: { color: "#f85149", fontSize: 12 } }, "Bridge offline; reintentando…") : null,
        );
      }

      return h("div", { style: box },
        h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
          h("strong", null, "TNode"),
          h("span", { style: { width: 8, height: 8, borderRadius: 4, background: online ? "#3fb950" : "#f85149" } }),
          h("span", { style: { opacity: 0.6, flex: 1 } }, "owner"),
          h("button", {
            style: { ...button, background: "transparent", border: "1px solid rgba(255,255,255,.2)" },
            onClick: () => setReload((value) => value + 1),
            title: "Reconectar/refrescar",
          }, "↻"),
        ),
        h("div", { style: { display: "grid", gap: 6 } },
          h("input", { style: inputStyle, value: bridge, onChange: (event) => setBridge(event.target.value), placeholder: "http://127.0.0.1:3987" }),
          h("div", { style: { display: "flex", gap: 6 } },
            h("select", { style: { ...inputStyle, flex: 1 }, value: env, onChange: (event) => setEnv(event.target.value) },
              h("option", { value: "beta" }, "beta"),
              h("option", { value: "prod" }, "prod"),
            ),
            h("select", { style: { ...inputStyle, flex: 2 }, value: nodeId, onChange: (event) => setNodeId(event.target.value) },
              nodes.length === 0 ? h("option", { value: "" }, "Sin nodos") : null,
              nodes.map((node) => h("option", { key: node.id, value: node.id },
                `${node.name} · ${node.kind}${node.hasTunnel ? "" : " · sin túnel"}`)),
            ),
          ),
          h("div", { style: { display: "flex", gap: 6 } },
            h("select", { style: { ...inputStyle, flex: 1 }, value: sessionKey, onChange: (event) => openSession(event.target.value) },
              sessions.length === 0 ? h("option", { value: sessionKey }, "Nueva sesión") : null,
              sessions.map((item) => h("option", { key: item.sessionKey, value: item.sessionKey },
                `${sessionLabel(item.sessionKey)} · ${item.preview?.slice(0, 24) || "sin mensajes"}`)),
            ),
            h("button", { style: { ...button, background: "transparent", border: "1px solid rgba(255,255,255,.2)" }, onClick: newSession, title: "Nueva sesión" }, "+"),
          ),
        ),
        status ? h("div", { style: { color: "#f0b35b", fontSize: 12 } }, status) : null,
        !online ? h("div", { style: { color: "#f85149", fontSize: 12 } }, "Bridge offline; reintentando…") : null,
        h("div", {
          ref: listRef,
          onScroll: (event) => {
            const el = event.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          },
          style: { flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 },
        },
          messages.length === 0 && !busy
            ? h("div", { style: { opacity: 0.45, textAlign: "center", marginTop: 24, lineHeight: 1.5 } },
                `Elige un nodo y pregúntale algo.\nHistorial y sesiones se cargan desde el nodo.`)
            : null,
          messages.map((message, index) => {
            const isLast = index === messages.length - 1;
            const streaming = busy && isLast && message.role === "assistant";
            const elapsed = Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000));
            if (streaming && !message.text) {
              return h("div", { key: index, style: { alignSelf: "flex-start", opacity: 0.6, fontStyle: "italic" } },
                `pensando… ${elapsed}s`);
            }
            return h("div", {
              key: index,
              style: {
                alignSelf: message.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "92%",
                whiteSpace: "pre-wrap",
                background: message.role === "user" ? "rgba(59,110,246,.25)" : "rgba(255,255,255,.06)",
                padding: "7px 9px",
                borderRadius: 9,
              },
            }, renderInline(message.text || "…"), streaming ? h("span", { key: "cursor", style: { opacity: 0.7 } }, "▌") : null);
          }),
          h("div", { ref: bottomRef }),
        ),
        sessionKind === "harness"
          ? h("button", {
              style: { ...button, background: "transparent", border: "1px solid rgba(248,81,73,.45)", color: "#f85149", fontSize: 12 },
              onClick: () => void disconnectHarness(),
            }, "Desconectar harness")
          : null,
        h("div", { style: { display: "flex", gap: 6 } },
          h("textarea", {
            rows: 1,
            style: { ...inputStyle, flex: 1, resize: "none", minHeight: 34, maxHeight: 120, fontFamily: "inherit" },
            value: input,
            placeholder: online ? "Mensaje… (Shift+Enter = salto de línea)" : "Bridge offline",
            onChange: (event) => setInput(event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            },
          }),
          h("button", { style: button, disabled: busy || !nodeId || !online, onClick: () => void send() }, busy ? "…" : "Enviar"),
        ),
      );
    }

    function apply(ctx) {
      ctx.sidebarRightTabs.register({
        id: "@tnode/dsh-plugin",
        kind: "tnode",
        title: () => "TNode",
        guide: [{ id: "tnode", title: () => "TNode", description: () => "Chat owner de tus nodos" }],
      });

      ctx.slots.register(
        { name: "sidebar.right.pane.tab", key: "@tnode/dsh-plugin" },
        TNodePanel,
      );
    }

    exports.apply = apply;
    exports.inject = ["slots", "sidebarRightTabs"];
    return module.exports;
  },
});
