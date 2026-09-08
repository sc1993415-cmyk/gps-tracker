#!/bin/bash
set -euxo pipefail
install -m 644 /opt/gps-tracker/deploy/gps-receiver.service /etc/systemd/system/gps-receiver.service
install -m 644 /opt/gps-tracker/deploy/gps-overlay.service /etc/systemd/system/gps-overlay.service
systemctl daemon-reload
systemctl enable gps-receiver gps-overlay
systemctl restart gps-receiver gps-overlay
# firewall
if command -v ufw >/dev/null 2>&1; then
  ufw allow 5013/tcp || true
  ufw allow 8787/tcp || true
  ufw allow 8790/tcp || true
  ufw allow 4173/tcp || true
fi
if command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port=5013/tcp || true
  firewall-cmd --permanent --add-port=8787/tcp || true
  firewall-cmd --permanent --add-port=8790/tcp || true
  firewall-cmd --permanent --add-port=4173/tcp || true
  firewall-cmd --reload || true
fi
systemctl --no-pager --full status gps-receiver gps-overlay || true
ss -lntp | grep -E '5013|8787|8790|4173' || true
curl -sI http://127.0.0.1:8790/ | head -5 || true
curl -sI http://127.0.0.1:4173/ | head -5 || true
