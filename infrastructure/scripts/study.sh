#!/usr/bin/env bash
# "Press play" mode (1.6): one command to go from cold machine to studying.
#   1. Starts backend + frontend dev servers
#   2. Runs a Notion sync once the API is up
#   3. Opens the Today view in the browser
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_DIR="$REPO_ROOT/.study"
BACKEND_PORT="${BACKEND_PORT:-${PORT:-3000}}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
API_URL="${API_URL:-http://localhost:${BACKEND_PORT}}"
WEB_URL="${WEB_URL:-http://localhost:${FRONTEND_PORT}}"

mkdir -p "$RUN_DIR"
cd "$REPO_ROOT"

port_open() {
  nc -z localhost "$1" >/dev/null 2>&1
}

echo "▶ DSA Mastery OS — study mode"

# 1. Backend + frontend (no external services — cache and scheduler run in-process)
if port_open "$BACKEND_PORT"; then
  echo "  ✓ Backend already running on :${BACKEND_PORT}"
else
  echo "  • Starting backend…"
  (cd "$REPO_ROOT" && pnpm --filter @dsa/backend dev >"$RUN_DIR/backend.log" 2>&1 &
   echo $! >"$RUN_DIR/backend.pid")
fi

if port_open "$FRONTEND_PORT"; then
  echo "  ✓ Frontend already running on :${FRONTEND_PORT}"
else
  echo "  • Starting frontend…"
  (cd "$REPO_ROOT" && pnpm --filter @dsa/frontend dev >"$RUN_DIR/frontend.log" 2>&1 &
   echo $! >"$RUN_DIR/frontend.pid")
fi

# 2. Wait for the API, then trigger a Notion sync (4.3: sync on startup)
echo -n "  • Waiting for API"
for _ in $(seq 1 60); do
  if curl -sf "$API_URL/health/live" >/dev/null 2>&1; then
    break
  fi
  echo -n "."
  sleep 1
done
echo ""

if curl -sf "$API_URL/health/live" >/dev/null 2>&1; then
  # 3. Open the Today view immediately — the UI serves from the SQLite
  # mirror, so it's usable right away. Notion sync runs in the background.
  case "$(uname)" in
    Darwin) open "$WEB_URL" ;;
    Linux) xdg-open "$WEB_URL" >/dev/null 2>&1 || true ;;
  esac
  if [ "${NOTION_SYNC_ENABLED:-true}" = "false" ] || grep -q '^NOTION_SYNC_ENABLED=false' "$REPO_ROOT/.env" 2>/dev/null; then
    echo "  • Notion sync skipped (NOTION_SYNC_ENABLED=false)"
  else
    echo "  • Notion sync running in background (log: $RUN_DIR/sync.log)…"
    (curl -sf -X POST "$API_URL/api/sync" >"$RUN_DIR/sync.log" 2>&1 || true) &
  fi
else
  echo "  ⚠ API didn't come up in time — check $RUN_DIR/backend.log"
fi

echo "✓ Ready. Today view: $WEB_URL  (stop with: pnpm study:stop)"
