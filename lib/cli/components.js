export const COMPONENTS_MANIFEST_URL = "https://updates.tbrain.app/components-manifest-latest.json";
export function parseManifest(raw) {
    const components = raw?.components;
    if (!Array.isArray(components))
        throw new Error("manifest sin components[]");
    const parsed = [];
    for (const item of components) {
        if (!item || typeof item !== "object")
            continue;
        const row = item;
        if (typeof row.id !== "string" || typeof row.version !== "string" || typeof row.kind !== "string")
            continue;
        parsed.push({
            id: row.id,
            version: row.version.replace(/^v/, ""),
            kind: row.kind,
            driftAllowed: row.driftAllowed === true,
        });
    }
    return parsed;
}
export function parseInstalled(text) {
    const installed = { daemons: {}, openclaw: null };
    for (const line of text.split("\n")) {
        const [kind, name, ...versionParts] = line.trim().split(":");
        if (kind === "daemon" && name) {
            installed.daemons[name.replace(/_/g, "-")] = versionParts.join(":").trim();
        }
        else if (kind === "openclaw") {
            const version = [name, ...versionParts].join(":").trim();
            installed.openclaw = version.match(/\b([0-9]+\.[0-9]+\.[0-9]+)\b/)?.[1] ?? (version || null);
        }
    }
    return installed;
}
/** Shell snippet: reads daemon __VERSION__ headers + openclaw --version. */
export const INSTALLED_COMPONENTS_COMMAND = [
    "DIR=/home/tnode/.openclaw/scripts",
    '[ -d "$DIR" ] || DIR="$HOME/.openclaw/scripts"',
    'for f in "$DIR"/*.py; do',
    '  [ -f "$f" ] || continue',
    `  v=$(sed -n 's/^__VERSION__ = "\\(.*\\)"/\\1/p' "$f" | head -1)`,
    '  [ -n "$v" ] && echo "daemon:$(basename "$f" .py):$v"',
    "done",
    'if id tnode >/dev/null 2>&1; then',
    '  oc=$(sudo -u tnode -H openclaw --version 2>/dev/null | head -1)',
    "else",
    '  oc=$(openclaw --version 2>/dev/null | head -1)',
    "fi",
    'echo "openclaw:$oc"',
].join("\n");
export function installedFor(target, installed) {
    if (target.kind === "daemon-embedded")
        return installed.daemons[target.id] ?? null;
    if (target.kind === "binary-npm")
        return installed.openclaw;
    return null;
}
export function componentReport(targets, before, after) {
    return targets
        .filter((target) => !target.driftAllowed && target.kind !== "binary-os" && target.kind !== "plugin-extension")
        .map((target) => {
        const beforeVersion = installedFor(target, before);
        const afterVersion = installedFor(target, after);
        const status = afterVersion === target.version ? "ok" : afterVersion ? "drift" : "missing";
        return { id: target.id, target: target.version, before: beforeVersion, after: afterVersion, status };
    });
}
export async function loadComponentTargets(source = COMPONENTS_MANIFEST_URL) {
    if (!/^https?:\/\//.test(source)) {
        const { readFileSync } = await import("node:fs");
        return parseManifest(JSON.parse(readFileSync(source, "utf8")));
    }
    const response = await fetch(source);
    if (!response.ok)
        throw new Error(`manifest HTTP ${response.status}`);
    return parseManifest(await response.json());
}
//# sourceMappingURL=components.js.map