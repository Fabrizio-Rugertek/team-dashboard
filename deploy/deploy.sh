#!/bin/bash
# Deploy Torus Dashboard Platform to VM
# Run this on the VM as: bash <(curl -s https://raw.githubusercontent.com/Fabrizio-Rugerte/team-dashboard/master/deploy/deploy.sh)

set -e

APP_DIR="/home/openclaw/team-dashboard"
SERVICE_NAME="team-dashboard"
PORT=3511

echo "=== Torus Dashboard Deployment ==="

# Create app directory
mkdir -p $APP_DIR

# Clone or pull latest
if [ -d "$APP_DIR/.git" ]; then
    echo "Pulling latest..."
    cd $APP_DIR && git pull origin master
else
    echo "Cloning repo..."
    git clone https://github.com/Fabrizio-Rugerte/team-dashboard.git $APP_DIR
fi

# Install dependencies
cd $APP_DIR && npm install --production

# Create .env from template
if [ ! -f "$APP_DIR/.env" ]; then
    cat > $APP_DIR/.env << 'EOF'
PORT=3511
ODOO_URL=https://www.torus.dev
ODOO_DB=rugertek-company-odoo-production-17029773
ODOO_USER=odoo@rugertek.com
ODOO_PASSWORD=GGAmLPq@FxyUL85
EOF
    echo "Created .env file"
fi

# Copy systemd service
sudo cp $APP_DIR/deploy/team-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_NAME
sudo systemctl restart $SERVICE_NAME

# Setup nginx (if not already)
if [ ! -f /etc/nginx/sites-enabled/dashboard.torus.dev.conf ]; then
    sudo cp $APP_DIR/deploy/nginx-dashboard.torus.dev.conf /etc/nginx/sites-available/
    sudo ln -sf /etc/nginx/sites-available/dashboard.torus.dev.conf /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx
fi

# Check status
sudo systemctl status $SERVICE_NAME --no-pager

echo ""
echo "=== Deployment Complete ==="
echo "Dashboard: http://dashboard.torus.dev"
echo "API test: curl http://localhost:$PORT/api/equipo/summary"
