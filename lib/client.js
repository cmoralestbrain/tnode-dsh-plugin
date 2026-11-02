window.__ModuleLoader__.load({
  id: "@tnode/dsh-plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require("react");
    const h = React.createElement;

    const STORAGE_URL = "tnode.bridge.url";
    const STORAGE_TOKEN = "tnode.bridge.token";

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
      const [busy, setBusy] = React.useState(false);
      const [reload, setReload] = React.useState(0);
      const bottomRef = React.useRef(null);

      React.useEffect(() => localStorage.setItem(STORAGE_URL, bridge), [bridge]);
      React.useEffect(() => localStorage.setItem("tnode.env", env), [env]);
      React.useEffect(() => {
        bottomRef.current?.scrollIntoView?.({ block: "end" });
      }, [messages]);

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
        let cancelled = false;
        setStatus("Cargando nodos…");
        fetch(`${bridge.replace(/\/$/, "")}/api/nodes?env=${env}`)
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((data) => {
            if (cancelled) return;
            const available = data.nodes || [];
            setNodes(available);
            setNodeId((current) => {
              if (available.some((node) => node.id === current)) return current;
              return available.find((node) => node.name === "TSporty")?.id ?? available[0]?.id ?? "";
            });
          })
          .catch((error) => {
            if (!cancelled) setStatus(`No pude cargar nodos: ${error.message}`);
          });
        return () => {
          cancelled = true;
        };
      }, [bridge, token, env, reload]);

      React.useEffect(() => {
        if (!nodeId) return;
        let cancelled = false;
        fetch(`${bridge.replace(/\/$/, "")}/api/sessions?env=${env}&nodeId=${nodeId}`)
          .then(async (response) => {
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
            if (!cancelled) setStatus(`No pude cargar sesiones: ${error.message}`);
          });
        return () => {
          cancelled = true;
        };
      }, [bridge, token, env, nodeId, reload]);

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

      async function send() {
        const text = input.trim();
        if (!text || !nodeId || !sessionKey || busy) return;
        setInput("");
        setBusy(true);
        setStatus("");
        setMessages((current) => [...current, { role: "user", text }, { role: "assistant", text: "" }]);

        try {
          const response = await fetch(`${bridge.replace(/\/$/, "")}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ nodeId, env, message: text, sessionKey }),
          });
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
          setOnline(false);
          setStatus(`Error: ${error.message}`);
        } finally {
          setBusy(false);
        }
      }

      const box = { display: "flex", flexDirection: "column", height: "100%", gap: 8, padding: 12, color: "var(--dsh-text, #ddd)", fontSize: 13 };
      const inputStyle = { background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 8, color: "inherit", padding: "7px 9px", outline: "none" };
      const button = { background: "#3b6ef6", border: 0, borderRadius: 8, color: "#fff", padding: "7px 12px", cursor: "pointer" };
      const sessionLabel = (key) => key.replace("agent:main:", "").replace("tnode-mobile-", "m-").slice(0, 22);

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
        h("div", { style: { flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 } },
          messages.map((message, index) => h("div", {
            key: index,
            style: {
              alignSelf: message.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "92%",
              whiteSpace: "pre-wrap",
              background: message.role === "user" ? "rgba(59,110,246,.25)" : "rgba(255,255,255,.06)",
              padding: "7px 9px",
              borderRadius: 9,
            },
          }, message.text || "…")),
          h("div", { ref: bottomRef }),
        ),
        h("div", { style: { display: "flex", gap: 6 } },
          h("input", {
            style: { ...inputStyle, flex: 1 },
            value: input,
            placeholder: online ? "Mensaje…" : "Bridge offline",
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
