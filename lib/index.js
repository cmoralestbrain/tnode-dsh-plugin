/**
 * F2a host plugin: starts the local TNode owner bridge inside DSH.
 * The F2b client panel consumes http://127.0.0.1:<port> with the bridge token.
 */
import { registerA2aTool } from "./a2a-tool.js";
import { startBridge } from "./cli/bridge.js";

export const name = "tnode-bridge";
export const inject = ["tools"];

export function apply(ctx, config = {}) {
  const port = Number(config.port ?? 3987);
  const started = startBridge({ port, allowLocalOrigins: true });

  try {
    registerA2aTool(ctx);
  } catch (error) {
    console.error("[tnode] no pude registrar tnode_delegate_a2a:", error?.message ?? error);
  }

  ctx.effect(() => () => {
    void started
      .then((handle) => handle.close())
      .catch(() => undefined);
  });
}
