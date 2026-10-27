#!/usr/bin/env bash
# Creates a dedicated nginx server block for Discrello and obtains a Let's Encrypt certificate.
#
#   sudo deploy/setup-nginx.sh <domain> <email-for-letsencrypt> [app-port]
#   sudo deploy/setup-nginx.sh discrello.duckdns.org admin@example.com 3100
#
# Safe on a server that already runs other nginx sites:
#   - writes only its own file (discrello.conf); other configs are never modified
#   - refuses to run if another config already serves the same domain
#   - puts the file where this nginx actually loads site configs from (read from `nginx -T`)
#   - runs `nginx -t` before every reload and removes its own file again if the test fails
# Requirements: nginx, certbot with the nginx plugin (apt install certbot python3-certbot-nginx),
# the domain pointing at this server (deploy/duckdns-update.sh), and the container running
# (docker compose up -d --build). Safe to re-run.
set -euo pipefail

usage="usage: sudo $0 <domain> <email> [port]"
DOMAIN="${1:?$usage}"
EMAIL="${2:?$usage}"
PORT="${3:-3100}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$HERE/nginx/discrello.conf.template"
MARKER='Discrello — dedicated nginx server block'

fail() { echo "ERROR: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }
reload_nginx() { systemctl reload nginx 2>/dev/null || nginx -s reload; }
indent() { sed 's/^/      /'; }

[ "$(id -u)" -eq 0 ] || fail "run with sudo"
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || fail "invalid domain: $DOMAIN"
[[ "$PORT" =~ ^[0-9]+$ ]] || fail "invalid port: $PORT"
[ -f "$TEMPLATE" ] || fail "template not found: $TEMPLATE"
command -v nginx >/dev/null || fail "nginx is not installed"
command -v certbot >/dev/null || fail "certbot is not installed: apt install certbot python3-certbot-nginx"
certbot plugins 2>/dev/null | grep -q '^\* nginx' || fail "certbot nginx plugin missing: apt install python3-certbot-nginx"

step "Checking that this host's nginx is the one serving port 80"
PORT80_OWNER="$(ss -Hltnp 'sport = :80' 2>/dev/null | grep -oE 'users:\(\("[^"]+"' | head -n 1 | cut -d'"' -f2 || true)"
echo "    port 80 is held by: ${PORT80_OWNER:-<nothing / unknown>}"
if [ -n "$PORT80_OWNER" ] && [ "$PORT80_OWNER" != "nginx" ]; then
  fail "port 80 is held by '$PORT80_OWNER', not by this host's nginx ('docker-proxy' means nginx runs in a container). Add the server block from $TEMPLATE to that nginx's own configuration instead."
fi

step "Finding where this nginx loads site configs from"
NGINX_DUMP="$(nginx -T 2>/dev/null)" || fail "nginx -T failed; the existing nginx configuration has errors"
INCLUDES="$(printf '%s\n' "$NGINX_DUMP" | sed -nE 's/^[[:space:]]*include[[:space:]]+([^;]+);.*/\1/p')"
if printf '%s\n' "$INCLUDES" | grep -q 'sites-enabled/' && [ -d /etc/nginx/sites-available ] && [ -d /etc/nginx/sites-enabled ]; then
  CONF=/etc/nginx/sites-available/discrello.conf
  LINK=/etc/nginx/sites-enabled/discrello.conf
elif printf '%s\n' "$INCLUDES" | grep -qE 'conf\.d/[^ ]*\*' && [ -d /etc/nginx/conf.d ]; then
  CONF=/etc/nginx/conf.d/discrello.conf
  LINK=""
else
  printf '%s\n' "$INCLUDES" | indent >&2
  fail "this nginx includes neither sites-enabled/ nor conf.d/*.conf (includes listed above); add $TEMPLATE manually"
fi
echo "    using ${LINK:-$CONF}"

# Leftovers of an earlier run in a directory nginx does not load (identified by our marker line).
for stale in /etc/nginx/sites-enabled/discrello.conf /etc/nginx/sites-available/discrello.conf /etc/nginx/conf.d/discrello.conf; do
  [ "$stale" = "$CONF" ] || [ "$stale" = "${LINK:-}" ] && continue
  if [ -L "$stale" ] || { [ -f "$stale" ] && grep -qF "$MARKER" "$stale"; }; then
    rm -f "$stale"
    echo "    removed leftover $stale from a previous run"
  fi
done

step "Checking that no other nginx site already serves $DOMAIN"
DOMAIN_RE="${DOMAIN//./\\.}"
if grep -RIls --exclude='discrello.conf*' -E "server_name[^;]*[[:space:]]${DOMAIN_RE}([[:space:];]|$)" /etc/nginx/ >/dev/null; then
  grep -RIl --exclude='discrello.conf*' -E "server_name[^;]*[[:space:]]${DOMAIN_RE}([[:space:];]|$)" /etc/nginx/ >&2 || true
  fail "the file(s) above already use server_name $DOMAIN; pick another subdomain"
fi

step "Checking that $DOMAIN points at this server"
PUBLIC_IP="$(curl -fsS -4 -m 10 https://api.ipify.org || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}' || true)"
echo "    $DOMAIN -> ${DNS_IP:-<no A record>}, this server -> ${PUBLIC_IP:-<unknown>}"
if [ "${SKIP_DNS_CHECK:-0}" != "1" ]; then
  [ -n "$DNS_IP" ] || fail "$DOMAIN does not resolve yet; run deploy/duckdns-update.sh and wait a minute"
  if [ -n "$PUBLIC_IP" ] && [ "$DNS_IP" != "$PUBLIC_IP" ]; then
    fail "$DOMAIN points at $DNS_IP, not at this server ($PUBLIC_IP); run deploy/duckdns-update.sh (or SKIP_DNS_CHECK=1 behind NAT)"
  fi
fi

# Discrello's health answer, not just any 2xx/3xx (a redirect or another service must not pass).
is_discrello_health() { curl -fsS -m 10 "$@" | grep -q '"ok":true'; }

step "Checking that Discrello answers on 127.0.0.1:$PORT"
is_discrello_health "http://127.0.0.1:$PORT/api/health" \
  || fail "Discrello does not answer on 127.0.0.1:$PORT; start it with: docker compose up -d --build"

step "Writing $CONF"
BACKUP=""
if [ -f "$CONF" ]; then
  BACKUP="$CONF.bak.$(date +%Y%m%d%H%M%S)"
  cp -p "$CONF" "$BACKUP"
  echo "    previous version saved as $BACKUP"
fi
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$PORT/g" "$TEMPLATE" > "$CONF"
if [ -n "$LINK" ]; then ln -sfn "$CONF" "$LINK"; fi

revert() {
  if [ -n "$BACKUP" ]; then mv -f "$BACKUP" "$CONF"; else rm -f "$CONF"; if [ -n "$LINK" ]; then rm -f "$LINK"; fi; fi
}

step "Testing the nginx configuration"
if ! nginx -t; then
  echo "    nginx -t failed: reverting Discrello's file; other sites were not touched" >&2
  revert
  fail "nginx configuration test failed (see above)"
fi
if ! nginx -T 2>/dev/null | grep -qxF -e "# configuration file $CONF:" -e "# configuration file ${LINK:-$CONF}:"; then
  revert
  fail "nginx does not load ${LINK:-$CONF}; check the include lines in /etc/nginx/nginx.conf"
fi
reload_nginx
sleep 1

# Go through the public address, like Trello and Let's Encrypt will. Going through 127.0.0.1 can
# reach a different server block (e.g. one that listens on 127.0.0.1:80 for a status page).
CHECK_IP="${DNS_IP:-127.0.0.1}"
step "Checking http://$DOMAIN through nginx (via $CHECK_IP, the address Trello and Let's Encrypt use)"
if ! is_discrello_health --resolve "$DOMAIN:80:$CHECK_IP" "http://$DOMAIN/api/health"; then
  echo "    Instead of Discrello, this answered:" >&2
  curl -sS -m 10 -i --resolve "$DOMAIN:80:$CHECK_IP" "http://$DOMAIN/api/health" 2>&1 | head -n 12 | indent >&2 || true
  echo "    listen / server_name lines of the running configuration:" >&2
  nginx -T 2>/dev/null | grep -E '^# configuration file|^[[:space:]]*(listen|server_name)[[:space:]]' | head -n 60 | indent >&2 || true
  fail "nginx does not route $DOMAIN to 127.0.0.1:$PORT (details above; nothing else was changed and certbot was not run)"
fi

step "Requesting the Let's Encrypt certificate (certbot adds HTTPS + redirect to this block only)"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect --keep-until-expiring
nginx -t
reload_nginx

step "Checking https://$DOMAIN"
is_discrello_health "https://$DOMAIN/api/health" || fail "https://$DOMAIN/api/health does not return Discrello's health"
echo "    OK"
echo
echo "Done. Set in .env:  DOMAIN=$DOMAIN  and  PUBLIC_BASE_URL=https://$DOMAIN"
echo "then restart the app:  docker compose up -d"
echo "Certificates renew automatically (certbot timer): check with  sudo certbot renew --dry-run"
