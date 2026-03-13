# Nginx Proxy Configuration

Song generation via Suno API can take up to 10 minutes. Default nginx `proxy_read_timeout` (60s) will kill the connection before the response arrives.

## Configuration

```nginx
# /etc/nginx/sites-available/near-fm

# Suno endpoints — 10 min timeout
location /api/suno/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_read_timeout 600s;
    proxy_connect_timeout 10s;
    proxy_send_timeout 30s;
    proxy_buffering off;
}

# All other API endpoints — default 60s
location /api/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_read_timeout 60s;
    proxy_connect_timeout 10s;
    proxy_send_timeout 30s;
}
```

## Key settings

| Directive | Value | Why |
|-----------|-------|-----|
| `proxy_read_timeout 600s` | 10 min | Suno generation is slow, server waits for callback |
| `proxy_buffering off` | — | Stream response immediately, useful if we add SSE later |
| `proxy_connect_timeout 10s` | 10s | Fail fast if upstream is down |

## Apply

```bash
sudo nginx -t && sudo systemctl reload nginx
```
