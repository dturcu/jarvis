import type { FirewallRuleEntry, SecurityFirewallRuleInput } from "./types.js";

export type CommandRunner = {
  exec(cmd: string): Promise<{ stdout: string; stderr: string }>;
};

const SAFE_RULE_NAME = /^[A-Za-z0-9 _().:\\/-]{1,120}$/;
const UNSAFE_PROGRAM_CHARS = /["'`&|<>^%!$\r\n]/;

function validateDirection(direction: string | undefined): "inbound" | "outbound" {
  if (direction === undefined || direction === "inbound" || direction === "outbound") {
    return direction ?? "inbound";
  }
  throw new Error(`Unsupported firewall direction: ${direction}`);
}

function validateProtocol(protocol: string | undefined): "tcp" | "udp" {
  if (protocol === undefined || protocol === "tcp" || protocol === "udp") {
    return protocol ?? "tcp";
  }
  throw new Error(`Unsupported firewall protocol: ${protocol}`);
}

function validatePort(port: number | undefined): number | undefined {
  if (port === undefined) {
    return undefined;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Unsupported firewall port: ${port}`);
  }
  return port;
}

function validateRuleName(ruleName: string): string {
  const trimmed = ruleName.trim();
  if (!SAFE_RULE_NAME.test(trimmed)) {
    throw new Error("Firewall rule name contains unsupported characters.");
  }
  return trimmed;
}

function validateProgramPath(program: string | undefined): string | undefined {
  if (program === undefined) {
    return undefined;
  }
  const trimmed = program.trim();
  if (!trimmed) {
    throw new Error("Firewall program path must not be empty.");
  }
  if (UNSAFE_PROGRAM_CHARS.test(trimmed)) {
    throw new Error("Firewall program path contains unsupported characters.");
  }
  return trimmed;
}

/**
 * Adds a Windows Firewall rule via netsh.
 */
export async function addFirewallRule(
  runner: CommandRunner,
  input: SecurityFirewallRuleInput,
): Promise<{ success: boolean; message: string }> {
  try {
    const ruleName = validateRuleName(input.rule_name ?? `Jarvis-Security-${Date.now()}`);
    const dir = validateDirection(input.direction);
    const proto = validateProtocol(input.protocol);
    const port = validatePort(input.port);
    const program = validateProgramPath(input.program);

    let cmd = `netsh advfirewall firewall add rule name="${ruleName}" dir=${dir} action=block protocol=${proto}`;
    if (port !== undefined) {
      cmd += ` localport=${port}`;
    }
    if (program) {
      cmd += ` program="${program}"`;
    }
    cmd += " enable=yes";

    const { stdout, stderr } = await runner.exec(cmd);
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
  try {
    const safeRuleName = validateRuleName(ruleName);
    const cmd = `netsh advfirewall firewall delete rule name="${safeRuleName}"`;
    const { stdout, stderr } = await runner.exec(cmd);
    const success = stdout.toLowerCase().includes("deleted") || stdout.toLowerCase().includes("ok") || !stderr.trim();
    return {
      success,
      message: success ? `Firewall rule '${safeRuleName}' removed.` : (stderr.trim() || "Unknown error")
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
