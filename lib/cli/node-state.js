import { join } from "node:path";
import { countFiles, fileMode, readJson, statSafe } from "./state.js";
export function readOpenclawConfig(paths) {
    return readJson(paths.configFile);
}
export function gatewayPort(paths) {
    const config = readOpenclawConfig(paths);
    const port = config?.gateway?.port;
    return typeof port === "number" && port > 0 ? port : 18789;
}
export function gatewayHost(paths) {
    const config = readOpenclawConfig(paths);
    return config?.gateway?.host ?? "127.0.0.1";
}
export function components(paths) {
    const manifest = readJson(paths.componentsManifest);
    if (!Array.isArray(manifest?.components))
        return [];
    return manifest.components
        .filter((item) => Boolean(item) && typeof item === "object")
        .map((item) => ({
        id: String(item.id ?? "desconocido"),
        version: String(item.version ?? "unknown"),
        kind: typeof item.kind === "string" ? item.kind : undefined,
    }));
}
export function registration(paths) {
    const data = readJson(paths.registrationFile);
    const nodeId = (typeof data?.nodeId === "string" && data.nodeId) ||
        (typeof data?.node_id === "string" && data.node_id) ||
        (typeof data?.id === "string" && data.id) ||
        null;
    return {
        present: Boolean(data),
        nodeId,
        hasSecret: Boolean(data?.nodeSecret ?? data?.node_secret),
        hasPullUrl: Boolean(data?.pullUrl ?? data?.pull_url),
        path: paths.registrationFile,
    };
}
export function tunnel(paths) {
    const data = readJson(paths.tunnelFile);
    const domain = (typeof data?.domain === "string" && data.domain) ||
        (typeof data?.hostname === "string" && data.hostname) ||
        null;
    const tunnelId = typeof data?.tunnelId === "string" ? data.tunnelId : null;
    const nodeId = typeof data?.nodeId === "string" ? data.nodeId : null;
    return { present: Boolean(data), domain, tunnelId, nodeId };
}
function primaryOf(entry) {
    if (!entry)
        return null;
    if (typeof entry.model === "string" && entry.model.trim())
        return entry.model;
    if (entry.model && typeof entry.model === "object" && typeof entry.model.primary === "string") {
        return entry.model.primary;
    }
    return null;
}
/** Extrae el modelo efectivo: agents.entries.<id>.model.primary, agents.list[], defaults o allowlist. */
export function model(paths) {
    const config = readOpenclawConfig(paths);
    const agents = config?.agents;
    const defaults = agents?.defaults;
    const models = defaults?.models && typeof defaults.models === "object" ? Object.keys(defaults.models) : [];
    let current = null;
    if (agents?.entries && typeof agents.entries === "object") {
        for (const entry of Object.values(agents.entries)) {
            current = primaryOf(entry);
            if (current)
                break;
        }
    }
    if (!current && Array.isArray(agents?.list)) {
        for (const entry of agents.list) {
            current = primaryOf(entry);
            if (current)
                break;
        }
    }
    if (!current && typeof defaults?.model === "string" && defaults.model.trim()) {
        current = defaults.model;
    }
    if (!current && models.length > 0)
        current = models[0] ?? null;
    const providers = config?.models?.providers;
    const providerCount = providers && typeof providers === "object" ? Object.keys(providers).length : 0;
    const count = Math.max(models.length, providerCount);
    return { configured: Boolean(current) || count > 0, current, count };
}
export function skills(paths) {
    const cached = countFiles(paths.skillsCacheDir, (name) => name.endsWith(".tgz"));
    const workspace = countFiles(join(paths.workspaceDir, "skills"));
    const catalog = readJson(paths.skillsCatalog);
    const catalogSkills = catalog?.skills;
    const catalogCount = Array.isArray(catalogSkills)
        ? catalogSkills.length
        : catalogSkills && typeof catalogSkills === "object"
            ? Object.keys(catalogSkills).length
            : 0;
    return { cached, workspace, catalog: catalogCount };
}
export function configPermissions(paths) {
    const stat = statSafe(paths.configFile);
    if (!stat)
        return { mode: null, groupOrWorldReadable: false };
    return { mode: fileMode(paths.configFile), groupOrWorldReadable: (stat.mode & 0o077) !== 0 };
}
//# sourceMappingURL=node-state.js.map