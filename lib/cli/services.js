import { createConnection } from "node:net";
import { join } from "node:path";
import { run } from "./exec.js";
import { exists } from "./state.js";
/** Servicios que instala tnode-setup. Los labels de launchd son la fuente de verdad en macOS. */
export const SERVICES = [
    {
        id: "chat-sync",
        label: "com.tbrain.tnode-chat-sync",
        systemdUnit: "tnode-chat-sync.service",
        description: "Sincroniza chats y docs con Firestore",
        logStem: "tnode-chat-sync",
    },
    {
        id: "config-sync",
        label: "com.tbrain.tnode-config-sync",
        systemdUnit: "tnode-config-sync.service",
        description: "Aplica comandos de configuración (modelo, proveedor, restart)",
        logStem: "tnode-config-sync",
    },
    {
        id: "config-sync-watch",
        label: "com.tbrain.tnode-config-sync-watch",
        systemdUnit: "tnode-config-sync-watch.service",
        description: "Espeja openclaw.json → state/current al cambiar",
        logStem: "tnode-config-sync-watch",
    },
    {
        id: "telemetry",
        label: "com.tbrain.tnode-telemetry",
        systemdUnit: "tnode-telemetry.service",
        description: "Telemetría y proxy WS del gateway",
        logStem: "tnode-telemetry",
    },
    {
        id: "pair-watch",
        label: "com.tbrain.pair-watch",
        systemdUnit: "pair-watch.path",
        description: "Auto-aprueba emparejamientos de dispositivos",
        logStem: "pair-watch",
    },
];
export function plistPath(paths, label) {
    return join(paths.home, "Library", "LaunchAgents", `${label}.plist`);
}
export function systemdUnitPath(paths, unit) {
    return join(paths.home, ".config", "systemd", "user", unit);
}
export async function inspectService(paths, platform, spec) {
    if (platform.os === "darwin") {
        const installed = exists(plistPath(paths, spec.label));
        if (!installed) {
            return { ...spec, installed: false, loaded: false, running: false, detail: "plist no instalado" };
        }
        const result = await run("launchctl", ["print", `gui/${process.getuid?.() ?? 501}/${spec.label}`], { timeoutMs: 5000 });
        if (result.code !== 0) {
            return { ...spec, installed: true, loaded: false, running: false, detail: "no cargado" };
        }
        const state = /state = ([a-z ]+)/.exec(result.stdout)?.[1]?.trim() ?? "cargado";
        const running = /state = running|pid = \d+/.test(result.stdout);
        // pair-watch es un watcher de WatchPaths: "waiting" es su estado sano.
        const watching = spec.id === "pair-watch" && state === "waiting";
        return {
            ...spec,
            installed: true,
            loaded: true,
            running: running || watching,
            detail: state,
        };
    }
    if (platform.os === "linux") {
        const userUnit = systemdUnitPath(paths, spec.systemdUnit);
        const systemUnit = `/etc/systemd/system/${spec.systemdUnit}`;
        const systemScope = exists(systemUnit);
        const installed = systemScope || exists(userUnit);
        const args = systemScope ? ["is-active", spec.systemdUnit] : ["--user", "is-active", spec.systemdUnit];
        const result = await run("systemctl", args, { timeoutMs: 5000 });
        const state = result.stdout.trim();
        const active = state === "active";
        return {
            ...spec,
            installed,
            loaded: installed,
            running: active,
            detail: state || (installed ? "desconocido" : "unit no instalada"),
        };
    }
    return { ...spec, installed: false, loaded: false, running: false, detail: "sistema no soportado" };
}
export async function inspectAllServices(paths, platform) {
    return Promise.all(SERVICES.map((spec) => inspectService(paths, platform, spec)));
}
/** Comprueba si hay algo escuchando en host:port (gateway local). */
export function probePort(host, port, timeoutMs = 900) {
    return new Promise((resolve) => {
        const socket = createConnection({ host, port });
        const done = (value) => {
            socket.destroy();
            resolve(value);
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => done(true));
        socket.once("timeout", () => done(false));
        socket.once("error", () => done(false));
    });
}
//# sourceMappingURL=services.js.map