#!/usr/bin/env bash
# Points the Discrello DuckDNS subdomain at the public IP of the machine running this script.
# Run it on the VPS. Other DuckDNS subdomains of the same account are not changed.
#
#   deploy/duckdns-update.sh
#
# Reads DUCKDNS_SUBDOMAIN and DUCKDNS_TOKEN from the environment or from .env (the file is only
# read, never executed). The subdomain must first be created on https://www.duckdns.org — the API
# can update a subdomain's IP but cannot create one.
#
# Keep it current if the VPS IP can change (crontab -e):
#   */5 * * * * /path/to/discrello/deploy/duckdns-update.sh >> /var/log/duckdns-discrello.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
from_env_file() { [ -f "$ROOT/.env" ] && grep -E "^$1=" "$ROOT/.env" | tail -n 1 | cut -d= -f2- || true; }

SUBDOMAIN="${DUCKDNS_SUBDOMAIN:-$(from_env_file DUCKDNS_SUBDOMAIN)}"
TOKEN="${DUCKDNS_TOKEN:-$(from_env_file DUCKDNS_TOKEN)}"
SUBDOMAIN="${SUBDOMAIN%.duckdns.org}"

[ -n "$SUBDOMAIN" ] || { echo "ERROR: set DUCKDNS_SUBDOMAIN (the part before .duckdns.org) in .env" >&2; exit 1; }
[ -n "$TOKEN" ] || { echo "ERROR: set DUCKDNS_TOKEN (shown at the top of duckdns.org after login) in .env" >&2; exit 1; }

# An empty ip= makes DuckDNS use the address this request comes from, i.e. this server.
RESULT="$(curl -fsS -m 20 "https://www.duckdns.org/update?domains=${SUBDOMAIN}&token=${TOKEN}&ip=" || true)"
if [ "$RESULT" = "OK" ]; then
  echo "$(date -Is) OK: ${SUBDOMAIN}.duckdns.org -> $(curl -fsS -4 -m 10 https://api.ipify.org 2>/dev/null || echo 'this server')"
else
  echo "$(date -Is) DuckDNS answered '${RESULT:-no answer}'. KO means a wrong token, or ${SUBDOMAIN} is not a subdomain of this account." >&2
  exit 1
fi
