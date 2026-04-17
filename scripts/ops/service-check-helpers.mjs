/**
 * Tiny arg parser shared between service-check and preflight so they don't
 * pull in the bigger common.mjs (which transitively reaches into OpenClaw
 * profile config resolution we don't need for preflight).
 */
export { PROBE_PROFILES } from "./service-check.mjs";

export function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq > 0) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
    } else {
      args[token.slice(2)] = true;
    }
  }
  return args;
}
