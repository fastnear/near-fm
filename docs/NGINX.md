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

## AI coin helpers — edge rate limit

Paid-inference routes are limited at nginx as well as in the app (5/min, 10/h, 20/day per IP; per-user daily quotas; global daily budget):

```nginx
limit_req_zone $binary_remote_addr zone=nearfm_ai:10m rate=10r/m;   # http context (top of the site file)

location ~ ^/api/songs/[^/]+/coins/(check|suggest)$ {
    limit_req zone=nearfm_ai burst=5 nodelay;
    limit_req_status 429;
    proxy_pass http://nearfm-api;
    # ... same proxy_set_header lines as `location /`
}
```

Only these paths are limited: the web container's SSR calls the API from one IP, so a blanket per-IP limit on `/api/` would throttle the site itself.
