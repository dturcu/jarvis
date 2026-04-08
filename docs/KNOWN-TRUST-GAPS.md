# Known Trust Gaps

Honest inventory of security boundaries that are documented but not yet enforced. See THREAT-MODEL.md for the full threat model.

## Worker Process Isolation Is Cooperative

Workers labeled `child_process` (browser, interpreter, files, device, voice, security, social) spawn a separate Node.js process. This provides crash isolation but not an OS-level sandbox. A compromised worker can read host filesystem, network, and environment variables. There is no seccomp, AppArmor, or container boundary.

## No TLS on Local APIs

The dashboard HTTP server and LM Studio inference endpoint use plaintext HTTP on localhost. A local attacker or malicious process on the same machine can intercept API tokens and job payloads in transit. Acceptable for single-machine use; not safe for remote access without a TLS-terminating reverse proxy.

## Credentials Stored in Plaintext

OAuth tokens, API keys, the Telegram bot token, and API auth tokens live as plaintext JSON in `~/.jarvis/config.json`. File permissions (user-only read/write) are the only protection. There is no encryption at rest, no OS keychain integration, and no HSM support.

## Godmode Has Its Own LLM Loop

The `/api/godmode` endpoint runs a separate chat completion loop with tool access. It is restricted to admin/operator roles and is read-only (cannot send emails, write files, or execute shell commands). However, it does invoke LLM inference independently of the agent pipeline, which means its outputs are not subject to the approval workflow.

## Telegram Conversation History Is Process-Global

The Telegram bot stores conversation context in process memory, shared across all users of the bot. Anyone with access to the Telegram chat ID can see prior conversation turns. There is no per-user session isolation on the Telegram surface.

## No Credential Access Audit Log

**Status: Partially mitigated** — `packages/jarvis-security/src/credential-audit.ts` provides an audited wrapper around `getCredentialsForWorker()` that logs every credential distribution to the `audit_log` table. The wrapper (`createAuditedCredentialAccessor`) records worker ID, distributed credential keys, associated run/job IDs, and timestamps. Query function `queryCredentialAccessLog()` enables retrospective investigation.

**Remaining gap:** The daemon must adopt the audited accessor (replace direct `getCredentialsForWorker` calls with the wrapped version). Until then, credential reads are logged only in code paths that explicitly use the wrapper.

## No Database Integrity Verification

SQLite databases have no checksums or tamper detection at the application layer. A local attacker with file access can modify `runtime.db`, `crm.db`, or `knowledge.db` directly. Backup manifests include SHA256 checksums, but there is no runtime integrity monitoring.

## Inference Prompt Injection

Agent system prompts are static, but job inputs can contain adversarial content. There is no output filtering or sandboxed evaluation of LLM responses before they become plan steps. The approval pipeline catches mutating actions but not information exfiltration via read-only tools.
