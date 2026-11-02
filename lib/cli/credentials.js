import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { UsageError } from "./args.js";
export function configDir() {
    const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    return join(base, "tnode");
}
export function credentialsPath() {
    return join(configDir(), "credentials.json");
}
function readFile() {
    try {
        const parsed = JSON.parse(readFileSync(credentialsPath(), "utf8"));
        if (!parsed || typeof parsed !== "object")
            return null;
        if ("environments" in parsed && parsed.version === 2) {
            return parsed;
        }
        // Migración v1 (una sola sesión) → v2.
        const legacy = parsed;
        if (!legacy.refreshToken || !legacy.uid)
            return null;
        const env = legacy.env ?? "prod";
        return { version: 2, activeEnv: env, environments: { [env]: legacy } };
    }
    catch {
        return null;
    }
}
function writeFile(file) {
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    const target = credentialsPath();
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, target);
}
export function loadCredentials(env) {
    const file = readFile();
    if (!file)
        return null;
    const name = env ?? file.activeEnv;
    const credentials = file.environments[name];
    if (!credentials)
        return null;
    return { ...credentials, env: name };
}
export function saveCredentials(credentials) {
    const file = readFile() ?? { version: 2, activeEnv: credentials.env, environments: {} };
    file.environments[credentials.env] = credentials;
    file.activeEnv = credentials.env;
    writeFile(file);
}
/** Sin `env` borra todas las sesiones; con `env` solo esa. */
export function clearCredentials(env) {
    const file = readFile();
    if (!file)
        return false;
    if (!env) {
        try {
            unlinkSync(credentialsPath());
            return true;
        }
        catch {
            return false;
        }
    }
    if (!file.environments[env])
        return false;
    delete file.environments[env];
    const remaining = Object.keys(file.environments);
    if (remaining.length === 0) {
        try {
            unlinkSync(credentialsPath());
        }
        catch {
            /* noop */
        }
        return true;
    }
    file.activeEnv = remaining.includes(file.activeEnv) ? file.activeEnv : remaining[0];
    writeFile(file);
    return true;
}
export function listEnvironments() {
    const file = readFile();
    if (!file)
        return [];
    return Object.keys(file.environments).map((env) => ({
        env,
        email: file.environments[env]?.email ?? "",
        uid: file.environments[env]?.uid ?? "",
        active: file.activeEnv === env,
    }));
}
export function requireCredentials(env) {
    const credentials = loadCredentials(env);
    if (!credentials) {
        throw new UsageError(env ? `No hay sesión en ${env}` : "No hay sesión de TNode", env ? `Ejecuta \`tnode login --env ${env}\`.` : "Ejecuta `tnode login`.");
    }
    return credentials;
}
//# sourceMappingURL=credentials.js.map