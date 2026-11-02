import { homedir } from "node:os";
import { join } from "node:path";
export function resolvePaths(env = process.env) {
    const home = env.HOME || homedir();
    const openclawHome = env.OPENCLAW_HOME || join(home, ".openclaw");
    return {
        home,
        openclawHome,
        configFile: join(openclawHome, "openclaw.json"),
        logsDir: join(openclawHome, "logs"),
        scriptsDir: join(openclawHome, "scripts"),
        workspaceDir: join(openclawHome, "workspace"),
        stateDir: join(openclawHome, "state"),
        tunnelFile: join(openclawHome, "tunnel.json"),
        registrationFile: join(openclawHome, "tnode-chat-sync.json"),
        pairWatchConfig: join(openclawHome, "pair-watch.json"),
        devicesDir: join(openclawHome, "devices"),
        componentsManifest: join(openclawHome, "components-manifest.json"),
        skillsDir: join(openclawHome, "tnode-skills"),
        skillsCacheDir: join(openclawHome, "tnode-skills", "cache"),
        skillsCatalog: join(openclawHome, "tnode-skills", "catalog.json"),
        skillsState: join(openclawHome, "tnode-skills", "state.json"),
        skillsCacheIndex: join(openclawHome, "tnode-skills", "cache", "index.json"),
        tmpLogsDir: "/tmp/openclaw",
    };
}
//# sourceMappingURL=paths.js.map