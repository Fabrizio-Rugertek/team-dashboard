#!/bin/bash
# Deploy Torus Dashboard Platform to VM
# Run on the VM as:
# bash <(curl -fsSL https://raw.githubusercontent.com/Fabrizio-Rugertek/team-dashboard/master/deploy/deploy.sh)

set -euo pipefail

REPO_URL="https://github.com/Fabrizio-Rugertek/team-dashboard.git"
APP_DIR="/home/openclaw/team-dashboard"
APP_USER="openclaw"
SERVICE_NAME="team-dashboard"
PORT="3511"
SITE_NAME="dashboard.torus.dev"
SECRETS_JSON="/home/openclaw/.openclaw/workspace/.secrets/credentials.json"

log() { echo "[deploy] $*"; }
fail() { echo "[deploy] ERROR: $*" >&2; exit 1; }

command -v git >/dev/null || fail "git no esta instalado"
command -v node >/dev/null || fail "node no esta instalado"
command -v npm >/dev/null || fail "npm no esta instalado"
command -v python3 >/dev/null || fail "python3 no esta instalado"
command -v nginx >/dev/null || fail "nginx no esta instalado"

log "Preparando $APP_DIR"
mkdir -p "$APP_DIR"

if [ -d "$APP_DIR/.git" ]; then
  log "Actualizando repo"
  git -C "$APP_DIR" fetch origin master
  git -C "$APP_DIR" reset --hard origin/master
else
  log "Clonando repo"
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
log "Instalando dependencias"
npm ci --omit=dev

if [ ! -f "$SECRETS_JSON" ]; then
  fail "No existe $SECRETS_JSON; no puedo generar .env sin secretos"
fi

log "Generando .env desde credenciales de OpenClaw"
python3 - <<'PY' > "$APP_DIR/.env"
import json, sys
p = '/home/openclaw/.openclaw/workspace/.secrets/credentials.json'
with open(p, 'r', encoding='utf-8') as f:
    data = json.load(f)
cfg = data.get('odoo_torus') or {}
url = cfg.get('url')
db = cfg.get('database') or cfg.get('db')
user = cfg.get('username') or cfg.get('user') or cfg.get('login')
pwd = cfg.get('password')
missing = [name for name, value in [('url', url), ('db', db), ('user', user), ('password', pwd)] if not value]
if missing:
    raise SystemExit(f'Faltan credenciales en odoo_torus: {", ".join(missing)}')
print('PORT=3511')
print(f'ODOO_URL={url}')
print(f'ODOO_DB={db}')
print(f'ODOO_USER={user}')
print(f'ODOO_PASSWORD={pwd}')
PY
chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

log "Instalando service systemd"
sudo cp "$APP_DIR/deploy/team-dashboard.service" "/etc/systemd/system/$SERVICE_NAME.service"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

log "Configurando nginx"
sudo cp "$APP_DIR/deploy/nginx-dashboard.torus.dev.conf" "/etc/nginx/sites-available/$SITE_NAME"
sudo ln -sfn "/etc/nginx/sites-available/$SITE_NAME" "/etc/nginx/sites-enabled/$SITE_NAME"
sudo nginx -t
sudo systemctl reload nginx

log "Estado del servicio"
sudo systemctl --no-pager --full status "$SERVICE_NAME" || true

echo
log "Deploy completado"
echo "HTTP local: http://127.0.0.1:$PORT/equipo"
echo "Host esperado: https://$SITE_NAME/equipo"
