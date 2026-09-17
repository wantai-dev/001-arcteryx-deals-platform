#!/usr/bin/env python3
"""
Arc'teryx 全球 Outlet 数据采集器 (Playwright 版)
────────────────────────────────────────────────
抓取 outlet.arcteryx.com 各区域站点商品列表页：
  1. 遍历 17 个地区 × (mens + womens) 分类页
  2. 自动滚动加载全部商品瓦片
  3. 提取商品 URL、名称、价格、折扣等
  4. 合并写入 global_data.json（保留已有数据，新增/更新条目）

运行:
    python3 global_scraper.py           # 全量抓取
    python3 global_scraper.py --dry-run # 只抓第一个地区，不写文件
    python3 global_scraper.py --region us ca gb  # 只抓指定地区
"""

import argparse
import asyncio
import html as html_lib
import json
import os
import re
import sys
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as PWTimeout

# ========== 配置 ==========
PROJECT   = Path(__file__).parent
DATA_FILE = PROJECT / "global_data.json"
SKIPPED_REGIONS_FILE = PROJECT / ".skipped_regions.json"
CRAWL_MANIFEST_FILE = PROJECT / ".crawl_manifest.json"

REGIONS = [
    {"code": "us", "lang": "en", "name": "美国",   "currency": "USD", "symbol": "$"},
    {"code": "ca", "lang": "en", "name": "加拿大",  "currency": "CAD", "symbol": "C$"},
    {"code": "gb", "lang": "en", "name": "英国",    "currency": "GBP", "symbol": "£"},
    {"code": "au", "lang": "en", "name": "澳大利亚","currency": "AUD", "symbol": "A$"},
    {"code": "de", "lang": "de", "name": "德国",    "currency": "EUR", "symbol": "€"},
    {"code": "fr", "lang": "fr", "name": "法国",    "currency": "EUR", "symbol": "€"},
    {"code": "nl", "lang": "en", "name": "荷兰",    "currency": "EUR", "symbol": "€"},
    {"code": "fi", "lang": "en", "name": "芬兰",    "currency": "EUR", "symbol": "€"},
    {"code": "ie", "lang": "en", "name": "爱尔兰",  "currency": "EUR", "symbol": "€"},
    {"code": "se", "lang": "en", "name": "瑞典",    "currency": "SEK", "symbol": "kr"},
    {"code": "at", "lang": "de", "name": "奥地利",  "currency": "EUR", "symbol": "€"},
    {"code": "ch", "lang": "de", "name": "瑞士",    "currency": "CHF", "symbol": "CHF"},
    {"code": "jp", "lang": "ja", "name": "日本",    "currency": "JPY", "symbol": "¥"},
    {"code": "it", "lang": "it", "name": "意大利",  "currency": "EUR", "symbol": "€"},
    {"code": "es", "lang": "es", "name": "西班牙",  "currency": "EUR", "symbol": "€"},
    {"code": "dk", "lang": "da", "name": "丹麦",    "currency": "DKK", "symbol": "kr"},
    {"code": "be", "lang": "nl", "name": "比利时",  "currency": "EUR", "symbol": "€"},
]

GENDERS = ["mens", "womens"]
UNISEX_SCOPE = "unisex"
# 性别列表页同时列出无性别路径的中性商品（帽子、袜子、手套、背包），形如 /shop/<slug>。
OUTLET_PRODUCT_LINK_RE = re.compile(r"/shop/(?:(mens|womens)/)?([^/?#]+)/?$")

# 每次滚动后等待时间（秒）
SCROLL_PAUSE = 1.0
# 列表按视口逐段渲染；必须增量滚动，直接跳到底部会漏掉中间商品。
MAX_SCROLL_ROUNDS = 80
# 两个地区之间间隔
REGION_PAUSE = 3.0
AU_SHOPIFY_SALE_API = "https://arcteryx.com.au/collections/sale/products.json"


# ========== 工具函数 ==========

def load_json(path, default):
    p = Path(path)
    if p.exists():
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    return default

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def slug_from_url(url: str) -> str:
    return url.rstrip("/").split("/")[-1]

def region_from_url(url: str) -> str | None:
    m = re.match(r"https?://outlet\.arcteryx\.com/([a-z]{2})/", url or "")
    return m.group(1) if m else None

def outlet_link_gender(url: str) -> str | None:
    """Return men/women/unisex for an Outlet product link, or None for category links."""
    match = OUTLET_PRODUCT_LINK_RE.search((url or "").split("?", 1)[0])
    if not match or len(match.group(2)) <= 5 or match.group(2) == "womens":
        return None
    return {"mens": "men", "womens": "women"}.get(match.group(1), UNISEX_SCOPE)

def unisex_scope_result(region_code: str, urls: set[str], pages_complete: list[bool], expected_pages: int) -> dict:
    """Unisex rows are only reconciled when every gender listing page was read completely."""
    complete = len(pages_complete) == expected_pages and all(pages_complete)
    return {
        "region": region_code,
        "gender": UNISEX_SCOPE,
        "status": "success" if complete else "failed",
        "reason": None if complete else "incomplete_gender_pages",
        "product_count": len(urls),
        "urls": sorted(urls),
    }

def parse_price(text: str) -> float:
    """从含货币符号的字符串中提取数字，日元去逗号"""
    m = re.search(r"[\d,]+(?:\.\d+)?", text.replace("\u00a0", ""))
    if not m:
        return 0.0
    return float(m.group().replace(",", ""))

def infer_category(name: str, url: str) -> str:
    u = url.lower()
    n = (name or "").lower()
    if "veilance" in u or "veilance" in n:
        return "Veilance商务系列"
    if any(x in u for x in ["shell-jacket", "hardshell", "softshell"]):
        return "硬壳冲锋衣"
    if any(x in u for x in ["insulated", "down-jacket", "hoody"]):
        return "保暖夹克"
    if any(x in u for x in ["/pant", "-pant", "bib-"]):
        return "裤装"
    if any(x in u for x in ["shoe", "boot", "footwear", "sandal"]):
        return "鞋类"
    if any(x in u for x in ["/pack", "-pack", "backpack", "bag", "tote"]):
        return "背包"
    if any(x in u for x in ["base-layer", "rho-", "-rho", "phase-", "merino"]):
        return "排汗内衣"
    if any(x in u for x in ["fleece", "polar", "fortrez"]):
        return "抓绒/摇粒绒"
    if any(x in u for x in ["vest", "gilet"]):
        return "背心"
    if any(x in u for x in ["shirt", "polo", "tee", "top-"]):
        return "上衣/T恤"
    if any(x in u for x in ["dress", "skirt"]):
        return "裙装"
    if any(x in u for x in ["hat", "cap", "headwear", "glove", "sock", "buff"]):
        return "配件"
    return "其他"


def normalize_token(text: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "_", text or "").strip("_") or "default"


def clean_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html_lib.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def to_float(value) -> float:
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return 0.0


def option_value(product: dict, variant: dict, names: tuple[str, ...]) -> str:
    options = product.get("options") or []
    for opt in options:
        opt_name = str(opt.get("name", "")).lower()
        if any(name in opt_name for name in names):
            pos = opt.get("position")
            if pos in (1, 2, 3):
                return str(variant.get(f"option{pos}") or "").strip()
    return ""


def infer_shopify_gender(product: dict) -> str:
    tags = {str(t).lower() for t in product.get("tags") or []}
    if "gender:women" in tags and "gender:men" not in tags:
        return "women"
    if "gender:men" in tags and "gender:women" not in tags:
        return "men"
    title = product.get("title", "")
    if re.search(r"women'?s", title, re.IGNORECASE):
        return "women"
    if re.search(r"men'?s", title, re.IGNORECASE):
        return "men"
    return ""


def release_from_images(images: list[str]) -> tuple[int | None, str | None]:
    for url in images:
        m = re.search(r"/([FSWfsw])(\d{2})[-_]", url or "")
        if m:
            return 2000 + int(m.group(2)), {"F": "Fall", "W": "Winter", "S": "Spring"}[m.group(1).upper()]
    return None, None


def fetch_json(
    url: str,
    timeout: float = 30.0,
    *,
    attempts: int = 6,
    base_retry_delay: float = 15.0,
) -> dict:
    """Read official JSON with bounded retries for transient source failures."""
    if attempts < 1:
        raise ValueError("attempts must be at least 1")

    context = ssl._create_unverified_context()
    for attempt in range(1, attempts + 1):
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
                "Accept-Language": "en-AU,en;q=0.9",
            },
        )
        try:
            with urllib.request.urlopen(req, context=context, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            retryable = exc.code == 429 or 500 <= exc.code < 600
            if not retryable or attempt == attempts:
                raise
            retry_after = exc.headers.get("Retry-After") if exc.headers else None
            try:
                delay = float(retry_after) if retry_after is not None else 0.0
            except ValueError:
                delay = 0.0
            if delay <= 0:
                delay = base_retry_delay * (2 ** (attempt - 1))
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts:
                raise
            delay = base_retry_delay * (2 ** (attempt - 1))

        delay = min(60.0, max(0.0, delay))
        print(
            f"    ⚠ official JSON transient failure; retry "
            f"{attempt + 1}/{attempts} in {delay:g}s",
            file=sys.stderr,
            flush=True,
        )
        time.sleep(delay)

    raise RuntimeError("official JSON retry loop exhausted")


def shopify_product_records(product: dict, region: dict, now: str) -> list[dict]:
    """Map Arc'teryx Australia Shopify sale products into our color-level schema."""
    handle = product.get("handle") or ""
    if not handle:
        return []

    title = product.get("title") or handle.replace("-", " ").title()
    gender = infer_shopify_gender(product)
    product_url = f"https://arcteryx.com.au/products/{handle}"
    description = clean_html(product.get("body_html", ""))
    product_images = [
        img.get("src")
        for img in (product.get("images") or [])
        if isinstance(img, dict) and img.get("src")
    ]

    by_color: dict[str, dict] = {}
    for variant in product.get("variants") or []:
        sale = to_float(variant.get("price"))
        orig = to_float(variant.get("compare_at_price"))
        if sale <= 0 or orig <= 0 or sale >= orig:
            continue

        color = (
            option_value(product, variant, ("colour", "color"))
            or str(variant.get("option1") or "").strip()
            or "Default"
        )
        size = option_value(product, variant, ("size",)) or str(variant.get("option2") or "").strip()
        if not size or size == color:
            size = str(variant.get("title") or "One Size").split(" / ")[-1].strip() or "One Size"

        group = by_color.setdefault(
            color,
            {
                "sizes": [],
                "size_stock": {},
                "original_price": orig,
                "sale_price": sale,
                "images": list(product_images),
            },
        )
        if sale < group["sale_price"] or group["original_price"] <= 0:
            group["sale_price"] = sale
            group["original_price"] = orig

        if size not in group["sizes"]:
            group["sizes"].append(size)
        group["size_stock"][size] = "in_stock" if variant.get("available") else "out_of_stock"

        featured = variant.get("featured_image") or {}
        if featured.get("src"):
            group["images"].insert(0, featured["src"])

    records = []
    model = re.sub(r"\s+(?:Men|Women)'?s$", "", title, flags=re.IGNORECASE).strip() or title
    for color, data in by_color.items():
        if data["sizes"] and all(data["size_stock"].get(size) == "out_of_stock" for size in data["sizes"]):
            continue
        images = list(dict.fromkeys([u for u in data["images"] if u]))
        image_url = images[0] if images else ""
        original_price = data["original_price"]
        sale_price = data["sale_price"]
        release_year, release_season = release_from_images(images)
        records.append({
            "url": product_url,
            "full_name": title,
            "model": model,
            "description": description,
            "gender": gender,
            "region": region["code"],
            "region_name": region["name"],
            "currency": region["currency"],
            "symbol": region["symbol"],
            "original_price": original_price,
            "sale_price": sale_price,
            "sale_price_max": sale_price,
            "discount_pct": round((1 - sale_price / original_price) * 100) if original_price else 0,
            "category": infer_category(title, f"{product_url} {product.get('product_type', '')}"),
            "outlet_category": "Sale",
            "image_url": image_url,
            "colors": [color],
            "sizes": data["sizes"],
            "size_stock": data["size_stock"],
            "images": images,
            "local_image": "",
            "color": color,
            "sku_id": f"{handle}_{normalize_token(color)}_{region['code']}",
            "release_year": release_year,
            "release_season": release_season,
            "last_updated": now,
            "source": "arcteryx_au_shopify_sale",
        })
    return records


def scrape_au_shopify_sale(region: dict) -> list[dict]:
    """Fetch Australia from the official local Shopify sale collection.

    outlet.arcteryx.com does not expose AU as a SWAG country, while Arc'teryx's
    own support page routes Australian shoppers to arcteryx.com.au. Use the
    public Shopify collection JSON and only keep rows with real sale prices.
    """
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    products = []
    page = 1
    while True:
        url = f"{AU_SHOPIFY_SALE_API}?{urllib.parse.urlencode({'limit': 250, 'page': page})}"
        payload = fetch_json(url)
        batch = payload.get("products") or []
        if not batch:
            break
        for product in batch:
            products.extend(shopify_product_records(product, region, now))
        if len(batch) < 250:
            break
        page += 1

    print(f"    ✓ AU Shopify sale: {len(products)} 个颜色级折扣商品", flush=True)
    return products


# ========== 主抓取逻辑 ==========

async def dismiss_popups(page):
    """关闭 GDPR / Cookie 同意弹窗"""
    # Arc'teryx outlet uses 'Continue' for cookie consent (OneTrust-based)
    selectors = [
        "button:has-text('Continue')",       # Arc'teryx outlet primary
        "button:has-text('Continuer')",       # French
        "button:has-text('Weiter')",          # German
        "button:has-text('Continua')",        # Italian
        "button:has-text('Continuar')",       # Spanish
        "button:has-text('Doorgaan')",        # Dutch
        "button:has-text('Fortsæt')",         # Danish
        "button:has-text('続ける')",           # Japanese
        "button[id*='accept']",
        "button[class*='accept']",
        "#onetrust-accept-btn-handler",
        "button:has-text('Accept All')",
        "button:has-text('Accept')",
        "button:has-text('Akzeptieren')",
        "button:has-text('同意')",
    ]
    for sel in selectors:
        try:
            btn = page.locator(sel).first
            if await btn.is_visible(timeout=1000):
                await btn.click(timeout=1000)
                await asyncio.sleep(1.0)
                return  # Only need to dismiss once
        except Exception:
            pass


def next_stable_bottom_rounds(
    *,
    at_bottom: bool,
    count: int,
    height: int,
    previous_count: int,
    previous_height: int,
    current_rounds: int,
) -> int:
    """Only count stability while the viewport is truly at a stable bottom."""
    if at_bottom and count == previous_count and height == previous_height:
        return current_rounds + 1
    return 0


async def scroll_to_load_all(page) -> int:
    """
    反复滚动到页面底部，直到：
    - 商品数量不再增长，或
    - 达到最大滚动轮次
    返回最终商品瓦片数量。
    """
    await page.evaluate("window.scrollTo(0, 0)")
    prev_count = 0
    prev_height = 0
    stable_bottom_rounds = 0

    for i in range(MAX_SCROLL_ROUNDS):
        # 也尝试点击"加载更多"按钮
        try:
            load_more = page.locator(
                "button:has-text('Load more'), button:has-text('Show more'), "
                "button:has-text('Mehr laden'), button:has-text('Voir plus'), "
                "button:has-text('もっと見る'), [data-testid='load-more']"
            ).first
            if await load_more.is_visible(timeout=500):
                await load_more.click(timeout=500)
                await asyncio.sleep(SCROLL_PAUSE)
        except Exception:
            pass

        # 数商品数 — Arc'teryx outlet links are /shop/mens/, /shop/womens/ or unisex /shop/{slug} (no region prefix)
        state = await page.evaluate("""() => {
            const links = document.querySelectorAll('a[href*="/shop/"]');
            const seen = new Set();
            links.forEach(a => {
                const url = a.href.split('?')[0];
                // Only count actual product pages (slug has a number or is long enough)
                const match = url.match(/\\/shop\\/(?:(mens|womens)\\/)?([^\\/?#]+)\\/?$/);
                if (match && match[2].length > 5 && match[2] !== 'womens') seen.add(url);
            });
            return {
                count: seen.size,
                scrollY: window.scrollY,
                viewportHeight: window.innerHeight,
                scrollHeight: document.body.scrollHeight,
            };
        }""")
        count = state["count"]
        height = state["scrollHeight"]
        at_bottom = state["scrollY"] + state["viewportHeight"] >= height - 50

        next_stable = next_stable_bottom_rounds(
            at_bottom=at_bottom,
            count=count,
            height=height,
            previous_count=prev_count,
            previous_height=prev_height,
            current_rounds=stable_bottom_rounds,
        )
        if next_stable >= 4:
            break  # 真正位于底部且 DOM/高度连续稳定，才认为加载完毕
        stable_bottom_rounds = next_stable
        if count != prev_count or height != prev_height:
            prev_count = count
            prev_height = height

        if count > 0:
            print(
                f"      滚动轮 {i+1}: {count} 个商品链接"
                f"{'（底部）' if at_bottom else ''}",
                flush=True,
            )

        if at_bottom:
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        else:
            # 逐屏经过中间区域，触发视口懒渲染，避免直接跳底漏商品。
            await page.evaluate(
                "window.scrollBy(0, Math.max(600, Math.floor(window.innerHeight * 0.8)))"
            )
        await asyncio.sleep(SCROLL_PAUSE)

    return prev_count


async def extract_tiles(page, region: dict, gender: str) -> list:
    """从已完全加载的列表页提取商品瓦片数据"""
    return await page.evaluate(r"""(args) => {
        const { regionCode, regionLang, regionName, currency, symbol, gender } = args;
        const results = [];
        const seen = new Set();

        // Arc'teryx outlet listing page links are /shop/mens/{slug} (no region prefix);
        // unisex products are listed on both gender pages as /shop/{slug}.
        const genderSegment = gender === 'mens' ? 'mens' : 'womens';
        const links = [...document.querySelectorAll('a[href*="/shop/"]')];

        links.forEach(a => {
            let rawUrl = (a.href || '').split('?')[0];
            if (!rawUrl) return;
            const match = rawUrl.match(/\/shop\/(?:(mens|womens)\/)?([^\/?#]+)\/?$/);
            if (!match || match[2] === 'womens') return;
            if (match[1] && match[1] !== genderSegment) return;
            const slug = match[2];
            if (slug.length < 4) return;
            // Normalize: add region/lang prefix if missing
            // Raw link: https://outlet.arcteryx.com/shop/mens/{slug}
            // Needed:   https://outlet.arcteryx.com/{code}/{lang}/shop/mens/{slug}
            let url = rawUrl;
            if (!rawUrl.includes('/' + regionCode + '/')) {
                // Replace arcteryx.com/shop/ → arcteryx.com/{code}/{lang}/shop/
                url = rawUrl.replace('outlet.arcteryx.com/shop/',
                    'outlet.arcteryx.com/' + regionCode + '/' + regionLang + '/shop/');
            }
            if (seen.has(url)) return;
            seen.add(url);

            // 尝试找到包含价格的最近祖先容器
            let container = a;
            for (let depth = 0; depth < 6; depth++) {
                const p = container.parentElement;
                if (!p) break;
                container = p;
                if (container.querySelector('[class*="price"], [data-testid*="price"]')) break;
            }

            const text = container.textContent || a.textContent || '';

            // 提取所有价格数字（locale-aware: 支持 "1,299.99" / "1.299,00" / "9 990,00" / "1 299 kr" / "1'099.00" Swiss）
            const normalizeNum = (s) => {
                // 空格类 + Swiss apostrophes (U+0027, U+2019) 视作千分位分隔符
                s = s.replace(/[\s\u00a0\u0027\u2019]/g, '');
                const hasDot = s.includes('.'), hasComma = s.includes(',');
                if (hasDot && hasComma) {
                    // 两种分隔符都有 → 最后出现的是小数点
                    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
                    else s = s.replace(/,/g, '');
                } else if (hasComma) {
                    const parts = s.split(',');
                    const last = parts[parts.length - 1];
                    if (parts.length === 2 && last.length <= 2) s = parts[0] + '.' + last; // 欧式小数
                    else s = parts.join(''); // 千分位
                } else if (hasDot) {
                    const parts = s.split('.');
                    const last = parts[parts.length - 1];
                    // "1.299" (EUR 千分位) vs "9.99" (USD 小数)
                    if (parts.length >= 2 && last.length === 3 && parts[0].length <= 3) s = parts.join('');
                }
                return parseFloat(s);
            };
            const allNums = [...text.matchAll(/\d+(?:[\s\u00a0.,\u0027\u2019]\d+)*/g)]
                .map(m => normalizeNum(m[0]))
                .filter(n => n > 0 && n < 1000000);

            // 去重并排序
            const uniqueNums = [...new Set(allNums)].sort((a, b) => a - b);

            // 通常规律：较大的是原价，较小的是售价
            // 但必须有合理折扣（售价 < 原价 * 0.99）
            let originalPrice = 0, salePrice = 0, discountPct = 0;
            if (uniqueNums.length >= 2) {
                // 找最常见的两个价格对 (原价 > 售价)
                // 尝试所有对，取折扣率最合理(10~90%)的
                for (let i = uniqueNums.length - 1; i >= 1; i--) {
                    for (let j = i - 1; j >= 0; j--) {
                        const orig = uniqueNums[i];
                        const sale = uniqueNums[j];
                        const disc = Math.round((1 - sale / orig) * 100);
                        if (disc >= 10 && disc <= 90) {
                            originalPrice = orig;
                            salePrice = sale;
                            discountPct = disc;
                            break;
                        }
                    }
                    if (salePrice > 0) break;
                }
            }
            if (salePrice === 0 && uniqueNums.length === 1) {
                salePrice = uniqueNums[0];
            }

            // 提取商品名称
            // 优先找 <img alt="">, <h2>, <h3>, [data-testid*="name"], [class*="name"]
            let name = '';
            const imgEl = container.querySelector('img[alt]');
            if (imgEl) name = imgEl.getAttribute('alt') || '';
            if (!name) {
                const hEl = container.querySelector('h2, h3, h4, [class*="product-name"], [class*="ProductName"], [data-testid*="name"]');
                if (hEl) name = hEl.textContent.trim();
            }
            if (!name) {
                // 用 URL slug 反推
                const slug2 = url.split('/').pop() || '';
                name = slug2.replace(/-\d+$/, '').replace(/-/g, ' ')
                    .replace(/\b\w/g, c => c.toUpperCase());
            }

            // 提取主图
            let imageUrl = '';
            const imgTag = container.querySelector('img[src*="imgix"], img[src*="arcteryx"]');
            if (imgTag) imageUrl = imgTag.src || '';

            // 推断性别
            const genderVal = match[1] === 'mens' ? 'men' : match[1] === 'womens' ? 'women' : 'unisex';

            // 推断 model（去掉 Men's/Women's 后缀）
            const cleanName = name.replace(/\s*(?:Men's|Women's|Mens|Womens)\s*$/i, '').trim();
            const modelMatch = cleanName.match(/^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})/);
            const model = modelMatch ? modelMatch[1] : cleanName;

            results.push({
                url,
                full_name: name || cleanName,
                model: model || cleanName,
                description: '',
                gender: genderVal,
                region: regionCode,
                region_name: regionName,
                currency,
                symbol,
                original_price: originalPrice,
                sale_price: salePrice,
                sale_price_max: salePrice,
                discount_pct: discountPct,
                category: '',       // sku_scraper 会重新填充
                outlet_category: '',
                image_url: imageUrl,
                colors: [],
                sizes: [],
                size_stock: {},
                images: [],
                local_image: '',
                color: '',
                sku_id: '',
                last_updated: new Date().toISOString().replace('T', ' ').substring(0, 19),
            });
        });

        return results;
    }""", {"regionCode": region["code"], "regionLang": region["lang"],
           "regionName": region["name"],
           "currency": region["currency"], "symbol": region["symbol"],
           "gender": gender})


async def scrape_region(browser, region: dict, genders: list, dry_run: bool) -> tuple[list, bool, list[dict]]:
    """抓取单个地区的所有性别分类页"""
    if region["code"] == "au":
        products = await asyncio.to_thread(scrape_au_shopify_sale, region)
        urls = sorted({p.get("url") for p in products if p.get("url")})
        return products, False, [{
            "region": region["code"],
            "gender": "*",
            "status": "success" if len(urls) >= 10 else "failed",
            "product_count": len(urls),
            "urls": urls,
        }]

    context = await browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        locale="en-US",
        viewport={"width": 1440, "height": 900},
    )
    page = await context.new_page()
    # Shorter navigation timeout to avoid hanging on slow regions
    page.set_default_navigation_timeout(45_000)
    page.set_default_timeout(10_000)
    all_products = []
    scope_results = []
    unisex_by_url: dict[str, dict] = {}
    pages_complete: list[bool] = []

    try:
        for gender in genders:
            # Arc'teryx outlet listing page is at /c/{gender}, not /shop/{gender}
            url = f"https://outlet.arcteryx.com/{region['code']}/{region['lang']}/c/{gender}"
            print(f"  → {url}", flush=True)

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            except PWTimeout:
                print(f"    ⚠ 超时，跳过", flush=True)
                scope_results.append({"region": region["code"], "gender": gender, "status": "failed", "reason": "navigation_timeout", "product_count": 0, "urls": []})
                continue
            except Exception as e:
                print(f"    ⚠ 导航失败: {e}", flush=True)
                scope_results.append({"region": region["code"], "gender": gender, "status": "failed", "reason": "navigation_error", "product_count": 0, "urls": []})
                continue

            final_region = region_from_url(page.url)
            if final_region and final_region != region["code"]:
                print(
                    f"    ⚠ 地区重定向 {region['code']} → {final_region}，跳过该地区以避免币种/价格错配",
                    flush=True,
                )
                return [], True, scope_results

            # 等待页面基本内容加载
            await asyncio.sleep(4.0)
            await dismiss_popups(page)
            await asyncio.sleep(2.0)

            # 等待商品出现 — product links on listing page are /shop/{gender}/
            try:
                await page.wait_for_selector(
                    f'a[href*="/shop/{gender}/"]', timeout=25_000
                )
            except PWTimeout:
                print(f"    ⚠ 未发现商品链接（25s超时），跳过", flush=True)
                scope_results.append({"region": region["code"], "gender": gender, "status": "failed", "reason": "no_product_links", "product_count": 0, "urls": []})
                continue

            # 滚动加载全部
            total = await scroll_to_load_all(page)
            print(f"    ✓ 加载完毕，共 {total} 个商品链接", flush=True)

            # 提取商品瓦片
            tiles = await extract_tiles(page, region, gender)

            # 补充 category（基于 URL 推断）
            for t in tiles:
                if not t["category"]:
                    t["category"] = infer_category(t["full_name"], t["url"])

            # 过滤掉分类导航链接（没有有效价格且 slug 太短）
            valid = []
            for t in tiles:
                slug = slug_from_url(t["url"])
                # 商品 slug 通常 > 5 chars 且不是纯分类名
                if len(slug) > 5 and t.get("sale_price", 0) > 0:
                    valid.append(t)
                elif len(slug) > 5:
                    # 即使价格为0也保留（sku_scraper 会重新抓详情）
                    valid.append(t)

            page_urls = {p.get("url") for p in valid if p.get("url")}
            unisex = [p for p in valid if outlet_link_gender(p.get("url", "")) == UNISEX_SCOPE]
            gendered = [p for p in valid if outlet_link_gender(p.get("url", "")) != UNISEX_SCOPE]
            urls = sorted({p.get("url") for p in gendered if p.get("url")})
            minimum = max(10, round(total * 0.8))
            complete = total >= 10 and len(page_urls) >= minimum
            pages_complete.append(complete)
            scope_results.append({
                "region": region["code"],
                "gender": gender,
                "status": "success" if complete else "failed",
                "reason": None if complete else "incomplete_scope",
                "listed_count": total,
                "product_count": len(urls),
                "urls": urls,
            })
            if complete:
                print(f"    ✓ 提取 {len(valid)} 个有效商品（{gender}，完整，含中性 {len(unisex)}）", flush=True)
                all_products.extend(gendered)
                for p in unisex:
                    unisex_by_url.setdefault(p["url"], p)
            else:
                print(f"    ⚠ 仅提取 {len(page_urls)}/{total} 个商品（{gender}），本范围不参与对账", flush=True)

            if dry_run:
                break  # dry-run 只抓第一个 gender

        all_products.extend(unisex_by_url.values())
        scope_results.append(
            unisex_scope_result(region["code"], set(unisex_by_url), pages_complete, len(genders))
        )
        return all_products, False, scope_results

    finally:
        await context.close()


# ========== 主函数 ==========

async def run(args):
    # 确定要抓取的地区
    if args.region:
        regions = [r for r in REGIONS if r["code"] in args.region]
        if not regions:
            print(f"[ERROR] 未知地区代码: {args.region}", file=sys.stderr)
            sys.exit(1)
    else:
        regions = REGIONS

    if args.start_from and not args.region:
        codes = [r["code"] for r in REGIONS]
        if args.start_from in codes:
            start_idx = codes.index(args.start_from)
            regions = REGIONS[start_idx:]
            print(f"[global_scraper] 从 {args.start_from} 开始，跳过前 {start_idx} 个地区")

    if args.dry_run:
        regions = regions[:1]
        print("[dry-run] 只抓第一个地区，不写文件")

    # 加载现有数据（用于合并）
    existing: list = load_json(DATA_FILE, [])
    previous_region_by_url: dict[str, str] = {
        p.get("url", ""): p.get("region", "")
        for p in existing
        if p.get("url") and p.get("region")
    }
    # 构建 {url: index} 索引，用于快速更新
    existing_by_url: dict = {p["url"]: i for i, p in enumerate(existing)}
    print(f"[global_scraper] 现有 {len(existing)} 条记录")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ],
        )

        total_new = 0
        total_updated = 0
        skipped_redirect_regions = set()
        manifest_scopes = []
        redirect_candidates: set[str] = set()

        for region in regions:
            print(f"\n🌍 [{region['code'].upper()}] {region['name']} ({region['currency']})", flush=True)

            try:
                products, redirected, scope_results = await scrape_region(
                    browser, region,
                    genders=GENDERS,
                    dry_run=args.dry_run,
                )
                manifest_scopes.extend(scope_results)
            except Exception as e:
                print(f"  ⚠ 地区抓取失败: {e}", flush=True)
                products = []
                redirected = False
                manifest_scopes.extend({
                    "region": region["code"],
                    "gender": gender,
                    "status": "failed",
                    "reason": "region_exception",
                    "product_count": 0,
                    "urls": [],
                } for gender in GENDERS)

            if redirected:
                skipped_redirect_regions.add(region["code"])
                if not args.dry_run:
                    before = len(existing)
                    existing = [p for p in existing if p.get("region") != region["code"]]
                    existing_by_url = {p["url"]: i for i, p in enumerate(existing)}
                    removed = before - len(existing)
                    if removed:
                        print(f"  → 已从本地数据移除 {removed} 条 {region['code']} 旧记录", flush=True)
                        save_json(DATA_FILE, existing)
                continue

            for p in products:
                url = p["url"]
                if url in existing_by_url:
                    # 更新现有条目（保留 sku_scraper 已填充的字段）
                    idx = existing_by_url[url]
                    old = existing[idx]
                    old_region = old.get("region", "")

                    # 价格三元组 (orig, sale, disc) 必须整体一致，绝不能把新一次的 sale
                    # 和旧一次的 orig 混在一起（之前的 bug 导致 SE/DK 出现 sale > orig
                    # 的数据，因为 SE 页面抓不到原价时落回旧值，但旧值单位/来源已不匹配）
                    new_orig = p["original_price"] or 0
                    new_sale = p["sale_price"] or 0
                    new_disc = p["discount_pct"] or 0
                    old_orig = old.get("original_price", 0) or 0
                    old_sale = old.get("sale_price", 0) or 0
                    old_disc = old.get("discount_pct", 0) or 0

                    if new_sale > 0 and new_orig > 0 and new_orig >= new_sale:
                        # 新抓到的三元组本身一致 → 整体用新
                        final_orig, final_sale, final_disc = new_orig, new_sale, new_disc
                    elif new_sale > 0 and new_orig == 0 and old_orig > new_sale * 1.05:
                        # 新只拿到 sale、旧 orig 在合理范围内（> 新 sale）→ 拼接，重算 disc
                        final_orig = old_orig
                        final_sale = new_sale
                        final_disc = round((1 - new_sale / old_orig) * 100) if old_orig > 0 else 0
                    elif new_sale > 0:
                        # 新 sale 存在但旧 orig 不兼容 → 只保 sale，orig/disc 置零（前端会忽略）
                        final_orig, final_sale, final_disc = 0, new_sale, 0
                    else:
                        # 新抓取整体失败 → 保持旧值
                        final_orig, final_sale, final_disc = old_orig, old_sale, old_disc

                    if p.get("source") == "arcteryx_au_shopify_sale":
                        # AU comes from authoritative Shopify JSON with color,
                        # size, stock, images, and source metadata already
                        # hydrated. Keep the full row fresh so sku_scraper can
                        # bypass outlet.arcteryx.com PDP selectors next run.
                        old.update(p)
                    else:
                        old.update({
                            "original_price": final_orig,
                            "sale_price":     final_sale,
                            "sale_price_max": p["sale_price_max"] or final_sale,
                            "discount_pct":   final_disc,
                            "image_url":      p["image_url"]      or old.get("image_url", ""),
                            "last_updated":   p["last_updated"],
                        })
                    existing[idx] = old
                    total_updated += 1
                    if old_region and p.get("region") and old_region != p["region"]:
                        redirect_candidates.add(url)
                else:
                    # 新商品
                    existing.append(p)
                    existing_by_url[url] = len(existing) - 1
                    total_new += 1
                    redirect_candidates.add(url)

            print(f"  → 新增 {total_new} / 更新 {total_updated}", flush=True)

            # ── 每完成一个地区立即保存（防止中途崩溃丢失数据）──
            if not args.dry_run:
                save_json(DATA_FILE, existing)
                print(f"  💾 已保存 global_data.json ({len(existing)} 条)", flush=True)

            if not args.dry_run and len(regions) > 1:
                await asyncio.sleep(REGION_PAUSE)

        await browser.close()

    print(f"\n{'='*60}")
    print(f"✅ 全球抓取完成！")
    print(f"   新增商品: {total_new}")
    print(f"   更新商品: {total_updated}")
    print(f"   总计记录: {len(existing)}")
    print(f"{'='*60}")

    if args.dry_run:
        print("[dry-run] 不写文件，前3条样本:")
        new_items = [p for p in existing if p not in load_json(DATA_FILE, [])]
        import pprint
        pprint.pprint((new_items or existing)[:3])
        return

    if skipped_redirect_regions:
        save_json(
            SKIPPED_REGIONS_FILE,
            [{"region": code, "reason": "cross_region_redirect"} for code in sorted(skipped_redirect_regions)],
        )
        print(f"[validate] skipped redirected regions: {', '.join(sorted(skipped_redirect_regions))}", flush=True)
    elif SKIPPED_REGIONS_FILE.exists():
        SKIPPED_REGIONS_FILE.unlink()

    # ── URL 重定向验证（剔除跨地区幻影条目） ─────────────────────────────────
    # Arc'teryx 有时在 JP/EU 列表页显示不在该地区销售的商品，点击后静默重定向到
    # 其它地区（如 jp/ja/.../vertex-alpine-shoe → us/en/.../vertex-alpine-shoe）。
    # 这种"幻影"条目会让前端详情页跳错国家。这里做一次并发 HEAD 检查，凡是
    # 最终 URL 的地区段与 record.region 不一致的直接丢弃。
    # 只验证今天刚更新的记录，避免每次全量 ~3700 次 HEAD。
    if args.skip_redirect_validation:
        print("[validate] skipped redirect validation by flag", flush=True)
    else:
        if not redirect_candidates:
            redirect_candidates = {
                url
                for url, previous_region in previous_region_by_url.items()
                if url in existing_by_url and existing[existing_by_url[url]].get("region", "") != previous_region
            }
        existing = _filter_redirected(
            existing,
            candidate_urls=redirect_candidates,
            max_workers=args.redirect_workers,
            request_timeout=args.redirect_timeout,
        )

    save_json(DATA_FILE, existing)
    print(f"[global_scraper] 已写入 {DATA_FILE}")
    save_json(CRAWL_MANIFEST_FILE, {
        "version": 1,
        "generated_at": datetime.now().astimezone().isoformat(),
        "scopes": manifest_scopes,
    })
    successful = sum(1 for scope in manifest_scopes if scope.get("status") == "success")
    print(f"[global_scraper] crawl manifest: {successful}/{len(manifest_scopes)} successful scopes")


# ── URL 重定向验证 ────────────────────────────────────────────────────────────
_REDIRECT_SSL = ssl.create_default_context()
_REDIRECT_SSL.check_hostname = False
_REDIRECT_SSL.verify_mode = ssl.CERT_NONE

_URL_REGION_RE = re.compile(r"https?://outlet\.arcteryx\.com/([a-z]{2})/")


def _final_region(url: str, timeout: float = 8.0):
    """HEAD the URL following redirects; return the region segment of the final URL, or None on error."""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, context=_REDIRECT_SSL, timeout=timeout) as resp:
            final = resp.geturl()
        m = _URL_REGION_RE.match(final)
        return m.group(1) if m else None
    except Exception:
        return None


def _filter_redirected(
    products: list,
    today_only: bool = True,
    candidate_urls: set[str] | None = None,
    max_workers: int = 30,
    request_timeout: float = 8.0,
) -> list:
    """Remove products whose URL redirects to a different region (phantom entries).

    today_only: only validate records updated today (much cheaper than full ~3700 HEADs).
    candidate_urls: when provided, only validate URLs in this candidate set.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    to_check = []
    for i, p in enumerate(products):
        url = p.get("url", "")
        if candidate_urls is not None and url not in candidate_urls:
            continue
        if today_only and not (p.get("last_updated", "") or "").startswith(today):
            continue
        region = p.get("region", "")
        if not url or not region:
            continue
        to_check.append((i, url, region))

    if not to_check:
        return products

    print(f"[validate] HEAD {len(to_check)} URLs to detect cross-region redirects...", flush=True)
    redirect_hits = []
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(_final_region, url, request_timeout): (i, url, region) for (i, url, region) in to_check}
        for fut in as_completed(futures):
            i, url, region = futures[fut]
            final_region = fut.result()
            # final_region is None on network error — keep the record (fail open)
            if final_region and final_region != region:
                redirect_hits.append((i, url, region, final_region))

    if not redirect_hits:
        print("[validate] no phantom entries found", flush=True)
        return products

    # Region-gated fail-open: Arc'teryx often redirects HEAD requests from this
    # server to a location fallback even when the listing page itself served
    # valid regional products. Only remove sparse mismatches; skip mass,
    # same-destination redirects that look like geolocation behavior.
    checked_by_region = Counter(region for _, _, region in to_check)
    hits_by_region = defaultdict(list)
    for hit in redirect_hits:
        hits_by_region[hit[2]].append(hit)

    bad_indices = set()
    skipped = 0
    for region, hits in sorted(hits_by_region.items()):
        final_counts = Counter(hit[3] for hit in hits)
        dominant_region, dominant_count = final_counts.most_common(1)[0]
        total_checked = checked_by_region[region]
        dominant_ratio = dominant_count / max(total_checked, 1)

        if dominant_count >= 20 and dominant_ratio >= 0.25:
            skipped += len(hits)
            print(
                "[validate] skip mass redirect "
                f"{region} → {dominant_region}: {dominant_count}/{total_checked} "
                "HEAD results; likely geo fallback",
                flush=True,
            )
            continue

        for i, url, expected_region, final_region in hits:
            bad_indices.add(i)
            print(f"  ✗ phantom: {url} → {final_region} (expected {expected_region})", flush=True)

    if skipped:
        print(f"[validate] kept {skipped} mass-redirect records", flush=True)

    if not bad_indices:
        print("[validate] no actionable phantom entries found", flush=True)
        return products

    print(f"[validate] removing {len(bad_indices)} phantom entries", flush=True)
    return [p for i, p in enumerate(products) if i not in bad_indices]


def main():
    parser = argparse.ArgumentParser(description="Arc'teryx 全球 Outlet 商品列表爬虫")
    parser.add_argument("--dry-run", action="store_true",
                        help="只抓第一个地区，不写 global_data.json")
    parser.add_argument("--region", nargs="+", metavar="CODE",
                        help="只抓指定地区代码，如 --region us ca gb")
    parser.add_argument("--start-from", metavar="CODE",
                        help="从指定地区代码开始（跳过之前的地区）")
    parser.add_argument("--skip-redirect-validation", action="store_true",
                        default=os.environ.get("SKIP_REDIRECT_VALIDATION") == "1",
                        help="跳过最终 HEAD 重定向校验")
    parser.add_argument("--redirect-timeout", type=float,
                        default=float(os.environ.get("REDIRECT_VALIDATION_TIMEOUT", "8")),
                        help="单个 HEAD 重定向校验超时时间（秒）")
    parser.add_argument("--redirect-workers", type=int,
                        default=int(os.environ.get("REDIRECT_VALIDATION_WORKERS", "30")),
                        help="HEAD 重定向校验并发数")
    args = parser.parse_args()

    asyncio.run(run(args))


if __name__ == "__main__":
    main()
