const ANSI = /\u001b\[[0-9;]*m/g;
function colorsEnabled() {
    return !process.env.NO_COLOR && Boolean(process.stdout.isTTY);
}
const wrap = (code) => (text) => colorsEnabled() ? `\u001b[${code}m${text}\u001b[0m` : text;
export const style = {
    bold: wrap(1),
    dim: wrap(2),
    red: wrap(31),
    green: wrap(32),
    yellow: wrap(33),
    blue: wrap(34),
    magenta: wrap(35),
    cyan: wrap(36),
    gray: wrap(90),
};
export function stripAnsi(text) {
    return text.replace(ANSI, "");
}
function pad(text, width) {
    const visible = stripAnsi(text).length;
    return text + " ".repeat(Math.max(0, width - visible));
}
export function table(headers, rows) {
    const widths = headers.map((header, index) => Math.max(stripAnsi(header).length, ...rows.map((row) => stripAnsi(row[index] ?? "").length)));
    const line = (cells) => cells.map((cell, index) => pad(cell, widths[index] ?? 0)).join("  ").trimEnd();
    const output = [
        style.bold(line(headers)),
        style.dim(widths.map((width) => "─".repeat(width)).join("  ")),
        ...rows.map((row) => line(row)),
    ];
    process.stdout.write(`${output.join("\n")}\n`);
}
export function kv(pairs) {
    const width = Math.max(...pairs.map(([key]) => stripAnsi(key).length));
    for (const [key, value] of pairs) {
        process.stdout.write(`${style.dim(pad(key, width))}  ${value}\n`);
    }
}
export function out(message = "") {
    process.stdout.write(`${message}\n`);
}
export function printJson(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
export function heading(message) {
    out(style.bold(message));
}
export function info(message) {
    process.stderr.write(`${style.dim("·")} ${message}\n`);
}
export function success(message) {
    process.stderr.write(`${style.green("✓")} ${message}\n`);
}
export function warn(message) {
    process.stderr.write(`${style.yellow("!")} ${message}\n`);
}
export function fail(message) {
    process.stderr.write(`${style.red("error:")} ${message}\n`);
}
export function hint(message) {
    process.stderr.write(`  ${style.dim(message)}\n`);
}
//# sourceMappingURL=output.js.map