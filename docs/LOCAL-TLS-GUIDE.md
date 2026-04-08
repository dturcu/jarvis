# Local TLS Guide

## Why

By default the Jarvis dashboard API serves plain HTTP.  When accessed only
from `localhost` (the default `bind_host`) this is fine -- traffic never
leaves the machine.  However, if you bind the dashboard to `0.0.0.0` or a
LAN address so other machines can reach it, credentials and session tokens
transit in plaintext over the network.  A TLS reverse proxy in front of the
dashboard fixes this.

## When needed

- You access the dashboard from **another machine** on your LAN.
- You expose the dashboard through a tunnel (ngrok, Tailscale Funnel, etc.).

If you only access the dashboard on `http://localhost:3100` (the default),
you do **not** need TLS.

## Option A: nginx with a self-signed certificate

Generate a self-signed cert (valid 365 days):

```bash
mkdir -p ~/.jarvis/tls
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout ~/.jarvis/tls/key.pem \
  -out    ~/.jarvis/tls/cert.pem \
  -days 365 -subj "/CN=jarvis.local"
```

Minimal nginx config (`/etc/nginx/sites-enabled/jarvis`):

```nginx
server {
    listen 443 ssl;
    server_name jarvis.local;

    ssl_certificate     /home/YOU/.jarvis/tls/cert.pem;
    ssl_certificate_key /home/YOU/.jarvis/tls/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Set `trust_proxy: true` in `~/.jarvis/config.json` so the dashboard
reads `X-Forwarded-*` headers correctly.

## Option B: Caddy (automatic self-signed)

Install Caddy, then create a `Caddyfile`:

```caddyfile
jarvis.local {
    reverse_proxy 127.0.0.1:3100
    tls internal
}
```

Run:

```bash
caddy run
```

Caddy generates and trusts a local CA automatically.  Set `trust_proxy: true`
in config.json as above.

## Notes

- Both options keep the dashboard itself on `127.0.0.1:3100` -- only the
  reverse proxy listens on the LAN interface.
- Browsers will warn about self-signed certs.  Import `cert.pem` (nginx) or
  Caddy's root CA into your trust store to suppress warnings.
- For production deployments, use a proper CA (Let's Encrypt via Caddy, etc.).
