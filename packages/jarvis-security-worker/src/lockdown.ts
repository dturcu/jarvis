import type { LockdownAction, SecurityLockdownInput, SecurityLockdownOutput } from "./types.js";

export type LockdownRunner = {
  exec(cmd: string): Promise<{ stdout: string; stderr: string }>;
  killProcess(pid: number): Promise<boolean>;
  listNonWhitelistedPids(whitelist: Set<string>): Promise<number[]>;
};

/**
 * Executes a security lockdown at the requested level.
 * Returns a structured outcome describing every action taken.
 */
export async function executeLockdown(
  runner: LockdownRunner,
  input: SecurityLockdownInput,
  whitelist: Set<string>,
): Promise<SecurityLockdownOutput> {
  const activatedAt = new Date().toISOString();
  const actions: LockdownAction[] = [];
  let processesKilled = 0;
  let firewallRulesAdded = 0;
  let screenLocked = false;

  // Kill non-whitelisted processes
  if (input.kill_non_whitelisted) {
    try {
      const pids = await runner.listNonWhitelistedPids(whitelist);
      for (const pid of pids) {
        const killed = await runner.killProcess(pid);
        if (killed) {
          processesKilled++;
        }
      }
      actions.push({
        action: "kill_non_whitelisted_processes",
        success: true,
        details: `Killed ${processesKilled} non-whitelisted process(es).`
      });
    } catch (error) {
      actions.push({
        action: "kill_non_whitelisted_processes",
        success: false,
        details: error instanceof Error ? error.message : "Failed to kill processes."
      });
    }
  }

  // Block all outbound connections via Windows Firewall
  if (input.block_outbound) {
    const ruleName = `Jarvis-Lockdown-BlockOutbound-${Date.now()}`;
    try {
      const { stdout } = await runner.exec(
        `netsh advfirewall firewall add rule name="${ruleName}" dir=out action=block protocol=any enable=yes`
      );
      const success = stdout.toLowerCase().includes("ok");
      if (success) {
        firewallRulesAdded++;
      }
      actions.push({
        action: "block_outbound_connections",
        success,
        details: success ? `Rule '${ruleName}' added.` : "Failed to add outbound block rule."
      });
    } catch (error) {
      actions.push({
        action: "block_outbound_connections",
        success: false,
        details: error instanceof Error ? error.message : "Failed to block outbound."
      });
    }
  }

  // Apply maximum-level additional restrictions
  if (input.level === "maximum") {
    // Disable RDP
    try {
      await runner.exec("netsh advfirewall firewall add rule name=\"Jarvis-Lockdown-BlockRDP\" dir=in action=block protocol=tcp localport=3389 enable=yes");
      firewallRulesAdded++;
      actions.push({ action: "block_rdp_inbound", success: true, details: "RDP port 3389 blocked inbound." });
    } catch (error) {
      actions.push({
        action: "block_rdp_inbound",
        success: false,
        details: error instanceof Error ? error.message : "Failed to block RDP."
      });
    }

    // Disable SMB
    try {
      await runner.exec("netsh advfirewall firewall add rule name=\"Jarvis-Lockdown-BlockSMB\" dir=in action=block protocol=tcp localport=445 enable=yes");
      firewallRulesAdded++;
      actions.push({ action: "block_smb_inbound", success: true, details: "SMB port 445 blocked inbound." });
    } catch (error) {
      actions.push({
        action: "block_smb_inbound",
        success: false,
        details: error instanceof Error ? error.message : "Failed to block SMB."
      });
    }
  }

  // Lock screen
  if (input.lock_screen) {
    try {
      await runner.exec("rundll32.exe user32.dll,LockWorkStation");
      screenLocked = true;
      actions.push({ action: "lock_screen", success: true, details: "Workstation locked." });
    } catch (error) {
      actions.push({
        action: "lock_screen",
        success: false,
        details: error instanceof Error ? error.message : "Failed to lock screen."
      });
    }
  }

  return {
    activated_at: activatedAt,
    level: input.level,
    actions_taken: actions,
    processes_killed: processesKilled,
    firewall_rules_added: firewallRulesAdded,
    screen_locked: screenLocked
  };
}
