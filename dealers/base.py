"""
经销商抓取基础设施。每个站点写一个 DealerScraper 子类，重写
- LIST_URL: 品牌列表页（可带 {page} 占位）
- TIER: 'fetcher' | 'stealthy' | 'cf'   决定用哪种 Fetcher
- parse_list(html, base_url) -> list[dict]   从列表页 HTML 抽商品卡

输出统一 schema:
    {
      "dealer": "evo",                    # 经销商 key
      "brand": "arcteryx",                # arcteryx | burton | patagonia
      "url": "https://...",               # 商品详情页
      "name": "Beta AR Jacket Men's",
      "image": "https://...",
      "original_price": 600.0,            # 数字, USD/CAD/GBP/EUR 视 currency
      "sale_price": 360.0,
      "currency": "USD",
      "discount_pct": 40,                 # 整数百分比
      "in_stock": True,                   # 暂时都标 True，后续详情页校正
      "raw": {...optional debug...}
    }
"""
from __future__ import annotations
# StealthyFetcher is imported lazily in DealerScraper.fetch: importing it
# requires a downloaded camoufox browser, which plain parsing/tests do not need.
from scrapling.fetchers import Fetcher
from typing import Iterable
import re, time, traceback, json

# 强制减少日志噪音
import logging
logging.getLogger("scrapling").setLevel(logging.WARNING)


def normalize_price(s: str) -> float | None:
    if not s: return None
    # 去掉货币符 / 千分位 / 空格
    m = re.search(r"[\d.,]+", s.replace("\xa0", " "))
    if not m: return None
    raw = m.group(0)
    # 1.234,56 vs 1,234.56 — 看最后一个分隔符
    if "," in raw and "." in raw:
        if raw.rfind(",") > raw.rfind("."):
            raw = raw.replace(".", "").replace(",", ".")
        else:
            raw = raw.replace(",", "")
    elif "," in raw:
        # 仅有逗号 — 如果末尾是 ,XX 视为小数
        if re.search(r",\d{1,2}$", raw):
            raw = raw.replace(",", ".")
        else:
            raw = raw.replace(",", "")
    try:
        return float(raw)
    except ValueError:
        return None


def detect_currency(s: str) -> str | None:
    if "$" in s and ("CAD" in s.upper() or "C$" in s): return "CAD"
    if "$" in s: return "USD"
    if "€" in s: return "EUR"
    if "£" in s: return "GBP"
    if "¥" in s or "￥" in s: return "CNY"
    if "kr" in s.lower() or "SEK" in s.upper(): return "SEK"
    return None


def discount_pct(orig: float | None, sale: float | None) -> int:
    if not orig or not sale or orig <= 0: return 0
    return round((1 - sale / orig) * 100)


class DealerScraper:
    KEY:        str = ""        # e.g. "ssense"
    NAME:       str = ""
    REGION:     str = ""        # "US" / "CA" / "UK" / "EU" / "DE"
    TIER:       str = "stealthy"  # fetcher | stealthy | cf
    LIST_URLS:  list[str] = []  # one or more list pages (or templates with {page})
    MAX_PAGES:  int = 3         # safety cap

    def fetch(self, url: str):
        if self.TIER == "fetcher":
            return Fetcher.get(url, timeout=30, follow_redirects=True)
        opts = {"headless": True, "network_idle": True, "timeout": 60000}
        if self.TIER == "cf":
            opts["solve_cloudflare"] = True
        from scrapling.fetchers import StealthyFetcher
        return StealthyFetcher.fetch(url, **opts)

    def parse_list(self, body: str, page_url: str) -> list[dict]:
        raise NotImplementedError

    def scrape(self) -> list[dict]:
        items = []
        seen = set()
        for tmpl in self.LIST_URLS:
            for page in range(1, self.MAX_PAGES + 1):
                url = tmpl.format(page=page) if "{page}" in tmpl else tmpl
                try:
                    p = self.fetch(url)
                    body = (p.body or b"").decode("utf-8", errors="ignore")
                except Exception as e:
                    print(f"[{self.KEY}] FETCH ERR {url}: {e}")
                    break
                try:
                    page_items = self.parse_list(body, url)
                except Exception:
                    print(f"[{self.KEY}] PARSE ERR {url}\n{traceback.format_exc()[:400]}")
                    break
                if not page_items:
                    break
                new = 0
                for it in page_items:
                    if not it.get("url") or it["url"] in seen:
                        continue
                    seen.add(it["url"])
                    it["dealer"] = self.KEY
                    it["dealer_name"] = self.NAME
                    it["region"] = self.REGION
                    if "discount_pct" not in it:
                        it["discount_pct"] = discount_pct(it.get("original_price"), it.get("sale_price"))
                    items.append(it)
                    new += 1
                print(f"[{self.KEY}] page {page} → +{new} (total {len(items)})")
                if "{page}" not in tmpl or new == 0:
                    break
                time.sleep(1)
        return items
