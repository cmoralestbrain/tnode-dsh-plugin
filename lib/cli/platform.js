export function detectPlatform() {
    const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : process.platform === "win32" ? "win32" : "other";
    return {
        os,
        arch: process.arch,
        serviceManager: os === "darwin" ? "launchd" : os === "linux" ? "systemd" : "none",
        hasSystemctl: os === "linux",
        hasLaunchctl: os === "darwin",
    };
}
export function platformLabel(platform) {
    if (platform.os === "darwin")
        return `macOS (${platform.arch})`;
    if (platform.os === "linux")
        return `Linux (${platform.arch})`;
    return `${platform.os} (${platform.arch})`;
}
//# sourceMappingURL=platform.js.map