"""把 dealers/_partial/<key>.json 合并成 dealers/results.json (前端读取的格式)"""
import json, time, os, glob
from datetime import datetime, timezone
from pathlib import Path

from dealers.source_registry import RETIRED_DEALERS

PARTIAL_DIR = "dealers/_partial"
OUT = "dealers/results.json"
KEY_BY_NAME = {
    "MEC": "mec",
    "EVO": "evo",
    "REI": "rei",
    "Burton": "burton",
    "Backcountry": "backcountry",
}
MIN_SNAPSHOT_RATIO = 0.70
# A collapse guard compares against the last *accepted* snapshot. When a sale
# genuinely ends, every later complete crawl is rejected against that old
# baseline and the dealer stays frozen forever (Backcountry: 214 -> ~80 on
# 2026-10-21, then rejected for 24 days). Once the retained baseline is older
# than the production freshness limit it is no longer a trustworthy reference,
# so a complete crawl may replace it. This applies only to scrapers whose
# crawl_complete proves the raw item count equals the site's reported total.
STALE_BASELINE_HOURS = 36.0
TOTAL_VERIFIED_DEALERS = frozenset({"backcountry", "burton"})


def _baseline_age_hours(previous: dict, now: datetime) -> float | None:
    """Age of the retained snapshot; refreshed_at is a naive UTC timestamp."""
    raw = str(previous.get("refreshed_at") or "").strip()
    if not raw:
        return None
    try:
        refreshed = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return (now - refreshed).total_seconds() / 3600


def snapshot_rejection_reason(
    items: list,
    partial: dict,
    previous: dict,
    key: str = "",
    now: datetime | None = None,
) -> str | None:
    """Reject incomplete or implausibly collapsed dealer snapshots."""
    if not items:
        return "empty"
    if partial.get("crawl_complete") is not True:
        return "incomplete"
    previous_items = previous.get("items") or []
    previous_count = len(previous_items) or int(previous.get("count") or 0)
    if previous_count >= 10 and len(items) < previous_count * MIN_SNAPSHOT_RATIO:
        age = _baseline_age_hours(previous, now or datetime.now(timezone.utc))
        if key in TOTAL_VERIFIED_DEALERS and age is not None and age > STALE_BASELINE_HOURS:
            print(
                f"  WARN {key}: accepting complete snapshot {previous_count}->{len(items)} "
                f"because the retained baseline is {age:.0f}h old (> {STALE_BASELINE_HOURS:.0f}h)"
            )
            return None
        return (
            f"collapsed {previous_count}->{len(items)} "
            f"({len(items) / previous_count:.0%} < {MIN_SNAPSHOT_RATIO:.0%})"
        )
    return None

def main():
    out = {"generated_at": time.strftime("%Y-%m-%d %H:%M:%S"), "dealers": {}}
    publication_id = os.environ.get("PUBLICATION_ID", "").strip()
    if publication_id:
        out["publication_id"] = publication_id
    prior_rejected = {}
    # 用上一轮 results.json 播种：某个 dealer 本轮抓取失败（没产出 partial）时，
    # 保留它上次的数据，避免该 dealer 从静态文件 / supabase_sync 里凭空消失。
    # (Supabase 侧 supabase_sync 对缺失 dealer 本就跳过，靠 14 天 stale buffer 兜底；
    #  这里同步保住静态 results.json 的完整性，REI 偶发崩溃不再清空它的区块。)
    if os.path.exists(OUT):
        try:
            prev = json.loads(Path(OUT).read_text())
            for key, block in (prev.get("dealers") or {}).items():
                if key in RETIRED_DEALERS:
                    print(f"  {key}: retired source discarded from previous results.json")
                    continue
                out["dealers"][key] = block
            if isinstance(prev.get("rejected_dealers"), dict):
                prior_rejected = dict(prev["rejected_dealers"])
            print(f"  (seeded from previous results.json: {', '.join(out['dealers']) or 'none'})")
        except Exception as e:
            print(f"  (could not seed from previous results.json: {e})")

    fresh_keys = []
    # Keep the last unresolved rejection until that exact dealer publishes a
    # new trusted snapshot. A MEC-only run must not make a retained stale EVO
    # block look healthy by resetting rejected_dealers to {}.
    rejected = {
        key: reason
        for key, reason in prior_rejected.items()
        if key in out["dealers"]
    }
    for path in sorted(glob.glob(f"{PARTIAL_DIR}/*.json")):
        d = json.loads(Path(path).read_text())
        key = KEY_BY_NAME.get(d.get("name"), os.path.basename(path).replace(".json",""))
        if key in RETIRED_DEALERS:
            print(f"  {key}: retired source partial ignored")
            continue
        items = d.get("items") or []
        previous = out["dealers"].get(key, {})
        rejection_reason = snapshot_rejection_reason(items, d, previous, key=key)
        trusted = rejection_reason is None
        # 只有抓取器明确声明完整成功的非空范围才可驱动 freshness/lifecycle。
        # 空结果或部分结果保留上一轮快照，不能伪装成新鲜数据。
        if not trusted:
            rejected[key] = rejection_reason
            print(f"  {key}: {len(items)} 件 [{rejection_reason} scrape — 保留上一轮 {previous.get('count', 0)} 件]")
            continue
        out["dealers"][key] = {
            "name":   d.get("name"),
            "region": d.get("region"),
            "count":  d.get("count", 0),
            "items":  items,
            "refreshed_at": d.get("saved_at"),
        }
        rejected.pop(key, None)
        fresh_keys.append(key)
        print(f"  {key}: {d.get('count')} 件 ({d.get('saved_at')}) [fresh]")

    stale_keys = [k for k in out["dealers"] if k not in fresh_keys]
    retained = {}
    for key in stale_keys:
        block = out["dealers"][key]
        retained[key] = rejected.get(key) or "not refreshed in this run"
        print(f"  {key}: {block.get('count')} 件 [kept from previous — 本轮无新数据]")

    total = sum((b.get("count") or 0) for b in out["dealers"].values())
    out["total"] = total
    out["rejected_dealers"] = rejected
    out["retained_dealers"] = retained
    out["retired_dealers"] = sorted(RETIRED_DEALERS)
    # supabase_sync 只允许本轮真实产出非空 partial 的 dealer 更新时间。
    # 缺失/空抓取仍保留静态快照，但不能伪装成本轮新鲜数据。
    out["fresh_dealers"] = fresh_keys
    Path(OUT).write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"\n=== TOTAL: {total} 件 → {OUT} (fresh: {len(fresh_keys)}, kept: {len(stale_keys)}) ===")

if __name__ == "__main__":
    main()
