#!/usr/bin/env bash
# MEC scraper — runs on OCI because MEC currently blocks the Lightsail AWS egress.
set -euo pipefail

PROJ_DIR="${PROJ_DIR:-$HOME/arcteryx}"
LOG="${LOG:-$PROJ_DIR/mec.log}"
DEFAULT_PYTHON="$HOME/arcteryx-venv/bin/python"
if [ -x "$DEFAULT_PYTHON" ]; then
  PYTHON="${PYTHON:-$DEFAULT_PYTHON}"
else
  PYTHON="${PYTHON:-python3.12}"
fi

GITHUB_REMOTE="git@github.com:wantai-dev/001-arcteryx-deals-platform.git"
SITE_URL="${SITE_URL:-https://geardrop.100app.dev}"

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

cd "$PROJ_DIR"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

CRAWLER_NODE="${CRAWLER_NODE:-$(hostname)}"
LEASE_SCOPE="mec"
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

log "===== MEC START ====="
git remote set-url origin "$GITHUB_REMOTE"
git fetch origin main 2>&1 | tee -a "$LOG"
git reset --hard origin/main 2>&1 | tee -a "$LOG"

lease_result=$($PYTHON tools/crawler_lease.py acquire --scope "$LEASE_SCOPE" --owner "$CRAWLER_NODE" --ttl-minutes 90)
if [ "$lease_result" != "true" ]; then
  log "Another node owns the MEC lease; skipping this window"
  trap - EXIT
  exit 0
fi
LEASE_ACQUIRED=true

log "hydrate current production dealer seed"
"$PYTHON" tools/hydrate_runtime_snapshot.py --site-url "$SITE_URL" --dataset dealers --output dealers/results.json 2>&1 | tee -a "$LOG"

mkdir -p dealers/_partial
rm -f dealers/_partial/*.json
log "scrape → dealers.mec"
timeout 1800 "$PYTHON" -u -m dealers.mec 2>&1 | tee -a "$LOG"

# A successful process with an empty/partial challenge response must not publish.
"$PYTHON" tools/check_mec_partial.py

log "merge → results.json"
"$PYTHON" -m dealers.merge_partial 2>&1 | tee -a "$LOG"
log "sync → Supabase"
"$PYTHON" -m dealers.supabase_sync 2>&1 | tee -a "$LOG"
log "data quality check"
"$PYTHON" tools/check_data_quality.py --online --dealer mec --max-age-hours 36 --max-product-age-hours 72 --min-rows 50 2>&1 | tee -a "$LOG"
SYNC_COMPLETED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

log "wait for versioned data release"
"$PYTHON" tools/wait_for_data_release.py --site-url "$SITE_URL" --after "$SYNC_COMPLETED_AT" --timeout-seconds 1800 --interval-seconds 10 2>&1 | tee -a "$LOG"
"$PYTHON" tools/notify_indexnow.py --sitemap-url "$SITE_URL/sitemap-products.xml" --sitemap-url "$SITE_URL/sitemap-deals.xml" --sitemap-url "$SITE_URL/sitemap-insights.xml" --since-days 2 2>&1 | tee -a "$LOG" || log "IndexNow notification failed (non-fatal)"

"$PYTHON" notify_feishu.py --mode dealers 2>&1 | tee -a "$LOG" || log "feishu notification failed (non-fatal)"
log "===== MEC END ====="
RUN_COMPLETED=true
