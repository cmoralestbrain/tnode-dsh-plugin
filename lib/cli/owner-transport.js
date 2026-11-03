import { randomUUID } from "node:crypto";
import { WebSocketConnection } from "./websocket.js";
export class OwnerTransport {
    options;
    connection;
    pending;
    constructor(options) {
        this.options = options;
    }
    async connect() {
        if (this.connection)
            return;
        const connection = await WebSocketConnection.connect(`wss://${this.options.host}/transport`, { Authorization: `Bearer ${this.options.idToken}` }, this.options.connectTimeoutMs ?? 15_000);
        connection.setHandlers({
            onMessage: (text) => this.handle(text),
            onClose: (code) => {
                this.connection = undefined;
                this.settleOnClose(code);
            },
            onError: (error) => {
                this.connection = undefined;
                this.fail(error);
            },
        });
        this.connection = connection;
    }
    async turn(text, options = {}) {
        if (this.pending)
            throw new Error("ya hay un turno en curso");
        await this.connect();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending = undefined;
                reject(new Error("timeout del turno owner"));
            }, options.timeoutMs ?? 120_000);
            this.pending = { resolve, reject, timer, reply: "", runId: null, onDelta: options.onDelta };
            this.connection?.send(JSON.stringify({
                type: "turn",
                sessionKey: this.options.sessionKey,
                text,
                clientMsgId: randomUUID(),
            }));
        });
    }
    close() {
        this.connection?.close();
        this.connection = undefined;
        this.fail(new Error("transporte cerrado"));
    }
    handle(text) {
        let frame;
        try {
            frame = JSON.parse(text);
        }
        catch {
            return;
        }
        const pending = this.pending;
        if (!pending)
            return;
        switch (frame.type) {
            case "ack":
                pending.runId = typeof frame.runId === "string" ? frame.runId : null;
                return;
            case "delta": {
                const delta = typeof frame.delta === "string" ? frame.delta : "";
                if (!delta)
                    return;
                pending.reply += delta;
                pending.onDelta?.(delta);
                return;
            }
            case "done": {
                clearTimeout(pending.timer);
                this.pending = undefined;
                const final = typeof frame.text === "string" && frame.text ? frame.text : pending.reply;
                pending.resolve({
                    reply: final,
                    runId: pending.runId,
                    sessionKey: this.options.sessionKey,
                });
                return;
            }
            case "error": {
                clearTimeout(pending.timer);
                this.pending = undefined;
                pending.reject(new Error(typeof frame.message === "string" ? frame.message : "error del transporte"));
                return;
            }
            default:
                return;
        }
    }
    /** Un cierre después de recibir texto se trata como respuesta completa. */
    settleOnClose(code) {
        const pending = this.pending;
        if (pending && pending.reply) {
            clearTimeout(pending.timer);
            this.pending = undefined;
            pending.resolve({ reply: pending.reply, runId: pending.runId, sessionKey: this.options.sessionKey });
            return;
        }
        this.fail(new Error(`transporte cerrado (${code})`));
    }
    fail(error) {
        const pending = this.pending;
        if (!pending)
            return;
        clearTimeout(pending.timer);
        this.pending = undefined;
        pending.reject(error);
    }
}
//# sourceMappingURL=owner-transport.js.map