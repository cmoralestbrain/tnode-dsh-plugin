import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./credentials.js";
const DEFAULT_LIMIT = 200;
export function historyPath() {
    return join(configDir(), "history");
}
export function loadHistory(limit = DEFAULT_LIMIT) {
    try {
        return readFileSync(historyPath(), "utf8")
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .slice(-limit);
    }
    catch {
        return [];
    }
}
export function appendHistory(line, limit = DEFAULT_LIMIT) {
    const value = line.trim();
    if (!value || /^(salir|exit|quit)$/i.test(value))
        return;
    const lines = loadHistory(limit);
    if (lines[lines.length - 1] === value)
        return;
    lines.push(value);
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(historyPath(), `${lines.slice(-limit).join("\n")}\n`, { mode: 0o600 });
    chmodSync(historyPath(), 0o600);
}
//# sourceMappingURL=history.js.map