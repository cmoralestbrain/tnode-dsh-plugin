import { randomBytes } from "node:crypto";
import { connect as tlsConnect } from "node:tls";
/** Encode a client frame (always masked). */
export function encodeFrame(opcode, payload, mask = true) {
    const length = payload.length;
    const maskBit = mask ? 0x80 : 0;
    let header;
    if (length < 126) {
        header = Buffer.from([0x80 | opcode, maskBit | length]);
    }
    else if (length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = maskBit | 126;
        header.writeUInt16BE(length, 2);
    }
    else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = maskBit | 127;
        header.writeBigUInt64BE(BigInt(length), 2);
    }
    if (!mask)
        return Buffer.concat([header, payload]);
    const key = randomBytes(4);
    const masked = Buffer.alloc(length);
    for (let i = 0; i < length; i += 1)
        masked[i] = payload[i] ^ key[i % 4];
    return Buffer.concat([header, key, masked]);
}
/** Decode as many complete frames from `input` as possible. */
export function decodeFrames(input) {
    const frames = [];
    let offset = 0;
    while (offset + 2 <= input.length) {
        const b0 = input[offset];
        const b1 = input[offset + 1];
        const fin = (b0 & 0x80) !== 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let length = b1 & 0x7f;
        let cursor = offset + 2;
        if (length === 126) {
            if (cursor + 2 > input.length)
                break;
            length = input.readUInt16BE(cursor);
            cursor += 2;
        }
        else if (length === 127) {
            if (cursor + 8 > input.length)
                break;
            const big = input.readBigUInt64BE(cursor);
            if (big > BigInt(Number.MAX_SAFE_INTEGER))
                throw new Error("frame demasiado grande");
            length = Number(big);
            cursor += 8;
        }
        let key;
        if (masked) {
            if (cursor + 4 > input.length)
                break;
            key = input.subarray(cursor, cursor + 4);
            cursor += 4;
        }
        if (cursor + length > input.length)
            break;
        const payload = Buffer.from(input.subarray(cursor, cursor + length));
        if (key)
            for (let i = 0; i < payload.length; i += 1)
                payload[i] = payload[i] ^ key[i % 4];
        frames.push({ fin, opcode, payload });
        offset = cursor + length;
    }
    return { frames, rest: input.subarray(offset) };
}
/** Minimal wss client with custom headers (Authorization) and no dependencies. */
export class WebSocketConnection {
    socket;
    handlers;
    buffer = Buffer.alloc(0);
    fragments = [];
    closed = false;
    constructor(socket, handlers) {
        this.socket = socket;
        this.handlers = handlers;
        socket.on("data", (chunk) => this.consume(chunk));
        socket.on("error", (error) => handlers.onError(error));
        socket.on("close", () => {
            if (!this.closed) {
                this.closed = true;
                handlers.onClose(1006);
            }
        });
    }
    static async connect(url, headers, timeoutMs = 15_000) {
        const parsed = new URL(url);
        if (parsed.protocol !== "wss:")
            throw new Error("solo wss:// está soportado");
        const host = parsed.hostname;
        const path = `${parsed.pathname}${parsed.search}`;
        const socket = tlsConnect({ host, port: 443, servername: host });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("timeout de conexión TLS")), timeoutMs);
            socket.once("secureConnect", () => {
                clearTimeout(timer);
                resolve();
            });
            socket.once("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
        const key = randomBytes(16).toString("base64");
        const lines = [
            `GET ${path} HTTP/1.1`,
            `Host: ${host}`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Key: ${key}`,
            "Sec-WebSocket-Version: 13",
            ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
            "",
            "",
        ];
        socket.write(lines.join("\r\n"));
        let handshake = Buffer.alloc(0);
        const rest = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("timeout del handshake WS")), timeoutMs);
            const onData = (chunk) => {
                handshake = Buffer.concat([handshake, chunk]);
                const end = handshake.indexOf("\r\n\r\n");
                if (end === -1)
                    return;
                clearTimeout(timer);
                socket.off("data", onData);
                const head = handshake.subarray(0, end).toString("utf8");
                const status = Number(head.split("\r\n")[0]?.split(" ")[1] ?? 0);
                if (status !== 101) {
                    reject(new Error(`handshake WS rechazado (HTTP ${status})`));
                    return;
                }
                resolve(handshake.subarray(end + 4));
            };
            socket.on("data", onData);
            socket.once("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
        const connection = new WebSocketConnection(socket, {
            onMessage: () => undefined,
            onClose: () => undefined,
            onError: () => undefined,
        });
        connection.buffer = rest;
        return connection;
    }
    setHandlers(handlers) {
        Object.assign(this.handlers, handlers);
        if (this.buffer.length > 0)
            this.consume(Buffer.alloc(0));
    }
    send(text) {
        if (this.socket.destroyed)
            throw new Error("socket cerrado");
        this.socket.write(encodeFrame(0x1, Buffer.from(text, "utf8")));
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        try {
            this.socket.write(encodeFrame(0x8, Buffer.alloc(0)));
        }
        catch {
            // ignore
        }
        this.socket.end();
    }
    consume(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        let decoded;
        try {
            decoded = decodeFrames(this.buffer);
        }
        catch (error) {
            this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
            return;
        }
        this.buffer = decoded.rest;
        for (const frame of decoded.frames) {
            if (frame.opcode === 0x1 || frame.opcode === 0x2 || frame.opcode === 0x0) {
                this.fragments.push(frame.payload);
                if (frame.fin) {
                    const text = Buffer.concat(this.fragments).toString("utf8");
                    this.fragments = [];
                    this.handlers.onMessage(text);
                }
                continue;
            }
            if (frame.opcode === 0x8) {
                this.closed = true;
                this.socket.end();
                this.handlers.onClose(frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1000);
                continue;
            }
            if (frame.opcode === 0x9) {
                try {
                    this.socket.write(encodeFrame(0xa, frame.payload));
                }
                catch {
                    // ignore
                }
            }
        }
    }
}
//# sourceMappingURL=websocket.js.map