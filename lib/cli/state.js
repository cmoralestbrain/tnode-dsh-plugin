import { readdirSync, readFileSync, statSync } from "node:fs";
import { statfs } from "node:fs/promises";
export function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return null;
    }
}
export function readText(path) {
    try {
        return readFileSync(path, "utf8");
    }
    catch {
        return null;
    }
}
export function exists(path) {
    try {
        statSync(path);
        return true;
    }
    catch {
        return false;
    }
}
export function statSafe(path) {
    try {
        const stat = statSync(path);
        return { size: stat.size, mode: stat.mode & 0o777, mtime: stat.mtime };
    }
    catch {
        return null;
    }
}
export function fileMode(path) {
    const stat = statSafe(path);
    if (!stat)
        return null;
    return `0${stat.mode.toString(8)}`;
}
export function countFiles(dir, predicate) {
    try {
        return readdirSync(dir).filter((name) => (predicate ? predicate(name) : true)).length;
    }
    catch {
        return 0;
    }
}
export function listDir(dir) {
    try {
        return readdirSync(dir);
    }
    catch {
        return [];
    }
}
export async function diskFreeGb(path) {
    try {
        const stats = await statfs(path);
        return (stats.bavail * stats.bsize) / 1024 ** 3;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=state.js.map