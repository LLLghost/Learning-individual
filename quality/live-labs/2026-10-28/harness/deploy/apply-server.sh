#!/bin/bash
set -euo pipefail
test "$(cat /var/lib/mayak-infrastructure-identity)" = 'mayak-infrastructure-20261028:9200'
src=/root/mayak-acceptance-20261028/deploy
id -u mayak-service >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin mayak-service
id -u mayak-dns >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin mayak-dns
install -d -m 0755 /etc/mayak-infrastructure /srv/mayak-infrastructure
install -d -m 0750 -o root -g mayak-service /srv/mayak-infrastructure/data /etc/mayak-infrastructure/tls
changed=0
copy() {
  local source=$1 target=$2 mode=$3 group=${4:-root}
  if ! cmp -s "$source" "$target"; then install -m "$mode" -o root -g "$group" "$source" "$target"; changed=$((changed+1)); fi
}
copy "$src/inventory-server.py" /usr/local/lib/mayak-inventory.py 0644
copy "$src/app.env" /etc/mayak-infrastructure/app.env 0644
copy "$src/dnsmasq.conf" /etc/mayak-infrastructure/dnsmasq.conf 0644
copy "$src/firewall.nft" /etc/mayak-infrastructure/firewall.nft 0644
copy "$src/mayak-inventory.service" /etc/systemd/system/mayak-inventory.service 0644
copy "$src/mayak-dns.service" /etc/systemd/system/mayak-dns.service 0644
copy "$src/mayak-firewall.service" /etc/systemd/system/mayak-firewall.service 0644
copy "$src/server.crt" /etc/mayak-infrastructure/tls/server.crt 0644 mayak-service
copy "$src/server.key" /etc/mayak-infrastructure/tls/server.key 0640 mayak-service
copy "$src/ca.crt" /etc/mayak-infrastructure/ca.crt 0644
systemctl daemon-reload
systemctl enable --now mayak-firewall.service mayak-dns.service mayak-inventory.service
printf 'configuration_changes=%s\n' "$changed"
