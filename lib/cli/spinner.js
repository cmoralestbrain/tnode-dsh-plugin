const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/** Spinner en stderr; no contamina stdout (respuestas/JSON). */
export function startSpinner(label) {
    if (!process.stderr.isTTY)
        return { stop() { } };
    let index = 0;
    const draw = () => {
        process.stderr.write(`\r\u001b[K${FRAMES[index++ % FRAMES.length]} ${label}`);
    };
    draw();
    const timer = setInterval(draw, 80);
    let stopped = false;
    return {
        stop() {
            if (stopped)
                return;
            stopped = true;
            clearInterval(timer);
            process.stderr.write("\r\u001b[K");
        },
    };
}
//# sourceMappingURL=spinner.js.map