import { UsageError, flagBool, flagString } from "./args.js";
import { components, gatewayHost, gatewayPort, registration, tunnel } from "./node-state.js";
import { probeHttps } from "./net.js";
import { inspectAllServices, probePort } from "./services.js";
/** Componente del installer → servicios que deben quedar activos. */
export const COMPONENT_SERVICE_IDS = {
    "openclaw-gateway": [],
    "tnode-chat-sync": ["chat-sync"],
    "tnode-config-sync": ["config-sync"],
    "tnode-telemetry": ["telemetry"],
    "pair-watch": ["pair-watch"],
    cloudflared: [],
};
export function parseWaitOptions(flags) {
    if (!flagBool(flags, "wait"))
        return null;
    const timeoutSec = Number(flagString(flags, "timeout") ?? 600);
    const intervalSec = Number(flagString(flags, "interval") ?? 5);
    const waitFor = (flagString(flags, "wait-for") ?? "all");
    if (!Number.isFinite(timeoutSec) || timeoutSec < 1) {
        throw new UsageError("--timeout inválido", "Especifica segundos, mínimo 1.");
    }
    if (!Number.isFinite(intervalSec) || intervalSec < 1) {
        throw new UsageError("--interval inválido", "Especifica segundos, mínimo 1.");
    }
    if (!["gateway", "services", "all"].includes(waitFor)) {
        throw new UsageError(`--wait-for inválido: ${waitFor}`, "Valores: gateway, services, all.");
    }
    return {
        timeoutMs: Math.round(timeoutSec * 1000),
        intervalMs: Math.round(intervalSec * 1000),
        waitFor,
    };
}
async function evaluate(paths, platform, options) {
    const checks = [];
    const warnings = [];
    const component = options.component;
    if (component) {
        if (component === "openclaw-gateway") {
            const host = gatewayHost(paths);
            const port = gatewayPort(paths);
            const up = await probePort(host, port);
            checks.push({ id: "gateway", status: up ? "ok" : "fail", detail: `${host}:${port}` });
        }
        else if (component === "cloudflared") {
            const info = tunnel(paths);
            if (!info.domain) {
                checks.push({ id: "tunnel", status: "fail", detail: "sin dominio en tunnel.json" });
            }
            else {
                const probe = await probeHttps(info.domain);
                checks.push({
                    id: "tunnel",
                    status: probe.ok ? "ok" : "fail",
                    detail: `${info.domain}${probe.status ? ` · HTTP ${probe.status}` : ""}`,
                });
            }
        }
        else {
            const targets = COMPONENT_SERVICE_IDS[component] ?? [];
            const statuses = await inspectAllServices(paths, platform);
            const selected = statuses.filter((service) => targets.includes(service.id));
            const installed = selected.filter((service) => service.installed);
            const inactive = installed.filter((service) => !service.running);
            if (installed.length === 0) {
                checks.push({ id: "service", status: "fail", detail: `${component} no instalado` });
            }
            else if (inactive.length > 0) {
                checks.push({ id: "service", status: "fail", detail: `inactivo: ${inactive.map((s) => s.id).join(", ")}` });
            }
            else {
                checks.push({ id: "service", status: "ok", detail: `${component} activo` });
            }
        }
        const manifest = components(paths);
        const match = manifest.find((item) => item.id === component);
        checks.push({
            id: "components",
            status: match ? "ok" : "fail",
            detail: match ? `${match.id} ${match.version}` : `sin entrada para ${component} en components-manifest.json`,
        });
    }
    else {
        if (options.waitFor !== "services") {
            const host = gatewayHost(paths);
            const port = gatewayPort(paths);
            const up = await probePort(host, port);
            checks.push({ id: "gateway", status: up ? "ok" : "fail", detail: `${host}:${port}` });
        }
        if (options.waitFor !== "gateway") {
            const statuses = await inspectAllServices(paths, platform);
            const installed = statuses.filter((service) => service.installed);
            const inactive = installed.filter((service) => !service.running);
            const missing = statuses.filter((service) => !service.installed);
            if (installed.length === 0) {
                checks.push({ id: "services", status: "fail", detail: "ningún daemon instalado" });
            }
            else if (inactive.length > 0) {
                checks.push({ id: "services", status: "fail", detail: `inactivos: ${inactive.map((s) => s.id).join(", ")}` });
            }
            else {
                checks.push({ id: "services", status: "ok", detail: `${installed.length} activos` });
            }
            if (missing.length > 0) {
                warnings.push(`servicios no instalados: ${missing.map((s) => s.id).join(", ")}`);
            }
        }
        if (options.waitFor === "all") {
            const manifest = components(paths);
            checks.push({
                id: "components",
                status: manifest.length > 0 ? "ok" : "fail",
                detail: `${manifest.length} componentes`,
            });
        }
    }
    if (!registration(paths).present) {
        warnings.push("sin tnode-chat-sync.json (nodo no registrado)");
    }
    const tunnelInfo = tunnel(paths);
    if (!tunnelInfo.domain) {
        warnings.push("sin túnel configurado (modo LAN/Tailscale)");
    }
    return { checks, warnings };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Espera a que el nodo quede sano: dos pasadas consecutivas sin fallos. */
export async function waitForUpdate(paths, platform, options) {
    const started = Date.now();
    let attempts = 0;
    let consecutive = 0;
    let lastChecks = [];
    let lastWarnings = [];
    for (;;) {
        attempts += 1;
        const result = await evaluate(paths, platform, options);
        lastChecks = result.checks;
        lastWarnings = result.warnings;
        if (!result.checks.some((check) => check.status === "fail")) {
            consecutive += 1;
            if (consecutive >= 2) {
                return { ok: true, attempts, waitedMs: Date.now() - started, checks: lastChecks, warnings: lastWarnings };
            }
        }
        else {
            consecutive = 0;
        }
        const elapsed = Date.now() - started;
        if (elapsed >= options.timeoutMs) {
            return { ok: false, attempts, waitedMs: elapsed, checks: lastChecks, warnings: lastWarnings };
        }
        await sleep(Math.min(options.intervalMs, Math.max(0, options.timeoutMs - elapsed)));
    }
}
//# sourceMappingURL=wait.js.map