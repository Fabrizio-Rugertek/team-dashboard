# Team Dashboard Operations

## Runtime
- App path on VM: `/home/openclaw/team-dashboard`
- Service: `team-dashboard.service`
- Reverse proxy: `dashboard.torus.dev -> 127.0.0.1:3511`
- Public URL: `https://dashboard.torus.dev/equipo`

## Deploy
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Fabrizio-Rugertek/team-dashboard/master/deploy/deploy.sh)
```

## Secrets
Deploy reads Odoo credentials from:
- `/home/openclaw/.openclaw/workspace/.secrets/credentials.json`
- entry: `odoo_torus`

No production credentials should be committed into `.env`.

## Performance model
The dashboard page uses one bootstrap request:
- `GET /api/equipo/bootstrap`

That endpoint fans out server-side and reuses short-lived cache entries:
- users cache: 5 minutes
- projects cache: 45 seconds
- timesheets cache by window: 45 seconds
- bootstrap payload: 45 seconds

This reduces repeated XML-RPC roundtrips to Odoo when the browser loads `/equipo`.

The app also prewarms the bootstrap endpoint:
- initial warmup: ~1.5 seconds after process start
- recurring warmup: every 30 seconds by default

Environment flags:
- `ENABLE_PREWARM=true`
- `PREWARM_INTERVAL_MS=30000`

Projects are paginated:
- bootstrap returns page 1
- additional pages are loaded from `GET /api/equipo/projects?page=N&pageSize=20`

The service also persists the latest successful bootstrap snapshot to:
- `data/cache/equipo-bootstrap.json`

If Odoo is unavailable, the API serves this snapshot as a stale fallback instead of failing hard.

The frontend also shows a stale-data banner when snapshot fallback is in use.

## Useful commands
```bash
sudo systemctl status team-dashboard --no-pager
sudo journalctl -u team-dashboard -n 100 --no-pager
curl -s http://127.0.0.1:3511/api/equipo/bootstrap | jq '.summary'
```

## Troubleshooting
### Dashboard is slow
1. Check service logs.
2. Hit `/api/equipo/bootstrap` locally and inspect response time.
3. If Odoo is slow, XML-RPC latency dominates; app cache only hides repeated reads.

### Nginx 502
1. Check `systemctl status team-dashboard`.
2. Confirm local app responds on port `3511`.
3. Check nginx site config and reload.

### Credential failure
1. Verify `credentials.json` exists.
2. Verify the `odoo_torus` entry is present and valid.
3. Re-run deploy script to regenerate `.env`.
