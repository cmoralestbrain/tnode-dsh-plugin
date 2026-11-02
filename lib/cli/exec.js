import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
const EXTRA_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
function searchPath(env) {
    const parts = new Set((env.PATH ?? "").split(delimiter).filter(Boolean));
    for (const dir of EXTRA_PATHS)
        parts.add(dir);
    return [...parts].join(delimiter);
}
/** Ejecuta y captura stdout/stderr. No lanza en exit code distinto de 0. */
export function run(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
        const env = { ...process.env, ...options.env, PATH: searchPath({ ...process.env, ...options.env }) };
        const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        let timer;
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        if (child.stdin) {
            if (options.input !== undefined)
                child.stdin.end(options.input);
            else
                child.stdin.end();
        }
        if (options.timeoutMs) {
            timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
        }
        child.on("error", (err) => {
            if (timer)
                clearTimeout(timer);
            reject(err);
        });
        child.on("close", (code) => {
            if (timer)
                clearTimeout(timer);
            resolve({ code: code ?? 1, stdout, stderr });
        });
    });
}
/** Ejecuta heredando stdio (para comandos interactivos como el installer). */
export function runStream(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
        const env = { ...process.env, ...options.env, PATH: searchPath({ ...process.env, ...options.env }) };
        const child = spawn(command, args, { env, stdio: "inherit" });
        child.on("error", reject);
        child.on("close", (code) => resolve(code ?? 1));
    });
}
export function which(command, env = process.env) {
    if (command.includes("/")) {
        return isExecutable(command) ? command : null;
    }
    for (const dir of searchPath(env).split(delimiter)) {
        if (!dir)
            continue;
        const candidate = join(dir, command);
        if (isExecutable(candidate))
            return candidate;
    }
    return null;
}
function isExecutable(path) {
    try {
        accessSync(path, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
export async function commandVersion(command, args = ["--version"]) {
    if (!which(command))
        return null;
    try {
        const result = await run(command, args, { timeoutMs: 8000 });
        if (result.code !== 0)
            return null;
        const text = `${result.stdout}\n${result.stderr}`.trim();
        return text.split("\n")[0]?.trim() || null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=exec.js.map