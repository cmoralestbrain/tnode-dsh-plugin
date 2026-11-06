/**
 * Model-facing A2A delegation tool. The agent can call it without filling the
 * panel; the API key never enters the prompt and only approved harness nodes
 * are reachable.
 */
import { getA2aKey } from "./cli/a2a-keys.js";
import { extractTaskText, hostKey, normalizeBaseUrl, sendA2aMessage, waitForA2aTask } from "./cli/a2a.js";
import { ENVIRONMENTS, fetchUserNodes } from "./cli/firebase.js";
import { loadFleetInventory } from "./cli/fleet.js";
import { loadHarnessSession } from "./cli/harness-auth.js";

async function resolveTarget(nodeRef, env) {
  const wanted = nodeRef.toLowerCase();
  const harness = await loadHarnessSession(env);
  if (harness) {
    const nodes = await fetchUserNodes(harness.idToken, ENVIRONMENTS[env].projectId);
    const node = nodes.find((item) => item.id.toLowerCase() === wanted || item.name.toLowerCase() === wanted);
    if (!node) throw new Error(`No existe el nodo ${nodeRef} en ${env}`);
    if (harness.nodeIds && !harness.nodeIds.includes(node.id)) {
      throw new Error(`El nodo ${node.name} no está aprobado para este harness`);
    }
    if (!node.serverUrl) throw new Error(`El nodo ${node.name} no tiene serverUrl`);
    return { node, base: normalizeBaseUrl(node.serverUrl) };
  }

  const inventory = await loadFleetInventory();
  const entry = inventory.entries.find(
    (item) => item.env === env && (item.id.toLowerCase() === wanted || item.name.toLowerCase() === wanted),
  );
  if (!entry) throw new Error(`No existe el nodo ${nodeRef} en ${env}`);
  if (!entry.serverUrl) throw new Error(`El nodo ${entry.name} no tiene serverUrl`);
  return { node: { id: entry.id, name: entry.name }, base: normalizeBaseUrl(entry.serverUrl) };
}

export function registerA2aTool(ctx) {
  const tool = {
    name: "tnode_delegate_a2a",
    description:
      "Delegate a task to another TNode agent over A2A and return its result. " +
      "Use it when the user asks to consult/delegate to a specific TNode (for example Retailer). " +
      "Only nodes approved for this harness are reachable; the owner idToken and API keys are never sent to the model.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["node", "task"],
      properties: {
        node: { type: "string", description: "TNode name or id (e.g. Retailer or bc27bf26-…)." },
        task: { type: "string", description: "The task/question for the remote agent." },
        env: { type: "string", enum: ["beta", "prod"], description: "Environment; default beta." },
        timeout: { type: "integer", minimum: 5, maximum: 300, description: "Timeout seconds; default 180." },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["node", "host", "taskId", "state", "text"],
        properties: {
          node: { type: "string" },
          host: { type: "string" },
          taskId: { type: "string" },
          state: { type: "string" },
          text: { type: "string" },
        },
      },
      render: (_args, value) => [
        {
          type: "text",
          text: `A2A ${value.node} (${value.state})${value.taskId ? ` · ${value.taskId}` : ""}\n${value.text || "(sin artefacto)"}`,
        },
      ],
    },
    timeoutMs: 300_000,
    async execute(args) {
      const env = args.env === "prod" ? "prod" : "beta";
      const { node, base } = await resolveTarget(args.node, env);
      const host = hostKey(base);
      const key = process.env.TNODE_A2A_KEY ?? getA2aKey(host);
      if (!key) {
        throw new Error(`No hay API key A2A para ${host}; crea un cliente en la app y ejecuta: tnode a2a key set --url ${base}`);
      }
      const timeoutMs = Math.min(300, Math.max(5, Number(args.timeout) || 180)) * 1000;
      const initial = await sendA2aMessage(base, key, args.task, { timeoutMs });
      const task = await waitForA2aTask(base, key, initial, { timeoutMs });
      return {
        node: node.name,
        host,
        taskId: task.id ?? "",
        state: String(task.status?.state ?? "").replace(/^TASK_STATE_/, "").toLowerCase() || "unknown",
        text: extractTaskText(task),
      };
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Delegate to ${args.node}`,
      kind: "other",
      rawInput: { node: args.node, task: args.task },
    }),
  };

  ctx.tools.register(tool);
}
