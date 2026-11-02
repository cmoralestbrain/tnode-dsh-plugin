export class UsageError extends Error {
    exitCode = 2;
    hint;
    constructor(message, hint) {
        super(message);
        this.name = "UsageError";
        this.hint = hint;
    }
}
/** Flags cortos que llevan valor (el resto se tratan como booleanos). */
const SHORT_VALUE_FLAGS = new Set(["n"]);
/** Parser sin dependencias: --flag, --flag=valor, --flag valor, -f, y repetidos. */
export function parseArgs(argv) {
    const positionals = [];
    const flags = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--") {
            positionals.push(...argv.slice(i + 1));
            break;
        }
        if (arg.startsWith("--") && arg.length > 2) {
            const eq = arg.indexOf("=");
            let key;
            let value;
            if (eq !== -1) {
                key = arg.slice(2, eq);
                value = arg.slice(eq + 1);
            }
            else {
                key = arg.slice(2);
                const next = argv[i + 1];
                if (next !== undefined && !next.startsWith("-")) {
                    value = next;
                    i += 1;
                }
                else {
                    value = true;
                }
            }
            const existing = flags[key];
            if (existing !== undefined) {
                flags[key] = [...toArray(existing), ...toArray(value)];
            }
            else {
                flags[key] = value;
            }
            continue;
        }
        if (arg.startsWith("-") && arg.length > 1 && arg !== "-") {
            const name = arg.slice(1);
            if (name.length === 1 && SHORT_VALUE_FLAGS.has(name)) {
                const next = argv[i + 1];
                if (next !== undefined && !next.startsWith("-")) {
                    flags[name] = next;
                    i += 1;
                }
                else {
                    flags[name] = true;
                }
                continue;
            }
            flags[name] = true;
            continue;
        }
        positionals.push(arg);
    }
    return { positionals, flags };
}
function toArray(value) {
    if (Array.isArray(value))
        return value;
    return [String(value)];
}
function last(flags, name) {
    const value = flags[name];
    if (value === undefined)
        return undefined;
    return Array.isArray(value) ? value[value.length - 1] : value;
}
/** Devuelve el valor string de la primera opción presente (alias incluidos). */
export function flagString(flags, ...names) {
    for (const name of names) {
        const value = last(flags, name);
        if (value === undefined)
            continue;
        if (value === true)
            throw new UsageError(`La opción --${name} requiere un valor`);
        return String(value);
    }
    return undefined;
}
export function flagBool(flags, ...names) {
    for (const name of names) {
        const value = last(flags, name);
        if (value === undefined)
            continue;
        return value !== "false";
    }
    return false;
}
export function flagList(flags, ...names) {
    for (const name of names) {
        const value = flags[name];
        if (value === undefined)
            continue;
        if (Array.isArray(value))
            return value.map(String);
        return [String(value)];
    }
    return [];
}
//# sourceMappingURL=args.js.map