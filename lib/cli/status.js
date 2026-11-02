import { commandVersion, which } from "./exec.js";
import { inspectAllServices, probePort } from "./services.js";
import { components, configPermissions, gatewayHost, gatewayPort, model, registration, skills, tunnel, } from "./node-state.js";
export async function collectStatus(paths, platform) {
    const reg = registration(paths);
    const openclawPath = which("openclaw");
    const [openclawVersion, listening, services] = await Promise.all([
        openclawPath ? commandVersion("openclaw") : Promise.resolve(null),
        probePort(gatewayHost(paths), gatewayPort(paths)),
        inspectAllServices(paths, platform),
    ]);
    return {
        generatedAt: new Date().toISOString(),
        platform: { os: platform.os, arch: platform.arch, manager: platform.serviceManager },
        node: { registered: reg.present, id: reg.nodeId, home: paths.openclawHome },
        openclaw: { installed: Boolean(openclawPath), version: openclawVersion, path: openclawPath },
        gateway: { host: gatewayHost(paths), port: gatewayPort(paths), listening },
        tunnel: { configured: tunnel(paths).present, domain: tunnel(paths).domain },
        model: model(paths),
        skills: skills(paths),
        services: services.map(({ id, label, installed, loaded, running, detail }) => ({ id, label, installed, loaded, running, detail })),
        components: components(paths),
        config: { path: paths.configFile, mode: configPermissions(paths).mode },
    };
}
//# sourceMappingURL=status.js.map