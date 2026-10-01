#!/usr/bin/env bash
# Fully removes the CoachCompass MCP server from the VPS (reverses cc-mcp-deploy.sh). Run as root.
# Leaves the CoachCompass website, API and database untouched. Keeps /opt/coachcompass-mcp/backups.
set -Eeuo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
SITE=/etc/nginx/sites-enabled/coachcompass
INCLUDE_LINE='    include /etc/nginx/snippets/coachcompass-mcp.conf;'
cp -a "$SITE" "/opt/coachcompass-mcp/backups/coachcompass.nginx.pre-uninstall.$(date -u +%Y%m%dT%H%M%SZ)"
grep -vxF "$INCLUDE_LINE" "$SITE" > "$SITE.tmp" && cat "$SITE.tmp" > "$SITE" && rm -f "$SITE.tmp"
rm -f /etc/nginx/snippets/coachcompass-mcp.conf
nginx -t && systemctl reload nginx
systemctl disable --now coachcompass-mcp 2>/dev/null || true
rm -f /etc/systemd/system/coachcompass-mcp.service && systemctl daemon-reload
rm -rf /opt/coachcompass-mcp/releases /opt/coachcompass-mcp/current
echo "✅ CoachCompass MCP removed (/mcp now falls through to the website's 404 page)."
