import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
export async function confirm(question, assumeYes = false) {
    if (assumeYes)
        return true;
    if (!stdin.isTTY)
        return false;
    const rl = createInterface({ input: stdin, output: stdout });
    try {
        const answer = await rl.question(`${question} [s/N] `);
        return /^s(í|i)?$/i.test(answer.trim());
    }
    finally {
        rl.close();
    }
}
//# sourceMappingURL=prompt.js.map