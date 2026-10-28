#!/bin/bash
set -euo pipefail
test "$(cat /var/lib/mayak-infrastructure-identity)" = 'mayak-infrastructure-20261028:9201'
src=/root/mayak-acceptance-20261028/deploy
id -u mayak-observer >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin mayak-observer
install -m 0755 "$src/probe.py" /usr/local/bin/mayak-probe
install -m 0644 "$src/probe.json" /etc/mayak-probe.json
install -m 0644 "$src/ca.crt" /etc/mayak-infrastructure-ca.crt
# Only this dedicated client uses the laboratory resolver.
if test -L /etc/resolv.conf; then rm /etc/resolv.conf; fi
printf 'nameserver 172.30.253.20\noptions timeout:1 attempts:1\n' > /etc/resolv.conf
install -m 0644 "$src/mayak-probe.service" /etc/systemd/system/mayak-probe.service
install -m 0644 "$src/mayak-probe.timer" /etc/systemd/system/mayak-probe.timer
systemctl daemon-reload
systemctl enable --now mayak-probe.timer
