# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest on `master` | Yes |

## Reporting a Vulnerability

If you discover a security vulnerability in Jarvis, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **security@thinkingincode.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You will receive an acknowledgment within 48 hours. We aim to provide a fix or mitigation plan within 7 days for critical issues.

## Security Architecture

Jarvis is designed as a **single-node local appliance**. Key security properties:

- Dashboard API binds to `127.0.0.1` by default
- Production mode requires Bearer token authentication
- All irreversible actions (email, publishing) require explicit approval
- Credentials are stored in `~/.jarvis/config.json`, never in the repository
- Agent memory is durable (SQLite-backed), not transmitted externally

## Credential Handling

- Never commit secrets, API keys, or tokens to this repository
- Use environment variables or `~/.jarvis/config.json` for credentials
- The `.gitignore` excludes `.env`, `*.db`, and local configuration files
- A credential redaction system masks sensitive values in logs and API responses

## Dependencies

We monitor dependencies for known vulnerabilities using `npm audit`. If you find a vulnerable dependency, please report it using the process above.
