# Security Engineer — Red-team review

Scope: dashboard HTTP surface, auth middleware, runtimes.ts, support/backup, webhook HMAC, token lifecycle. Bind is `127.0.0.1` by default and production mode fails closed without tokens — the base posture is good. Findings below are ordered by exploitability given a misconfigured deployment (`JARVIS_BIND_HOST=0.0.0.0`, `JARVIS_CORS_ORIGIN=*`, or a hostile local process).

## Top findings

1. **[high] SSRF via godmode `web_fetch` tool (OWASP A10)**
   - Evidence: `packages/jarvis-dashboard/src/api/tool-infra.ts:238-252` calls `fetch(url)` with any user-supplied URL; no scheme/host denylist.
   - Impact: Operator-role caller (or any successful prompt route) can force the server to GET `http://169.254.169.254/…`, `file://`, `http://127.0.0.1:<internal-port>` and exfiltrate bodies into chat.
   - Fix: Restrict to `http(s):` schemes, block RFC1918 / loopback / link-local addresses after DNS resolution, enforce max response size and timeout.

2. **[high] Path traversal & unchecked process spawn in llama.cpp loader (OWASP A01)**
   - Evidence: `packages/jarvis-dashboard/src/api/runtimes.ts:244-285` — `llamacppLoadModel(modelPath)` only checks `fs.existsSync(modelPath)` before `spawn(binary, ['-m', modelPath, …])`.
   - Impact: Admin-token caller can point the server at any file on disk (e.g., `/etc/shadow`-sized junk → DoS, or crafted GGUF path outside GGUF dirs) and spawn long-lived child processes repeatedly.
   - Fix: Resolve `modelPath` and require it to live inside an allowlisted directory returned by `getGgufDirs()`; reject symlinks via `realpathSync` + prefix check.

3. **[high] Token comparison is not constant-time (OWASP A07)**
   - Evidence: `packages/jarvis-dashboard/src/api/middleware/auth.ts:319` — `tokens.find(t => t.token === providedToken)`.
   - Impact: Across the network (non-localhost deploy) this leaks a timing oracle for byte-by-byte token recovery, especially since failures only trip rate limiting after 10 tries in 5 min.
   - Fix: Use `crypto.timingSafeEqual` on equal-length buffers; iterate all entries to avoid short-circuit.

4. **[high] Markdown renderer injects unescaped URLs → stored XSS (OWASP A03)**
   - Evidence: `packages/jarvis-dashboard/src/ui/components/godmode/shared.tsx:58` — `[txt](url)` rewritten to `<a href="$2">` without escaping `"` or blocking `javascript:`. HTML escaping at line 37 runs before this rule, so URLs are never sanitized.
   - Impact: Any LLM/tool output rendered in chat (or later pasted from audit bundle → dashboard) can fire `javascript:` or break out of `href="` to add `onclick`. Cookie is `httpOnly` but CSRF-style in-app navigation is still possible.
   - Fix: Validate URL scheme (allowlist `http/https/mailto/#`), HTML-attribute-encode, or replace the hand-rolled renderer with `marked` + DOMPurify.

5. **[high] Token rotation missing audit log + no invalidation of old sessions**
   - Evidence: `auth.ts:346-383` `/api/auth/rotate` writes the new token but calls neither `writeAuditLog` nor any revocation list; previous token remains valid until overwritten only because there is exactly one admin slot.
   - Impact: No paper trail for "who rotated when"; if role-map used, non-admin tokens are never rotated and there is no expiry field at all (seed finding confirmed).
   - Fix: `writeAuditLog('auth.token_rotated', …)`; add `token_issued_at` + `max_age_days` in config; return a warning when prior token age > N days.

6. **[medium] CORS origin accepted without validation or HTTPS enforcement**
   - Evidence: `server.ts:48,124` — `ALLOWED_ORIGIN = process.env.JARVIS_CORS_ORIGIN ?? …`; value echoed verbatim, including `*` or `http://evil.tld`. No `Access-Control-Allow-Credentials` header is set, which actually saves us from cookie exfil, but the cookie is `sameSite:'strict'` only — a non-credentialed request is still enough to probe internal endpoints via fetch and read responses.
   - Fix: Validate against an allowlist; reject `*`; require `https://` unless host is `localhost/127.0.0.1`; refuse boot if `appliance_mode && !origin.startsWith('https://')`.

7. **[medium] Webhook auth bypass dormant but live (OWASP A07)**
   - Evidence: `auth.ts:272-275` exempts `/api/webhooks*` from bearer auth; `webhooks-v2.ts:169` verifies HMAC only when `secret && signature` — i.e., if config lacks `webhook_secret`, signed requests are accepted as unsigned. Router is unmounted in `server.ts:12` today but the file is still bundled and the middleware exemption remains.
   - Fix: Delete `webhooks-v2.ts` and the auth exemption until OpenClaw ingress ships; when re-enabled, fail closed when secret missing.

8. **[medium] No security-response headers**
   - Evidence: No `helmet()`, no `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or HSTS anywhere in `server.ts`.
   - Impact: Dashboard iframe-clickjackable; XSS finding (#4) has no CSP backstop.
   - Fix: Add `helmet` with a tight CSP (`default-src 'self'`, `script-src 'self'`, no `unsafe-inline`); rebuild Vite with hashed inline styles.

9. **[medium] Rate limit bypass via loopback exemption + X-Forwarded-For trust**
   - Evidence: `auth.ts:240` skips rate-limit when IP is `127.0.0.1/::1`; `auth.ts:213-219` trusts `X-Forwarded-For` whenever `JARVIS_TRUST_PROXY=true`, with no allowlist of upstream proxy IPs.
   - Impact: Any local process can brute-force tokens unbounded; behind a misconfigured proxy, attacker spoofs `X-Forwarded-For: 127.0.0.1` to both (a) appear loopback and (b) skip per-IP blocking.
   - Fix: Rate-limit per-token-prefix regardless of IP; only trust the last proxy hop; never treat forwarded IP as loopback.

10. **[low] `list_files` tool has no project-root confinement**
    - Evidence: `tool-infra.ts:300-318` reads arbitrary `params.path` with `fs.readdirSync`; defaults to `~/Desktop`. Siblings `file_read`/`file_list` do enforce `PROJECT_ROOT` via `realpathSync`.
    - Impact: Read-only directory enumeration of whole filesystem via chat (e.g., `C:\Users`, `/etc`).
    - Fix: Apply the same `PROJECT_ROOT` prefix check used by `file_list`; deprecate `list_files` as a duplicate.

## Positive notes

- Backup restore (`backup.ts:158-164`) uses an explicit `ALLOWED_RESTORE` Set plus `/\\/..` filter and ships a pre-restore rollback snapshot — good defense-in-depth.
- Support bundle (`support.ts:37-50`) deliberately excludes `payload_json` and OAuth secret columns — correct least-disclosure.
- Production mode fails closed when no tokens are configured (`auth.ts:290-295`); appliance mode exits on boot if tokens missing (`server.ts:92-96`).
