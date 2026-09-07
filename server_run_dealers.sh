#!/usr/bin/env bash
# ============================================================
#  Dealer scraper — Burton / Backcountry / EVO / REI，每 3 小时一次。
#  MEC 由 OCI 独立执行，避免 Lightsail 出口的 Cloudflare 403。
#  四个模块串行，避免 Lightsail 1.6GB RAM OOM。
# ============================================================
set -euo pipefail

PROJ_DIR="${PROJ_DIR:-$HOME/arcteryx}"
LOG="${LOG:-$PROJ_DIR/dealers.log}"
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
LEASE_SCOPE="dealers"
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

log "===== DEALERS START ====="

# pull latest code
git remote set-url origin "$GITHUB_REMOTE"
git fetch origin main 2>&1 | tee -a "$LOG"
git reset --hard origin/main 2>&1 | tee -a "$LOG"

lease_result=$($PYTHON tools/crawler_lease.py acquire --scope "$LEASE_SCOPE" --owner "$CRAWLER_NODE" --ttl-minutes 180)
if [ "$lease_result" != "true" ]; then
    log "Another node owns the Dealers lease; skipping this window"
    trap - EXIT
    exit 0
fi
LEASE_ACQUIRED=true

log "hydrate current production dealer seed"
"$PYTHON" tools/hydrate_runtime_snapshot.py --site-url "$SITE_URL" --dataset dealers --output dealers/results.json 2>&1 | tee -a "$LOG"

# 先通过正式退役路径隐藏已停止维护的来源；保留历史记录，不删除。
log "retire disabled dealer sources"
$PYTHON tools/retire_dealer.py --dealer ssense 2>&1 | tee -a "$LOG"

# 4 个 dealer 串行跑（EC2 1.6GB RAM 不够并行 + Camoufox/Chromium 开销大）
mkdir -p dealers/_partial
rm -f dealers/_partial/*.json
for d in burton backcountry evo rei; do
    log "→ dealers.$d"
    if timeout 1800 $PYTHON -m dealers.$d >> "$LOG" 2>&1; then
        log "  ✓ $d done"
    else
        log "  ✗ $d failed (timeout 30 min or error)"
    fi
done

# 合并到 results.json
log "merge → results.json"
$PYTHON -m dealers.merge_partial 2>&1 | tee -a "$LOG"

# 同步到 Supabase（products 表 dealer 列）
log "sync → Supabase"
$PYTHON -m dealers.supabase_sync 2>&1 | tee -a "$LOG"

# 硬性质量闸门：避免 stale partial / 币种错误 / 折扣不一致继续被当作健康数据
log "data quality check"
$PYTHON tools/check_data_quality.py --online --dealer burton --dealer backcountry --dealer evo --dealer rei --max-age-hours 36 --max-product-age-hours 72 --min-rows 50 2>&1 | tee -a "$LOG"
SYNC_COMPLETED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# 检查降价提醒
log "price alerts check"
$PYTHON check_price_alerts.py 2>&1 | tee -a "$LOG" || log "price alerts check 失败 (non-fatal)"

log "publish versioned data release"
if ! sudo -n systemctl start geardrop-data-sync.service; then
    log "could not trigger data sync directly; waiting for the five-minute timer"
fi
"$PYTHON" tools/wait_for_data_release.py --site-url "$SITE_URL" --after "$SYNC_COMPLETED_AT" --timeout-seconds 1800 --interval-seconds 10 2>&1 | tee -a "$LOG"
"$PYTHON" tools/notify_indexnow.py --sitemap-url "$SITE_URL/sitemap-products.xml" --sitemap-url "$SITE_URL/sitemap-deals.xml" --sitemap-url "$SITE_URL/sitemap-insights.xml" --since-days 2 2>&1 | tee -a "$LOG" || log "IndexNow notification failed (non-fatal)"

log "feishu notification"
$PYTHON notify_feishu.py --mode dealers 2>&1 | tee -a "$LOG" || log "feishu notification failed (non-fatal)"

log "===== DEALERS END ====="
RUN_COMPLETED=true
