#!/usr/bin/env bash
# ============================================================
#  Arc'teryx full update — runs on EC2 server
#  Cron: 0 6,12,18,0 * * *
# ============================================================
set -euo pipefail

PROJ_DIR="${PROJ_DIR:-$HOME/arcteryx}"
LOG_FILE="${LOG_FILE:-$PROJ_DIR/update.log}"
DEFAULT_PYTHON="$HOME/arcteryx-venv/bin/python"
if [ -x "$DEFAULT_PYTHON" ]; then
  PYTHON="${PYTHON:-$DEFAULT_PYTHON}"
else
  PYTHON="${PYTHON:-python3.12}"
fi

GITHUB_REMOTE="git@github.com:wantai-dev/001-arcteryx-deals-platform.git"
SITE_URL="${SITE_URL:-https://geardrop.100app.dev}"

# ── Telegram notification credentials ──
# Kept in ~/.arcteryx_secrets (NOT committed to git) so we don't leak tokens.
# That file should contain:
#   export TELEGRAM_BOT_TOKEN="..."
#   export TELEGRAM_CHAT_ID="..."
if [ -f "$HOME/.arcteryx_secrets" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.arcteryx_secrets"
fi
export SUPABASE_URL="${SUPABASE_URL:-https://bupqagkrcvrezjkdbald.supabase.co}"
: "${SUPABASE_KEY:?SUPABASE_KEY env required}"
export SUPABASE_KEY
export TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
export TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
export FEISHU_APP_ID="${FEISHU_APP_ID:-}"
export FEISHU_APP_SECRET="${FEISHU_APP_SECRET:-}"
export FEISHU_CHAT_ID="${FEISHU_CHAT_ID:-}"

cd "$PROJ_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

CRAWLER_NODE="${CRAWLER_NODE:-$(hostname)}"
LEASE_SCOPE="outlet"
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

# Record run start time (used by notify_telegram.py for duration)
date -u '+%Y-%m-%d %H:%M:%S' > "$PROJ_DIR/.last_run_start"

log "===== UPDATE START ====="

# 0. Pull latest code before scraping/syncing. The job writes data later, but
# scraper/sync fixes must be active before Step 1 starts.
log "Step 0: GitHub pull latest code"
git remote set-url origin "$GITHUB_REMOTE"
git fetch origin main 2>&1 | tee -a "$LOG_FILE"
git checkout -B main origin/main 2>&1 | tee -a "$LOG_FILE"
git reset --hard origin/main 2>&1 | tee -a "$LOG_FILE"
git clean -fd -e .last_run_start -e .last_sync -e .sku_progress.json -e update.log -e update_global.log -e dealers.log -e dealers/_partial -e .arcteryx_secrets 2>&1 | tee -a "$LOG_FILE" || true

lease_result=$($PYTHON tools/crawler_lease.py acquire --scope "$LEASE_SCOPE" --owner "$CRAWLER_NODE" --ttl-minutes 240)
if [ "$lease_result" != "true" ]; then
  log "Another node owns the Outlet lease; skipping this window"
  trap - EXIT
  exit 0
fi
LEASE_ACQUIRED=true

log "Step 0a: Hydrate current production catalog seed"
"$PYTHON" tools/hydrate_runtime_snapshot.py --site-url "$SITE_URL" --dataset catalog --output global_data.json 2>&1 | tee -a "$LOG_FILE"

# 1. Refresh product list
log "Step 1: Global scraper (product list)"
$PYTHON global_scraper.py 2>&1 | tee -a "$LOG_FILE"

# 2. Playwright scrape (full re-scrape)
log "Step 2: Playwright scrape"
$PYTHON sku_scraper.py --reset --update-data 2>&1 | tee -a "$LOG_FILE"

# 3. Sync to Supabase (authoritative data store)
log "Step 3: Supabase sync"
$PYTHON supabase_sync.py 2>&1 | tee -a "$LOG_FILE"

log "Step 3a: Revalidate active terminal URL results"
$PYTHON tools/check_product_urls.py --status active --stored-http-status 404 --stored-http-status 410 --max-rows 500 2>&1 | tee -a "$LOG_FILE"

log "Step 3b: Revalidate missing product URLs"
$PYTHON tools/check_product_urls.py --status missing --max-rows 500 2>&1 | tee -a "$LOG_FILE"

# 3c. Hard quality gate: do not treat stale or inconsistent data as healthy
log "Step 3c: Data quality check"
$PYTHON tools/check_data_quality.py --online --dealer arcteryx_outlet --max-age-hours 36 --max-product-age-hours 72 --min-rows 100 --forbid-region jp 2>&1 | tee -a "$LOG_FILE"
SYNC_COMPLETED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# 4. The crawler writes Supabase only. The data service builds an immutable
# snapshot and atomically switches /srv/geardrop/data/current.
log "Step 4: Publish versioned data release"
if ! sudo -n systemctl start geardrop-data-sync.service; then
  log "Could not trigger data sync directly; waiting for the five-minute timer"
fi
"$PYTHON" tools/wait_for_data_release.py --site-url "$SITE_URL" --after "$SYNC_COMPLETED_AT" --timeout-seconds 1800 --interval-seconds 10 2>&1 | tee -a "$LOG_FILE"
"$PYTHON" tools/notify_indexnow.py --sitemap-url "$SITE_URL/sitemap-products.xml" --sitemap-url "$SITE_URL/sitemap-deals.xml" --sitemap-url "$SITE_URL/sitemap-insights.xml" --since-days 2 2>&1 | tee -a "$LOG_FILE" || log "IndexNow notification failed (non-fatal)"

# 5. 检查降价提醒订阅 (price_alerts) 并发邮件
log "Step 5: Price alerts check"
$PYTHON check_price_alerts.py 2>&1 | tee -a "$LOG_FILE" || log "price alerts check failed (non-fatal)"

# 6. Telegram notification with stats report
log "Step 6: Telegram notification"
$PYTHON notify_telegram.py 2>&1 | tee -a "$LOG_FILE" || log "telegram notification failed (non-fatal)"

# 7. Feishu notification with stats report
log "Step 7: Feishu notification"
$PYTHON notify_feishu.py --mode outlet 2>&1 | tee -a "$LOG_FILE" || log "feishu notification failed (non-fatal)"

log "===== UPDATE DONE ====="
RUN_COMPLETED=true
