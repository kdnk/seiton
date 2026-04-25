import { stdin } from "node:process";
import { applyAgentHook } from "./core/commands";

async function main(): Promise<void> {
  const [, , command, agent, event] = process.argv;

  if (command === "hook" && agent && event) {
    const input = await readStdin();
    await applyAgentHook(agent, event, input, process.env, process.cwd());
    return;
  }

  console.error("Usage: seiton hook <agent> <event>");
  process.exitCode = 1;
}

async function readStdin(): Promise<string> {
  if (stdin.isTTY) return "";
  let buffer = "";
  stdin.setEncoding("utf8");
  for await (const chunk of stdin) {
    buffer += chunk;
  }
  return buffer;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
