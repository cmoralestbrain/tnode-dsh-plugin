/**
 * F2a host plugin: starts the local TNode owner bridge inside DSH.
 * The F2b client panel consumes http://127.0.0.1:<port> with the bridge token.
 */
import { startBridge } from "./cli/bridge.js";

export const name = "tnode-bridge";

export function apply(ctx, config = {}) {
  const port = Number(config.port ?? 3987);
  const started = startBridge({ port, allowLocalOrigins: true });

  ctx.effect(() => () => {
    void started
      .then((handle) => handle.close())
      .catch(() => undefined);
  });
}
