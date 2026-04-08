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
