#!/bin/bash
# Deploy Torus Dashboard Platform to the RuBot VM.
# Run on the VM as:
# bash <(curl -fsSL https://raw.githubusercontent.com/Fabrizio-Rugertek/team-dashboard/master/deploy/deploy.sh)

set -euo pipefail

REPO_URL="https://github.com/Fabrizio-Rugertek/team-dashboard.git"
EXPECTED_HOSTNAME="vm-rugertek-bot"
APP_DIR="/home/openclaw/team-dashboard"
APP_USER="openclaw"
SERVICE_NAME="team-dashboard"
SERVICE_UNIT="${SERVICE_NAME}.service"
PORT="3511"
SITE_NAME="dashboard.torus.dev"
SECRETS_JSON="/home/openclaw/.openclaw/workspace/.secrets/credentials.json"
NGINX_SITE_ENABLED="/etc/nginx/sites-enabled/${SITE_NAME}"
NGINX_SITE_AVAILABLE="/etc/nginx/sites-available/${SITE_NAME}"

log() { echo "[deploy] $*"; }
fail() { echo "[deploy] ERROR: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 no esta instalado"
}

ensure_host() {
  local actual
  actual="$(hostname)"
  [ "$actual" = "$EXPECTED_HOSTNAME" ] || fail "host incorrecto: esperado $EXPECTED_HOSTNAME y recibi $actual"
}

ensure_repo_clean() {
  if [ -n "$(git -C "$APP_DIR" status --porcelain)" ]; then
    fail "repo con cambios locales en $APP_DIR; no hago deploy destructivo"
  fi
}

sync_repo() {
  if [ -d "$APP_DIR/.git" ]; then
    ensure_repo_clean
    log "Actualizando repo con fast-forward only"
    git -C "$APP_DIR" fetch origin master
    if [ "$(git -C "$APP_DIR" rev-parse HEAD)" != "$(git -C "$APP_DIR" rev-parse origin/master)" ]; then
      git -C "$APP_DIR" pull --ff-only origin master
    else
      log "Repo ya esta al dia"
    fi
  else
    log "Clonando repo en $APP_DIR"
    mkdir -p "$(dirname "$APP_DIR")"
    git clone "$REPO_URL" "$APP_DIR"
    chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
  fi
}

install_dependencies() {
  log "Instalando dependencias de produccion"
  cd "$APP_DIR"
  npm ci --omit=dev
}

generate_env() {
  [ -f "$SECRETS_JSON" ] || fail "no existe $SECRETS_JSON"

  log "Generando .env desde odoo_torus"
  python3 - <<'PY2' > "$APP_DIR/.env"
import json
from pathlib import Path

p = Path('/home/openclaw/.openclaw/workspace/.secrets/credentials.json')
data = json.loads(p.read_text(encoding='utf-8'))
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
PY2
  chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
}

install_service() {
  [ -f "$APP_DIR/deploy/team-dashboard.service" ] || fail "falta deploy/team-dashboard.service"

  log "Instalando/actualizando systemd service"
  sudo install -o root -g root -m 0644 "$APP_DIR/deploy/team-dashboard.service" "/etc/systemd/system/$SERVICE_UNIT"
  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_UNIT" >/dev/null
  sudo systemctl restart "$SERVICE_UNIT"
}

validate_nginx() {
  local site_path=""

  if [ -f "$NGINX_SITE_ENABLED" ]; then
    site_path="$NGINX_SITE_ENABLED"
  elif [ -f "$NGINX_SITE_AVAILABLE" ]; then
    site_path="$NGINX_SITE_AVAILABLE"
  else
    fail "no existe vhost de nginx para $SITE_NAME; no instalo nginx automaticamente en este script"
  fi

  grep -q "server_name $SITE_NAME;" "$site_path" || fail "el vhost $site_path no corresponde a $SITE_NAME"
  grep -q "proxy_pass http://127.0.0.1:$PORT;" "$site_path" || fail "el vhost $site_path no apunta a 127.0.0.1:$PORT"

  log "Validando y recargando nginx"
  sudo nginx -t
  sudo systemctl reload nginx
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempt

  for attempt in $(seq 1 20); do
    if curl -fsS -m 15 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  fail "$label no respondio a tiempo: $url"
}

verify_runtime() {
  log "Verificando servicio local"
  wait_for_http "http://127.0.0.1:$PORT/" "servicio local"

  log "Verificando endpoint publico"
  wait_for_http "https://$SITE_NAME/" "endpoint publico"
}

show_summary() {
  echo
  log "Commit desplegado: $(git -C "$APP_DIR" rev-parse --short HEAD)"
  log "Servicio: $SERVICE_UNIT"
  log "URL publica: https://$SITE_NAME/equipo"
}

main() {
  require_cmd git
  require_cmd node
  require_cmd npm
  require_cmd python3
  require_cmd curl
  require_cmd nginx
  require_cmd systemctl
  ensure_host
  sync_repo
  install_dependencies
  generate_env
  install_service
  validate_nginx
  verify_runtime
  show_summary
}

main "$@"
