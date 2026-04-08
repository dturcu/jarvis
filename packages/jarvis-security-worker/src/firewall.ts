import type { FirewallRuleEntry, SecurityFirewallRuleInput } from "./types.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CommandRunner = {
  exec(cmd: string): Promise<{ stdout: string; stderr: string }>;
  /** Preferred: pass arguments as an array to avoid shell injection. */
  execFile?(program: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
};

/** Validate a rule name or program path contains no shell metacharacters. */
function sanitizeNetshArg(value: string, label: string): string {
  // Allow alphanumeric, spaces, dashes, underscores, dots, colons, backslashes, forward slashes
  if (!/^[\w\s.\-:\\\/()]+$/.test(value)) {
    throw new Error(`Invalid ${label}: contains disallowed characters`);
  }
  return value;
}

/**
 * Adds a Windows Firewall rule via netsh.
 */
export async function addFirewallRule(
  runner: CommandRunner,
  input: SecurityFirewallRuleInput,
): Promise<{ success: boolean; message: string }> {
  const ruleName = sanitizeNetshArg(
    input.rule_name ?? `Jarvis-Security-${Date.now()}`,
    "rule_name",
  );
  const dir = input.direction ?? "inbound";
  const proto = input.protocol ?? "tcp";

  // Build args array to avoid shell interpolation
  const args = [
    "advfirewall", "firewall", "add", "rule",
    `name=${ruleName}`, `dir=${dir}`, "action=block", `protocol=${proto}`,
  ];
  if (input.port !== undefined) {
    args.push(`localport=${String(input.port)}`);
  }
  if (input.program) {
    const safeProgram = sanitizeNetshArg(input.program, "program");
    args.push(`program=${safeProgram}`);
  }
  args.push("enable=yes");

  try {
    // Prefer execFile (array args, no shell) over exec (string, shell)
    const { stdout, stderr } = runner.execFile
      ? await runner.execFile("netsh", args)
      : await runner.exec(["netsh", ...args].join(" "));
    const success = stdout.toLowerCase().includes("ok") || !stderr.trim();
    return {
      success,
      message: success ? `Firewall rule '${ruleName}' added.` : (stderr.trim() || "Unknown error")
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to add firewall rule."
    };
  }
}

/**
 * Removes a Windows Firewall rule via netsh.
 */
export async function removeFirewallRule(
  runner: CommandRunner,
  ruleName: string,
): Promise<{ success: boolean; message: string }> {
  const safeName = sanitizeNetshArg(ruleName, "rule_name");
  const args = ["advfirewall", "firewall", "delete", "rule", `name=${safeName}`];
  try {
    const { stdout, stderr } = runner.execFile
      ? await runner.execFile("netsh", args)
      : await runner.exec(["netsh", ...args].join(" "));
    const success = stdout.toLowerCase().includes("deleted") || stdout.toLowerCase().includes("ok") || !stderr.trim();
    return {
      success,
      message: success ? `Firewall rule '${ruleName}' removed.` : (stderr.trim() || "Unknown error")
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to remove firewall rule."
    };
  }
}

/**
 * Lists Windows Firewall rules via netsh and parses the output.
 */
export async function listFirewallRules(
  runner: CommandRunner,
): Promise<FirewallRuleEntry[]> {
  const cmd = "netsh advfirewall firewall show rule name=all verbose";
  try {
    const { stdout } = await runner.exec(cmd);
    return parseNetshOutput(stdout);
  } catch {
    return [];
  }
}

function parseNetshOutput(output: string): FirewallRuleEntry[] {
  const rules: FirewallRuleEntry[] = [];
  const blocks = output.split(/\r?\n\r?\n/).filter((b) => b.includes("Rule Name:"));

  for (const block of blocks) {
    const name = extractField(block, "Rule Name");
    const direction = extractField(block, "Direction");
    const action = extractField(block, "Action");
    const protocol = extractField(block, "Protocol");
    const localPort = extractField(block, "LocalPort");
    const program = extractField(block, "Program");
    const enabled = extractField(block, "Enabled");

    if (!name) continue;

    rules.push({
      name,
      direction: (direction?.toLowerCase() === "out" ? "outbound" : "inbound") as "inbound" | "outbound",
      action: (action?.toLowerCase() === "allow" ? "allow" : "block") as "allow" | "block",
      protocol: protocol && protocol !== "Any" ? protocol : undefined,
      local_port: localPort && localPort !== "Any" ? parseInt(localPort, 10) || undefined : undefined,
      program: program && program !== "Any" ? program : undefined,
      enabled: enabled?.toLowerCase() === "yes"
    });
  }

  return rules;
}

function extractField(block: string, field: string): string | undefined {
  const regex = new RegExp(`^${field}:\\s*(.+)$`, "mi");
  const match = regex.exec(block);
  return match?.[1]?.trim();
}
