#!/usr/bin/env bash
# Dealer URL Revalidator — 每天复检已知 URL 价格
# Cron: 30 6 * * *  (UTC 06:30, 错开 outlet 06:00 + dealer 03/09/15/21)
set -euo pipefail

PROJ_DIR="${PROJ_DIR:-$HOME/arcteryx}"
LOG="${LOG:-$PROJ_DIR/revalidate.log}"
DEFAULT_PYTHON="$HOME/arcteryx-venv/bin/python"
if [ -x "$DEFAULT_PYTHON" ]; then
  PYTHON="${PYTHON:-$DEFAULT_PYTHON}"
else
  PYTHON="${PYTHON:-python3.12}"
fi

if [ -f "$HOME/.arcteryx_secrets" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.arcteryx_secrets"
fi
export SUPABASE_URL="${SUPABASE_URL:-https://bupqagkrcvrezjkdbald.supabase.co}"
: "${SUPABASE_KEY:?SUPABASE_KEY env required}"
export SUPABASE_KEY
export FEISHU_APP_ID="${FEISHU_APP_ID:-}"
export FEISHU_APP_SECRET="${FEISHU_APP_SECRET:-}"
export FEISHU_CHAT_ID="${FEISHU_CHAT_ID:-}"
export REVALIDATE_MAX_ROWS_PER_DEALER="${REVALIDATE_MAX_ROWS_PER_DEALER:-50}"

cd "$PROJ_DIR"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

CRAWLER_NODE="${CRAWLER_NODE:-$(hostname)}"
LEASE_SCOPE="revalidate"
LEASE_ACQUIRED=false
RUN_COMPLETED=false
finish_lease() {
  exit_code=$?
  trap - EXIT
  if [ "$LEASE_ACQUIRED" = true ]; then
    if [ "$exit_code" -eq 0 ] && [ "$RUN_COMPLETED" = true ]; then
      "$PYTHON" tools/crawler_lease.py finish --scope "$LEASE_SCOPE" --owner "$CRAWLER_NODE" --status success >/dev/null 2>&1 || true
    else
      message="exit $exit_code"
      if [ "$RUN_COMPLETED" != true ]; then
        message="incomplete run (exit $exit_code)"
      fi
      "$PYTHON" tools/crawler_lease.py finish --scope "$LEASE_SCOPE" --owner "$CRAWLER_NODE" --status failed --message "$message" >/dev/null 2>&1 || true
    fi
  fi
  exit "$exit_code"
}
trap finish_lease EXIT

log "===== REVALIDATE START ====="
log "bounded cohort: maximum $REVALIDATE_MAX_ROWS_PER_DEALER rows per dealer unless an exact SKU allowlist is supplied"
git fetch origin main 2>&1 | tee -a "$LOG"
git reset --hard origin/main 2>&1 | tee -a "$LOG"

lease_result=$($PYTHON tools/crawler_lease.py acquire --scope "$LEASE_SCOPE" --owner "$CRAWLER_NODE" --ttl-minutes 90)
if [ "$lease_result" != "true" ]; then
  log "Another node owns the Revalidate lease; skipping this window"
  trap - EXIT
  exit 0
fi
LEASE_ACQUIRED=true

timeout 3600 $PYTHON -m dealers.revalidate 2>&1 | tee -a "$LOG"

log "feishu notification"
$PYTHON notify_feishu.py --mode revalidate 2>&1 | tee -a "$LOG" || log "feishu notification failed (non-fatal)"

log "===== REVALIDATE END ====="
RUN_COMPLETED=true
