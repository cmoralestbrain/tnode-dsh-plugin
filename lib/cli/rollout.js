import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./credentials.js";
import { loadFleetInventory, parseOpenclawVersion, parsePiVersion, PI_VERSION_COMMAND, ssh, updateInstallerCommand, tokenFor, VERSION_COMMAND, } from "./fleet.js";
import { endpointOf, probeHttps } from "./net.js";
import { fetchHealth, sendChat } from "./ws.js";
export function rolloutsDir() {
    return join(configDir(), "rollouts");
}
export function rolloutDir(id) {
    return join(rolloutsDir(), id);
}
export function saveRollout(state) {
    mkdirSync(rolloutDir(state.id), { recursive: true, mode: 0o700 });
    writeFileSync(join(rolloutDir(state.id), "rollout.json"), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}
export function loadRollout(id) {
    try {
        return JSON.parse(readFileSync(join(rolloutDir(id), "rollout.json"), "utf8"));
    }
    catch {
        throw new Error(`No existe el rollout ${id}`);
    }
}
export function writeGate(state, record) {
    mkdirSync(rolloutDir(state.id), { recursive: true, mode: 0o700 });
    writeFileSync(join(rolloutDir(state.id), `${record.gate}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}
export function parseTargets(values) {
    const targets = {};
    for (const value of values) {
        const [kind, version] = value.split("=");
        if ((kind !== "openclaw" && kind !== "pi") || !version || !/^[0-9]+\.[0-9]+\.[0-9]+/.test(version)) {
            throw new Error(`Target inválido: ${value} (usa openclaw=2026.9.4 o pi=0.16.0)`);
        }
        targets[kind] = version;
    }
    return targets;
}
function quote(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
function remote(command) {
    return `bash -lc ${quote(command)}`;
}
async function readVersion(entry) {
    const command = entry.kind === "pi" ? PI_VERSION_COMMAND : VERSION_COMMAND;
    const result = await ssh(entry.ssh, remote(command), 30_000);
    if (result.code !== 0)
        return { version: null, error: result.stderr.trim() || `ssh ${result.code}` };
    const [versionPart] = result.stdout.split("---");
    const version = entry.kind === "pi" ? parsePiVersion(versionPart ?? "") : parseOpenclawVersion(versionPart ?? "");
    return { version };
}
function updateScript(node, scope) {
    return updateInstallerCommand(node.kind, scope);
}
function healthTarget(entry) {
    return endpointOf(entry.serverUrl ?? "")?.host ?? null;
}
function entryOf(state, node) {
    return {
        id: node.id,
        name: node.name,
        env: state.env,
        kind: node.kind,
        ssh: node.ssh,
        serverUrl: undefined,
        source: "config",
    };
}
async function healthCheck(state, node) {
    const inventory = await loadFleetInventory();
    const entry = inventory.entries.find((item) => item.id === node.id && item.env === node.env);
    if (!entry)
        return { id: "health", status: "fail", detail: "nodo no está en el inventario" };
    const host = healthTarget(entry);
    if (!host)
        return { id: "health", status: "fail", detail: "sin serverUrl" };
    const token = tokenFor(inventory, entry);
    if (token) {
        const result = await fetchHealth(host, token);
        return { id: "health", status: result.ok ? "ok" : "fail", detail: result.ok ? host : (result.error ?? "sin health") };
    }
    const probe = await probeHttps(host);
    return { id: "health", status: probe.ok ? "ok" : "fail", detail: probe.ok ? `HTTP ${probe.status}` : (probe.error ?? "sin respuesta") };
}
async function smokeCheck(state, node) {
    const inventory = await loadFleetInventory();
    const entry = inventory.entries.find((item) => item.id === node.id && item.env === node.env);
    const host = entry ? healthTarget(entry) : null;
    const token = entry ? tokenFor(inventory, entry) : undefined;
    if (!entry || !host || !token)
        return { id: "smoke", status: "fail", detail: "sin token/serverUrl" };
    const result = await sendChat(host, token, "responde solo OK", { timeoutMs: 90_000 });
    return {
        id: "smoke",
        status: result.ok && (result.reply ?? "").length > 0 ? "ok" : "fail",
        detail: result.ok ? (result.reply ?? "").slice(0, 80) : (result.error ?? "sin respuesta"),
    };
}
export async function planRollout(options) {
    if (!["beta", "prod", "all"].includes(options.env))
        throw new Error("--env debe ser beta, prod o all.");
    const inventory = await loadFleetInventory();
    const entries = inventory.entries.filter((entry) => (options.env === "all" || entry.env === options.env) && entry.ssh && options.targets[entry.kind]);
    if (entries.length === 0) {
        throw new Error("No hay nodos beta con SSH y target en fleet.json.");
    }
    const nodes = await Promise.all(entries.map(async (entry) => {
        const target = options.targets[entry.kind];
        const { version } = await readVersion(entry);
        return {
            id: entry.id,
            name: entry.name,
            env: entry.env,
            kind: entry.kind,
            ssh: entry.ssh,
            target,
            versionBefore: version,
            needsUpdate: version !== target,
            status: "pending",
        };
    }));
    const now = new Date().toISOString();
    const id = `ro_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
    const state = {
        id,
        createdAt: now,
        env: options.env,
        scope: options.scope,
        targets: options.targets,
        status: "planned",
        nodes,
        gates: {},
    };
    const checks = nodes.map((node) => ({
        id: `node:${node.id}`,
        status: node.versionBefore ? "ok" : "fail",
        detail: `${node.kind} ${node.versionBefore ?? "sin versión"} → ${node.target}`,
    }));
    state.gates.G0 = {
        gate: "G0",
        status: checks.every((check) => check.status !== "fail") ? "passed" : "failed",
        startedAt: now,
        finishedAt: new Date().toISOString(),
        checks,
    };
    saveRollout(state);
    writeGate(state, state.gates.G0);
    return state;
}
export async function runGate1(state, canary) {
    const node = state.nodes.find((item) => item.id === canary || item.name.toLowerCase() === canary.toLowerCase());
    if (!node)
        throw new Error(`El canario ${canary} no está en el rollout`);
    if (node.env !== "beta")
        throw new Error("G1 es el canario beta; usa G4 para prod.");
    state.canary = node.id;
    const startedAt = new Date().toISOString();
    const checks = [];
    let error;
    try {
        if (node.needsUpdate) {
            const result = await ssh(node.ssh, remote(updateScript(node, state.scope)), 900_000);
            writeFileSync(join(rolloutDir(state.id), `artifact-${node.id}.log`), `${result.stdout}\n${result.stderr}`, { mode: 0o600 });
            if (result.code !== 0)
                throw new Error(`installer/ssh exit ${result.code}`);
            node.status = "updated";
        }
        else {
            node.status = "skipped";
            checks.push({ id: "update", status: "skip", detail: "ya estaba en el target" });
        }
        const after = await readVersion({
            id: node.id,
            name: node.name,
            env: state.env,
            kind: node.kind,
            ssh: node.ssh,
            source: "config",
        });
        node.versionAfter = after.version;
        checks.push({
            id: "version",
            status: after.version === node.target ? "ok" : "fail",
            detail: `${after.version ?? "desconocida"} / target ${node.target}`,
        });
        checks.push(await healthCheck(state, node));
        checks.push(await smokeCheck(state, node));
    }
    catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        node.status = "failed";
    }
    const failed = checks.some((check) => check.status === "fail") || Boolean(error);
    state.gates.G1 = {
        gate: "G1",
        status: failed ? "failed" : "passed",
        startedAt,
        finishedAt: new Date().toISOString(),
        checks,
        error,
    };
    state.status = failed ? "blocked" : "g1_passed";
    saveRollout(state);
    writeGate(state, state.gates.G1);
    return state;
}
export async function runGate2(state) {
    const startedAt = new Date().toISOString();
    const checks = [];
    const targets = state.nodes.filter((node) => node.env === "beta" && node.id !== state.canary && node.needsUpdate);
    let error;
    for (const node of targets) {
        try {
            const result = await ssh(node.ssh, remote(updateScript(node, state.scope)), 900_000);
            writeFileSync(join(rolloutDir(state.id), `artifact-${node.id}.log`), `${result.stdout}\n${result.stderr}`, { mode: 0o600 });
            if (result.code !== 0)
                throw new Error(`${node.name}: installer/ssh exit ${result.code}`);
            node.status = "updated";
            const after = await readVersion({
                id: node.id,
                name: node.name,
                env: state.env,
                kind: node.kind,
                ssh: node.ssh,
                source: "config",
            });
            node.versionAfter = after.version;
            const versionOk = after.version === node.target;
            checks.push({ id: `node:${node.id}`, status: versionOk ? "ok" : "fail", detail: `${after.version ?? "?"} / ${node.target}` });
            if (!versionOk)
                throw new Error(`${node.name}: versión ${after.version ?? "?"} != ${node.target}`);
            checks.push(await healthCheck(state, node));
        }
        catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
            node.status = "failed";
            break;
        }
    }
    if (targets.length === 0)
        checks.push({ id: "beta", status: "skip", detail: "nada que actualizar" });
    const failed = Boolean(error) || checks.some((check) => check.status === "fail");
    state.gates.G2 = {
        gate: "G2",
        status: failed ? "failed" : "passed",
        startedAt,
        finishedAt: new Date().toISOString(),
        checks,
        error,
    };
    state.status = failed ? "blocked" : "g2_passed";
    saveRollout(state);
    writeGate(state, state.gates.G2);
    return state;
}
export async function runGate3(state) {
    const startedAt = new Date().toISOString();
    const checks = [];
    for (const node of state.nodes.filter((item) => item.env === "beta")) {
        const after = await readVersion({ id: node.id, name: node.name, env: "beta", kind: node.kind, ssh: node.ssh, source: "config" });
        checks.push({
            id: `beta:${node.id}`,
            status: after.version === node.target ? "ok" : "fail",
            detail: `${after.version ?? "?"} / ${node.target}`,
        });
    }
    const prodNodes = state.nodes.filter((item) => item.env === "prod");
    if (prodNodes.length === 0) {
        checks.push({ id: "prod", status: "skip", detail: "sin nodos prod en el plan" });
    }
    for (const node of prodNodes) {
        const after = await readVersion({ id: node.id, name: node.name, env: "prod", kind: node.kind, ssh: node.ssh, source: "config" });
        checks.push({
            id: `prod:${node.id}`,
            status: after.version === node.versionBefore ? "ok" : "fail",
            detail: `prod intacto: ${after.version ?? "?"} (antes ${node.versionBefore ?? "?"})`,
        });
    }
    const failed = checks.some((check) => check.status === "fail");
    state.gates.G3 = {
        gate: "G3",
        status: failed ? "failed" : "passed",
        startedAt,
        finishedAt: new Date().toISOString(),
        checks,
    };
    state.status = failed ? "blocked" : "g3_passed";
    saveRollout(state);
    writeGate(state, state.gates.G3);
    return state;
}
export async function runGate4(state, prodCanary, window) {
    if (!window.trim())
        throw new Error("G4 requiere --window");
    const node = state.nodes.find((item) => item.env === "prod" && (item.id === prodCanary || item.name.toLowerCase() === prodCanary.toLowerCase()));
    if (!node)
        throw new Error(`El canario prod ${prodCanary} no está en el rollout`);
    state.prodCanary = node.id;
    state.window = window;
    const startedAt = new Date().toISOString();
    const checks = [];
    let error;
    try {
        if (node.needsUpdate) {
            const result = await ssh(node.ssh, remote(updateScript(node, state.scope)), 900_000);
            writeFileSync(join(rolloutDir(state.id), `artifact-${node.id}.log`), `${result.stdout}\n${result.stderr}`, { mode: 0o600 });
            if (result.code !== 0)
                throw new Error(`installer/ssh exit ${result.code}`);
            node.status = "updated";
        }
        else {
            node.status = "skipped";
            checks.push({ id: "update", status: "skip", detail: "ya estaba en el target" });
        }
        const after = await readVersion({ id: node.id, name: node.name, env: "prod", kind: node.kind, ssh: node.ssh, source: "config" });
        node.versionAfter = after.version;
        checks.push({ id: "version", status: after.version === node.target ? "ok" : "fail", detail: `${after.version ?? "?"} / ${node.target}` });
        checks.push(await healthCheck(state, node));
        checks.push(await smokeCheck(state, node));
    }
    catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        node.status = "failed";
    }
    const failed = Boolean(error) || checks.some((check) => check.status === "fail");
    state.gates.G4 = {
        gate: "G4",
        status: failed ? "failed" : "passed",
        startedAt,
        finishedAt: new Date().toISOString(),
        checks,
        error,
    };
    state.status = failed ? "blocked" : "g4_passed";
    saveRollout(state);
    writeGate(state, state.gates.G4);
    return state;
}
export async function runGate5(state) {
    const startedAt = new Date().toISOString();
    const checks = [];
    const targets = state.nodes.filter((node) => node.env === "prod" && node.id !== state.prodCanary && node.needsUpdate);
    let error;
    for (const node of targets) {
        try {
            const result = await ssh(node.ssh, remote(updateScript(node, state.scope)), 900_000);
            writeFileSync(join(rolloutDir(state.id), `artifact-${node.id}.log`), `${result.stdout}\n${result.stderr}`, { mode: 0o600 });
            if (result.code !== 0)
                throw new Error(`${node.name}: installer/ssh exit ${result.code}`);
            node.status = "updated";
            const after = await readVersion({ id: node.id, name: node.name, env: "prod", kind: node.kind, ssh: node.ssh, source: "config" });
            node.versionAfter = after.version;
            checks.push({ id: `node:${node.id}`, status: after.version === node.target ? "ok" : "fail", detail: `${after.version ?? "?"} / ${node.target}` });
            if (after.version !== node.target)
                throw new Error(`${node.name}: ${after.version ?? "?"} != ${node.target}`);
            checks.push(await healthCheck(state, node));
        }
        catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
            node.status = "failed";
            break;
        }
    }
    if (targets.length === 0)
        checks.push({ id: "prod", status: "skip", detail: "nada que actualizar" });
    const failed = Boolean(error) || checks.some((check) => check.status === "fail");
    state.gates.G5 = {
        gate: "G5",
        status: failed ? "failed" : "passed",
        startedAt,
        finishedAt: new Date().toISOString(),
        checks,
        error,
    };
    state.status = failed ? "blocked" : "g5_passed";
    saveRollout(state);
    writeGate(state, state.gates.G5);
    return state;
}
//# sourceMappingURL=rollout.js.map