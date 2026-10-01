#!/usr/bin/env bash
# CoachCompass MCP server — idempotent, test-gated, rollback-armed deploy.  Run as root on the VPS:
#   sudo bash /tmp/cc-mcp/cc-mcp-deploy.sh
#
# What it touches (and ONLY this):
#   /opt/coachcompass-mcp/{releases,current,shared,backups}   new app dir (owned root, run as user ccmcp)
#   /etc/systemd/system/coachcompass-mcp.service               new service on 127.0.0.1:8791
#   /etc/nginx/snippets/coachcompass-mcp.conf                  new: /mcp, /legal/ai-app-*, /.well-known/openai-apps-challenge
#   /etc/nginx/sites-enabled/coachcompass                      +1 include line (backed up first)
# It NEVER touches /home/claude/CoachCompass, the SQLite DB, coachcompass-api, or /var/www/coachcompass.
set -Eeuo pipefail

STAGE=/tmp/cc-mcp
TARBALL=$STAGE/coachcompass-mcp.tgz
APP=/opt/coachcompass-mcp
SITE=/etc/nginx/sites-enabled/coachcompass
SNIPPET=/etc/nginx/snippets/coachcompass-mcp.conf
UNIT=/etc/systemd/system/coachcompass-mcp.service
INCLUDE_LINE='    include /etc/nginx/snippets/coachcompass-mcp.conf;'
PORT=8791
TS=$(date -u +%Y%m%dT%H%M%SZ)
REL=$APP/releases/$TS
PUBLIC=https://coachcompass.co

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()  { printf '    \033[32m✓\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

PREV=""; NGINX_BAK=""; SNIPPET_EXISTED=0; WENT_LIVE=0; SMOKE_PID=""
rollback() {
  printf '\n\033[1;33m!! ROLLING BACK\033[0m\n' >&2
  if [ -n "$NGINX_BAK" ] && [ -f "$NGINX_BAK" ]; then cp -a "$NGINX_BAK" "$SITE"; echo "   restored $SITE" >&2; fi
  if [ "$SNIPPET_EXISTED" = 0 ]; then rm -f "$SNIPPET"; fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx && echo "   nginx reloaded" >&2
  if [ "$WENT_LIVE" = 1 ]; then
    if [ -n "$PREV" ] && [ -d "$PREV" ]; then
      ln -sfn "$PREV" "$APP/current"; systemctl restart coachcompass-mcp || true; echo "   service back on $PREV" >&2
    else
      systemctl disable --now coachcompass-mcp >/dev/null 2>&1 || true; echo "   service stopped (first install)" >&2
    fi
  fi
  [ -n "$SMOKE_PID" ] && kill "$SMOKE_PID" >/dev/null 2>&1 || true
  echo "   CoachCompass website + API were never modified." >&2
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback; exit $rc' EXIT

# ---------------------------------------------------------------- 1. preflight
say "1/8 Preflight"
[ "$(id -u)" = 0 ] || die "run as root (sudo)"
[ -f "$TARBALL" ] && [ -f "$TARBALL.sha256" ] || die "staged tarball missing in $STAGE"
(cd "$STAGE" && sha256sum -c coachcompass-mcp.tgz.sha256 >/dev/null) || die "tarball checksum mismatch"
ok "tarball checksum"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "node >= 20 required (have $(node -v))"
ok "node $(node -v)"
[ -f "$SITE" ] || die "$SITE not found"
grep -q '^    index index.html;$' "$SITE" || grep -qF "$INCLUDE_LINE" "$SITE" || die "anchor line 'index index.html;' not found in $SITE"
if ss -ltn "sport = :$PORT" | grep -q LISTEN && ! systemctl is-active --quiet coachcompass-mcp; then die "port $PORT busy with something else"; fi
curl -fsS -m 5 http://127.0.0.1:8788/health >/dev/null || die "CoachCompass API (8788) not healthy — not deploying"
ok "API healthy, port $PORT available"
[ -L "$APP/current" ] && PREV=$(readlink -f "$APP/current") || true
[ -n "$PREV" ] && ok "previous release: $PREV" || ok "first install"

# ---------------------------------------------------------------- 2. user + release
say "2/8 Install release $TS"
id ccmcp >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin ccmcp
mkdir -p "$REL" "$APP/shared" "$APP/backups"
tar -xzf "$TARBALL" -C "$REL"
[ -f "$APP/shared/openai-apps-challenge.txt" ] || : > "$APP/shared/openai-apps-challenge.txt"
chown -R root:root "$APP"; chmod -R go-w "$APP"; chmod 755 "$APP" "$APP/releases" "$APP/shared"
(cd "$REL" && HOME=/root npm ci --ignore-scripts --no-audit --no-fund --update-notifier=false --loglevel=error)
ok "dependencies installed"

# ---------------------------------------------------------------- 3. tests BEFORE live
say "3/8 Tests (fake upstream; nothing live is touched)"
(cd "$REL" && HOME=/root NODE_ENV=test npx vitest run --reporter=dot) || die "tests failed — live untouched"
(cd "$REL" && HOME=/root npx tsc -p tsconfig.json --noEmit) || die "type-check failed — live untouched"
ok "tests + type-check green"
(cd "$REL" && HOME=/root npm prune --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
ok "dev dependencies pruned"

# ---------------------------------------------------------------- 4. smoke the new build on a side port against the REAL API
say "4/8 Side-port smoke test (127.0.0.1:8792, read-only calls to the real API)"
( cd "$REL" && exec setpriv --reuid=ccmcp --regid=ccmcp --clear-groups env NODE_ENV=production PORT=8792 HOST=127.0.0.1 \
    CC_API_BASE=http://127.0.0.1:8788 node dist/src/server.js ) >"$APP/backups/smoke-$TS.log" 2>&1 &
SMOKE_PID=$!
for i in $(seq 1 30); do curl -fsS -m 2 http://127.0.0.1:8792/healthz >/dev/null 2>&1 && break; sleep 0.5; done
mcp() { curl -fsS -m 20 -X POST "$1" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
          -H 'mcp-protocol-version: 2025-06-18' -H "host: ${3:-127.0.0.1}" -d "$2" | sed -n 's/^data: //p'; }
CHECK='import sys,json
d=json.loads(sys.stdin.read()); r=d.get("result") or {}
kind=sys.argv[1]
if kind=="tools": n=len(r.get("tools",[])); assert n==7, n; print("tools:",n)
elif kind=="search":
  assert not r.get("isError"), r; sc=r["structuredContent"]; assert sc["total_found"]>0 and sc["coaches"], sc
  blob=json.dumps(r); assert "\"email\"" not in blob and "\"phone\"" not in blob
  print("search ok:", sc["total_found"], "coaches")'
mcp http://127.0.0.1:8792/mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | python3 -c "$CHECK" tools || { kill $SMOKE_PID; die "smoke: tools/list failed"; }
mcp http://127.0.0.1:8792/mcp '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_coaches","arguments":{"country":"Sweden","limit":3}}}' | python3 -c "$CHECK" search || { kill $SMOKE_PID; die "smoke: search_coaches failed"; }
kill $SMOKE_PID 2>/dev/null || true; wait $SMOKE_PID 2>/dev/null || true; SMOKE_PID=""
ok "side-port smoke green"

# ---------------------------------------------------------------- 5. switch service
say "5/8 Go live: service"
install -m 0644 "$REL/deploy/coachcompass-mcp.service" "$UNIT"
ln -sfn "$REL" "$APP/current"
WENT_LIVE=1
systemctl daemon-reload
systemctl enable coachcompass-mcp >/dev/null 2>&1
systemctl restart coachcompass-mcp
for i in $(seq 1 30); do curl -fsS -m 2 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS -m 2 "http://127.0.0.1:$PORT/healthz" >/dev/null || die "service did not become healthy"
ok "coachcompass-mcp healthy on 127.0.0.1:$PORT (user $(ps -o user= -p "$(systemctl show -p MainPID --value coachcompass-mcp)"))"

# ---------------------------------------------------------------- 6. nginx
say "6/8 Go live: nginx /mcp + legal pages"
NGINX_BAK="$APP/backups/coachcompass.nginx.$TS"
cp -a "$SITE" "$NGINX_BAK"
[ -f "$SNIPPET" ] && SNIPPET_EXISTED=1
install -m 0644 "$REL/deploy/nginx-coachcompass-mcp.conf" "$SNIPPET"
if ! grep -qF "$INCLUDE_LINE" "$SITE"; then
  # insert once, right after the first 'index index.html;' (inside the 443 server block)
  awk -v inc="$INCLUDE_LINE" '{print} !done && $0=="    index index.html;" {print inc; done=1}' "$NGINX_BAK" > "$SITE.tmp.$TS"
  cat "$SITE.tmp.$TS" > "$SITE"; rm -f "$SITE.tmp.$TS"   # keep inode/owner/mode
fi
[ "$(grep -cF "$INCLUDE_LINE" "$SITE")" = 1 ] || die "include line count != 1"
nginx -t 2>&1 | tail -2
nginx -t >/dev/null 2>&1 || die "nginx -t failed"
systemctl reload nginx
ok "nginx reloaded (backup: $NGINX_BAK)"

# ---------------------------------------------------------------- 7. live verification (public URL)
say "7/8 Live verification via $PUBLIC"
sleep 1
code() { curl -s -o /dev/null -w '%{http_code}' -m 15 "$@"; }
[ "$(code $PUBLIC/)" = 200 ] || die "homepage not 200"
[ "$(code $PUBLIC/api/health)" = 200 ] || die "API health not 200"
ok "website + API still 200"
INIT=$(mcp "$PUBLIC/mcp" '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"deploy-check","version":"1"}}}' coachcompass.co)
echo "$INIT" | grep -q '"name":"coachcompass"' || die "public initialize failed"
mcp "$PUBLIC/mcp" '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' coachcompass.co | python3 -c "$CHECK" tools || die "public tools/list failed"
mcp "$PUBLIC/mcp" '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_coaches","arguments":{"query":"leadership","limit":3}}}' coachcompass.co | python3 -c "$CHECK" search || die "public search failed"
[ "$(code $PUBLIC/legal/ai-app-privacy)" = 200 ] || die "/legal/ai-app-privacy not 200"
[ "$(code $PUBLIC/legal/ai-app-terms)" = 200 ] || die "/legal/ai-app-terms not 200"
for wk in oauth-protected-resource oauth-protected-resource/mcp oauth-authorization-server openid-configuration; do
  [ "$(code $PUBLIC/.well-known/$wk)" = 404 ] || die "/.well-known/$wk must be 404 (no-auth server)"
done
ok "public MCP + legal pages verified; OAuth discovery answers 404 (no sign-in)"

# ---------------------------------------------------------------- 8. housekeeping
say "8/8 Housekeeping"
ls -1dt "$APP"/releases/* | tail -n +6 | xargs -r rm -rf
ls -1t "$APP"/backups/coachcompass.nginx.* 2>/dev/null | tail -n +11 | xargs -r rm -f
ok "kept last 5 releases"
trap - EXIT
printf '\n\033[1;32m✅ CoachCompass MCP is LIVE at %s/mcp  (release %s)\033[0m\n' "$PUBLIC" "$TS"
printf '   Logs:      journalctl -u coachcompass-mcp -f\n   Uninstall: sudo bash %s/current/deploy/cc-mcp-uninstall.sh\n' "$APP"
