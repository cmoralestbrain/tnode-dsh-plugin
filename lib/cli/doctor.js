import { commandVersion, which } from "./exec.js";
import { diskFreeGb } from "./state.js";
import { inspectAllServices, probePort } from "./services.js";
import { components, configPermissions, gatewayHost, gatewayPort, model, registration, skills, tunnel } from "./node-state.js";
export function summarize(checks) {
    return {
        ok: checks.filter((check) => check.status === "ok").length,
        warn: checks.filter((check) => check.status === "warn").length,
        fail: checks.filter((check) => check.status === "fail").length,
        skip: checks.filter((check) => check.status === "skip").length,
    };
}
function nodeVersionStatus(version) {
    const major = Number(version.split(".")[0]);
    const detail = `v${version}`;
    if (!Number.isFinite(major))
        return { status: "warn", detail };
    if (major >= 26)
        return { status: "ok", detail };
    if (major >= 20) {
        return { status: "warn", detail: `${detail} (el pin actual de TNode pide ≥ 26)` };
    }
    return { status: "fail", detail: `${detail} (mínimo requerido: 20)` };
}
export async function runDoctor(paths, platform) {
    const checks = [];
    checks.push({
        id: "platform",
        label: "Plataforma",
        status: platform.os === "darwin" || platform.os === "linux" ? "ok" : "fail",
        detail: `${platform.os} ${platform.arch}`,
    });
    const nodeVersion = nodeVersionStatus(process.versions.node);
    checks.push({
        id: "node",
        label: "Node.js",
        status: nodeVersion.status,
        detail: nodeVersion.detail,
        hint: nodeVersion.status === "ok" ? undefined : "Actualiza Node (nvm, brew o el installer de tnode).",
    });
    const openclawPath = which("openclaw");
    if (!openclawPath) {
        checks.push({
            id: "openclaw",
            label: "OpenClaw",
            status: "fail",
            detail: "binario no encontrado",
            hint: "Ejecuta `tnode setup` o instala OpenClaw con el pin de TNode.",
        });
    }
    else {
        const version = await commandVersion("openclaw");
        checks.push({
            id: "openclaw",
            label: "OpenClaw",
            status: version ? "ok" : "warn",
            detail: version ?? `en ${openclawPath}, sin versión`,
        });
    }
    const host = gatewayHost(paths);
    const port = gatewayPort(paths);
    const listening = await probePort(host, port);
    if (!openclawPath) {
        checks.push({ id: "gateway", label: "Gateway", status: "skip", detail: "sin binario de OpenClaw" });
    }
    else if (listening) {
        checks.push({ id: "gateway", label: "Gateway", status: "ok", detail: `${host}:${port} escuchando` });
    }
    else {
        checks.push({
            id: "gateway",
            label: "Gateway",
            status: "fail",
            detail: `sin respuesta en ${host}:${port}`,
            hint: "`openclaw gateway install` y `openclaw gateway start` (o `tnode setup`).",
        });
    }
    const tunnelInfo = tunnel(paths);
    checks.push({
        id: "tunnel",
        label: "Túnel",
        status: tunnelInfo.domain ? "ok" : "warn",
        detail: tunnelInfo.domain ?? (tunnelInfo.present ? "tunnel.json sin dominio" : "sin túnel (LAN/Tailscale)"),
        hint: tunnelInfo.domain ? undefined : "El túnel es opcional; sin él la app necesita LAN o Tailscale.",
    });
    const reg = registration(paths);
    const regStatus = reg.present && reg.hasSecret && reg.hasPullUrl ? "ok" : reg.present ? "warn" : "warn";
    checks.push({
        id: "registration",
        label: "Registro del nodo",
        status: regStatus,
        detail: reg.present
            ? `${reg.nodeId ?? "sin id"}${reg.hasSecret ? "" : " · falta nodeSecret"}${reg.hasPullUrl ? "" : " · falta pullUrl"}`
            : "sin tnode-chat-sync.json",
        hint: regStatus === "ok" ? undefined : "Vuelve a correr el setup o revisa el emparejamiento.",
    });
    const services = await inspectAllServices(paths, platform);
    const installed = services.filter((service) => service.installed);
    const inactive = installed.filter((service) => !service.running);
    if (installed.length === 0) {
        checks.push({
            id: "daemons",
            label: "Daemons",
            status: "warn",
            detail: "ninguno instalado",
            hint: "En un nodo completo deberían existir chat-sync, config-sync y pair-watch.",
        });
    }
    else if (inactive.length > 0) {
        checks.push({
            id: "daemons",
            label: "Daemons",
            status: "fail",
            detail: `inactivos: ${inactive.map((service) => service.id).join(", ")}`,
            hint: "Revisa `tnode logs <daemon>` y reinicia el servicio.",
        });
    }
    else {
        checks.push({ id: "daemons", label: "Daemons", status: "ok", detail: `${installed.length} activos` });
    }
    const modelInfo = model(paths);
    checks.push({
        id: "model",
        label: "Modelo",
        status: modelInfo.configured ? "ok" : "warn",
        detail: modelInfo.current ?? (modelInfo.configured ? `${modelInfo.count} configurados` : "sin modelo configurado"),
        hint: modelInfo.configured ? undefined : "Sin modelo, la app falla al primer mensaje. Configúralo en la app.",
    });
    const skillsInfo = skills(paths);
    checks.push({
        id: "skills",
        label: "Skills",
        status: skillsInfo.cached > 0 ? "ok" : "warn",
        detail: `${skillsInfo.cached} en cache · ${skillsInfo.workspace} en workspace · catálogo ${skillsInfo.catalog}`,
        hint: skillsInfo.cached > 0 ? undefined : "`tnode skills fetch` para bajar el catálogo.",
    });
    const free = await diskFreeGb(paths.openclawHome);
    checks.push({
        id: "disk",
        label: "Disco",
        status: free === null ? "skip" : free >= 2 ? "ok" : free >= 1 ? "warn" : "fail",
        detail: free === null ? "no disponible" : `${free.toFixed(1)} GB libres`,
        hint: free !== null && free < 2 ? "Los modelos locales necesitan varios GB." : undefined,
    });
    const perms = configPermissions(paths);
    checks.push({
        id: "permissions",
        label: "Permisos",
        status: perms.mode === null ? "skip" : perms.groupOrWorldReadable ? "warn" : "ok",
        detail: perms.mode === null ? "sin openclaw.json" : `openclaw.json ${perms.mode}`,
        hint: perms.groupOrWorldReadable ? "chmod 600 ~/.openclaw/openclaw.json" : undefined,
    });
    const componentList = components(paths);
    if (componentList.length > 0) {
        const outdated = componentList.filter((component) => component.version === "unknown");
        checks.push({
            id: "components",
            label: "Componentes",
            status: outdated.length > 0 ? "warn" : "ok",
            detail: `${componentList.length} registrados${outdated.length ? ` · ${outdated.length} sin versión` : ""}`,
            hint: outdated.length ? "Reinstala con `tnode update --scope full`." : undefined,
        });
    }
    return { platform, checks, summary: summarize(checks) };
}
/** Para tests: evalúa el status sin tocar la red. */
export function checkExitCode(report) {
    return report.summary.fail > 0 ? 1 : 0;
}
//# sourceMappingURL=doctor.js.map