import { ssh } from "./fleet.js";
const OPENCLAW_SCRIPT = `
host=$(hostname 2>/dev/null || echo unknown)
os=$(uname -s 2>/dev/null || echo unknown)
ver=$(openclaw --version 2>/dev/null || echo missing)
gw=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18789/ 2>/dev/null || echo 000)
check_service() {
  if command -v systemctl >/dev/null 2>&1; then
    state=$(systemctl is-active "$1" 2>/dev/null || true)
    if [ "$state" = "active" ]; then echo yes; return; fi
  fi
  if command -v launchctl >/dev/null 2>&1; then
    launchctl print "gui/$(id -u)/$3" >/dev/null 2>&1 && echo yes && return
    launchctl list 2>/dev/null | grep -q "$3" && echo yes && return
  fi
  pgrep -f "$2" >/dev/null 2>&1 && echo yes || echo no
}
chat=$(check_service tnode-chat-sync '[t]node-chat-sync' com.tbrain.tnode-chat-sync)
config=$(check_service tnode-config-sync '[t]node-config-sync' com.tbrain.tnode-config-sync)
tele=$(check_service tnode-telemetry '[t]node-telemetry' com.tbrain.tnode-telemetry)
cf=$(check_service cloudflared '[c]loudflared' com.cloudflare.cloudflared)
reg=1
test -s /home/tnode/.openclaw/tnode-chat-sync.json && reg=0
test -s "$HOME/.openclaw/tnode-chat-sync.json" && reg=0
tun=1
test -s /home/tnode/.openclaw/tunnel.json && tun=0
test -s "$HOME/.openclaw/tunnel.json" && tun=0
disk=$(df -Pk / 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
printf 'HOST=%s\nOS=%s\nVER=%s\nGW=%s\nCHAT=%s\nCONFIG=%s\nTELE=%s\nCF=%s\nREG=%s\nTUN=%s\nDISK=%s\n' "$host" "$os" "$ver" "$gw" "$chat" "$config" "$tele" "$cf" "$reg" "$tun" "$disk"
`;
const PI_SCRIPT = `
host=$(hostname 2>/dev/null || echo unknown)
os=$(uname -s 2>/dev/null || echo unknown)
ver=$(cat /home/tnode/pi-host-app/.installed-version 2>/dev/null || echo missing)
gw=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18789/ 2>/dev/null || echo 000)
service=$(systemctl is-active tnode-pi-host 2>/dev/null || echo unknown)
cf=$(pgrep -f '[c]loudflared' >/dev/null 2>&1 && echo yes || echo no)
reg=1
test -s /home/tnode/pi-host/tnode-chat-sync.json && reg=0
tun=1
test -s /home/tnode/pi-host/tunnel.json && tun=0
disk=$(df -Pk / 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
printf 'HOST=%s\\nOS=%s\\nVER=%s\\nGW=%s\\nSERVICE=%s\\nCF=%s\\nREG=%s\\nTUN=%s\\nDISK=%s\\n' "$host" "$os" "$ver" "$gw" "$service" "$cf" "$reg" "$tun" "$disk"
`;
function quote(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
export function parseDoctorOutput(output) {
    const fields = {};
    for (const line of output.split("\n")) {
        const index = line.indexOf("=");
        if (index <= 0)
            continue;
        fields[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    return fields;
}
export function buildChecks(entry, fields) {
    const checks = [];
    const gateway = fields.GW ?? "000";
    const gatewayOk = /^\d{3}$/.test(gateway) && gateway !== "000" && Number(gateway) < 500;
    checks.push({
        id: "gateway",
        label: "gateway",
        status: gatewayOk ? "ok" : "fail",
        detail: gatewayOk ? `HTTP ${gateway}` : `HTTP ${gateway} en 18789`,
    });
    const version = fields.VER ?? "missing";
    checks.push({
        id: "version",
        label: entry.kind === "pi" ? "pi-host" : "openclaw",
        status: version === "missing" || !version ? "fail" : "ok",
        detail: version,
    });
    if (entry.kind === "pi") {
        const service = fields.SERVICE ?? "unknown";
        checks.push({
            id: "service",
            label: "tnode-pi-host",
            status: service === "active" ? "ok" : "fail",
            detail: service,
        });
        checks.push({
            id: "cloudflared",
            label: "cloudflared",
            status: fields.CF === "yes" ? "ok" : "warn",
            detail: fields.CF === "yes" ? "running" : "no detectado",
        });
    }
    else {
        const required = ["CHAT", "CONFIG"];
        const missing = required.filter((key) => fields[key] !== "yes");
        checks.push({
            id: "services",
            label: "daemons",
            status: missing.length === 0 ? "ok" : "fail",
            detail: missing.length === 0 ? "chat-sync + config-sync" : `faltan: ${missing.join(", ")}`,
        });
        const optional = ["TELE", "CF"];
        const off = optional.filter((key) => fields[key] !== "yes");
        checks.push({
            id: "extras",
            label: "extras",
            status: off.length === 0 ? "ok" : "warn",
            detail: off.length === 0 ? "telemetry + cloudflared" : `no detectado: ${off.join(", ")}`,
        });
    }
    checks.push({
        id: "registration",
        label: "registro",
        status: fields.REG === "0" ? "ok" : "fail",
        detail: fields.REG === "0" ? "tnode-chat-sync.json" : "sin tnode-chat-sync.json",
    });
    checks.push({
        id: "tunnel",
        label: "túnel",
        status: fields.TUN === "0" ? "ok" : "warn",
        detail: fields.TUN === "0" ? "tunnel.json" : "sin tunnel.json (LAN/Tailscale?)",
    });
    const disk = Number(fields.DISK);
    checks.push({
        id: "disk",
        label: "disco",
        status: !Number.isFinite(disk) ? "warn" : disk >= 90 ? "fail" : disk >= 80 ? "warn" : "ok",
        detail: Number.isFinite(disk) ? `${disk}% usado` : "sin dato",
    });
    return checks;
}
export async function runRemoteDoctor(entry) {
    const script = entry.kind === "pi" ? PI_SCRIPT : OPENCLAW_SCRIPT;
    const result = await ssh(entry.ssh, `bash -lc ${quote(script)}`, 30_000);
    const fields = parseDoctorOutput(result.stdout);
    const checks = result.code !== 0 && Object.keys(fields).length === 0
        ? [
            {
                id: "ssh",
                label: "ssh",
                status: "fail",
                detail: result.stderr.trim() || `exit ${result.code}`,
            },
        ]
        : buildChecks(entry, fields);
    return {
        node: { id: entry.id, name: entry.name, env: entry.env, kind: entry.kind },
        ok: !checks.some((check) => check.status === "fail"),
        checks,
    };
}
//# sourceMappingURL=remote-doctor.js.map