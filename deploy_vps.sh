#!/usr/bin/env bash
# TelemetryHub Pro - Automated VPS Deployment Script (Ubuntu / Debian)
set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME="$(whoami)"

echo "=== [1/5] Checking and Installing Dependencies ==="
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv nginx curl git

# Install Node.js if missing
if ! command -v node &> /dev/null; then
    echo "Installing Node.js LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "=== [2/5] Setting up Python Virtualenv & Backend ==="
cd "$APP_DIR/backend"
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "=== [3/5] Building Frontend SPA ==="
cd "$APP_DIR/frontend"
npm install
npm run build

echo "=== [4/5] Setting up Systemd Service ==="
SERVICE_FILE="/etc/systemd/system/telemetry-hub.service"
sudo bash -c "cat > $SERVICE_FILE" <<EOF
[Unit]
Description=TelemetryHub Pro Full-Stack Service
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$APP_DIR/backend
Environment="PATH=$APP_DIR/backend/venv/bin"
Environment="HOST=127.0.0.1"
Environment="PORT=8000"
Environment="DATABASE_PATH=$APP_DIR/backend/telemetry.db"
Environment="STORAGE_DIR=$APP_DIR/backend/storage"
Environment="FRONTEND_DIST=$APP_DIR/frontend/dist"
ExecStart=$APP_DIR/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable telemetry-hub
sudo systemctl restart telemetry-hub

echo "=== [5/5] Checking Service Status ==="
systemctl status telemetry-hub --no-pager

echo ""
echo "=========================================================="
echo " TelemetryHub is now running locally on port 8000!"
echo " Both Frontend and Backend are served from a single port."
echo "=========================================================="
echo ""
echo "Next step: Configure Nginx reverse proxy if you want domain & SSL."
echo "Example Nginx config:"
echo ""
echo "server {"
echo "    listen 80;"
echo "    server_name your-domain.com;"
echo "    client_max_body_size 500M;"
echo ""
echo "    location / {"
echo "        proxy_pass http://127.0.0.1:8000;"
echo "        proxy_set_header Host \$host;"
echo "        proxy_set_header X-Real-IP \$remote_addr;"
echo "        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"
echo "        proxy_set_header X-Forwarded-Proto \$scheme;"
echo "    }"
echo "}"
