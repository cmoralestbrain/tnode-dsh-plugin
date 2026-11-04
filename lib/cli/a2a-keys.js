import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./credentials.js";
export function a2aKeysPath() {
    return join(configDir(), "a2a-keys.json");
}
function read() {
    try {
        const parsed = JSON.parse(readFileSync(a2aKeysPath(), "utf8"));
        return parsed.keys ? parsed : { version: 1, keys: {} };
    }
    catch {
        return { version: 1, keys: {} };
    }
}
function write(file) {
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(a2aKeysPath(), `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    chmodSync(a2aKeysPath(), 0o600);
}
export function getA2aKey(host) {
    return read().keys[host]?.key ?? null;
}
export function setA2aKey(host, key, label) {
    const file = read();
    file.keys[host] = { key, ...(label ? { label } : {}), updatedAt: new Date().toISOString() };
    write(file);
}
export function removeA2aKey(host) {
    const file = read();
    if (!file.keys[host])
        return false;
    delete file.keys[host];
    write(file);
    return true;
}
export function listA2aKeys() {
    return Object.entries(read().keys).map(([host, entry]) => ({ host, label: entry.label, updatedAt: entry.updatedAt }));
}
//# sourceMappingURL=a2a-keys.js.map