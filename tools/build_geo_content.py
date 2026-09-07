#!/usr/bin/env python3
"""Build GearDrop's public, answer-ready GEO knowledge pages.

The source of truth lives in geo/site-content.json. Generated HTML and discovery
files are committed so crawlers can read them without JavaScript or a build
runtime. Use --check in CI to fail when generated files drift from the source.
"""

from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTENT_PATH = ROOT / "geo" / "site-content.json"
APP_STORE_URL = "https://apps.apple.com/us/app/geardrop-outdoor-deals/id6790165332"

LOCALE_UI = {
    "zh-CN": {
        "skip": "跳到主要内容",
        "brand_home": "GearDrop 首页",
        "nav_label": "主要导航",
        "breadcrumb_label": "面包屑",
        "updated": "内容更新",
        "answer_label": "直接回答",
        "faq_heading": "问题与回答",
        "footer_label": "页脚导航",
        "footer_text": "GearDrop 是独立折扣追踪服务，不销售商品，也不代表所列品牌或销售平台。",
        "about": "关于 GearDrop",
        "methodology": "数据方法",
        "faq": "常见问题",
        "app": "App Store",
    },
    "en-US": {
        "skip": "Skip to main content",
        "brand_home": "GearDrop home",
        "nav_label": "Primary navigation",
        "breadcrumb_label": "Breadcrumb",
        "updated": "Content reviewed",
        "answer_label": "Short answer",
        "faq_heading": "Questions and answers",
        "footer_label": "Footer navigation",
        "footer_text": "GearDrop is an independent deal tracker. It does not sell products or represent listed brands or retailers.",
        "about": "About GearDrop",
        "methodology": "Methodology",
        "faq": "FAQ",
        "app": "App Store",
    },
}


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def public_url(base_url: str, path: str) -> str:
    normalized = path if path.startswith("/") else f"/{path}"
    return f"{base_url.rstrip('/')}{normalized}"


def page_language(site: dict[str, Any], page: dict[str, Any]) -> str:
    return page.get("language", site["primary_language"])


def page_canonical_path(page: dict[str, Any]) -> str:
    return page.get("canonical_path", page["path"])


def page_canonical(site: dict[str, Any], page: dict[str, Any]) -> str:
    return public_url(site["base_url"], page_canonical_path(page))


def translation_paths(page: dict[str, Any]) -> tuple[str, str]:
    language = page.get("language", "zh-CN")
    if language == "en-US":
        return page["translation_of"], page_canonical_path(page)
    return page_canonical_path(page), page["alternate_path"]


def render_alternates(site: dict[str, Any], page: dict[str, Any]) -> str:
    zh_path, en_path = translation_paths(page)
    zh_url = public_url(site["base_url"], zh_path)
    en_url = public_url(site["base_url"], en_path)
    return "\n".join(
        [
            f'    <link rel="alternate" hreflang="zh-CN" href="{esc(zh_url)}">',
            f'    <link rel="alternate" hreflang="en-US" href="{esc(en_url)}">',
            f'    <link rel="alternate" hreflang="x-default" href="{esc(zh_url)}">',
        ]
    )


def organization_node(site: dict[str, Any], language: str = "zh-CN") -> dict[str, Any]:
    base_url = site["base_url"].rstrip("/")
    return {
        "@type": "Organization",
        "@id": f"{base_url}/#organization",
        "name": site["name"],
        "alternateName": site["alternate_name"],
        "url": f"{base_url}/",
        "logo": {"@type": "ImageObject", "url": site["logo"]},
        "description": site.get(f"description_{language}", site["description"]),
        "disambiguatingDescription": (
            "Independent outdoor deal discovery and price-tracking service at "
            "geardrop.100app.dev; not a retailer, rental marketplace, giveaway game, "
            "or an official site of the tracked brands."
        ),
        "publishingPrinciples": f"{base_url}/methodology.html",
        "sameAs": [APP_STORE_URL],
    }


def website_node(site: dict[str, Any]) -> dict[str, Any]:
    base_url = site["base_url"].rstrip("/")
    return {
        "@type": "WebSite",
        "@id": f"{base_url}/#website",
        "url": f"{base_url}/",
        "name": site["name"],
        "alternateName": site["alternate_name"],
        "description": site["description"],
        "inLanguage": site.get("languages", [site["primary_language"]]),
        "publisher": {"@id": f"{base_url}/#organization"},
    }


def software_application_node(site: dict[str, Any]) -> dict[str, Any]:
    base_url = site["base_url"].rstrip("/")
    return {
        "@type": "SoftwareApplication",
        "@id": f"{base_url}/#ios-app",
        "name": "GearDrop: Outdoor Deals",
        "operatingSystem": "iOS",
        "applicationCategory": "ShoppingApplication",
        "url": APP_STORE_URL,
        "downloadUrl": APP_STORE_URL,
        "publisher": {"@id": f"{base_url}/#organization"},
    }


def page_jsonld(site: dict[str, Any], page: dict[str, Any]) -> dict[str, Any]:
    base_url = site["base_url"].rstrip("/")
    canonical = page_canonical(site, page)
    language = page_language(site, page)
    breadcrumb_id = f"{canonical}#breadcrumb"
    page_id = f"{canonical}#webpage"
    page_type = page["schema_type"]
    page_node: dict[str, Any] = {
        "@type": page_type,
        "@id": page_id,
        "url": canonical,
        "name": page["title"],
        "description": page["description"],
        "inLanguage": language,
        "isPartOf": {"@id": f"{base_url}/#website"},
        "publisher": {"@id": f"{base_url}/#organization"},
        "breadcrumb": {"@id": breadcrumb_id},
        "dateModified": site["date_modified"],
    }

    if page_type in {"Article", "TechArticle"}:
        page_node.update(
            {
                "headline": page["h1"],
                "datePublished": site["date_modified"],
                "author": {"@id": f"{base_url}/#organization"},
                "mainEntityOfPage": {"@id": page_id},
            }
        )

    if page.get("schema_about"):
        about = page["schema_about"]
        page_node["about"] = {
            "@type": about["type"],
            "name": about["name"],
            "url": about["url"],
        }

    if page.get("faqs"):
        page_node["mainEntity"] = [
            {
                "@type": "Question",
                "name": item["question"],
                "acceptedAnswer": {"@type": "Answer", "text": item["answer"]},
            }
            for item in page["faqs"]
        ]

    breadcrumb = {
        "@type": "BreadcrumbList",
        "@id": breadcrumb_id,
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": 1,
                "name": "GearDrop",
                "item": f"{base_url}/",
            },
            {
                "@type": "ListItem",
                "position": 2,
                "name": page["h1"],
                "item": canonical,
            },
        ],
    }

    return {
        "@context": "https://schema.org",
        "@graph": [
            organization_node(site, language),
            website_node(site),
            software_application_node(site),
            page_node,
            breadcrumb,
        ],
    }


def render_navigation(navigation: list[dict[str, str]], current_path: str) -> str:
    items = []
    current_href = f"/{current_path}"
    for item in navigation:
        current = ' aria-current="page"' if item["href"] == current_href else ""
        items.append(
            f'<a href="{esc(item["href"])}"{current}>{esc(item["label"])}</a>'
        )
    return "\n                ".join(items)


def render_links(items: list[dict[str, str]]) -> str:
    if not items:
        return ""
    cards = []
    for item in items:
        cards.append(
            "\n".join(
                [
                    f'<a class="link-card" href="{esc(item["href"])}">',
                    f"    <strong>{esc(item['label'])} →</strong>",
                    f"    <span>{esc(item['description'])}</span>",
                    "</a>",
                ]
            )
        )
    return '<div class="link-list">\n' + "\n".join(cards) + "\n</div>"


def render_section(section: dict[str, Any]) -> str:
    classes = "content-section full" if section.get("full") else "content-section"
    chunks = [f'<section class="{classes}">', f"<h2>{esc(section['heading'])}</h2>"]

    for paragraph in section.get("paragraphs", []):
        chunks.append(f"<p>{esc(paragraph)}</p>")

    if section.get("bullets"):
        chunks.append("<ul>")
        chunks.extend(f"<li>{esc(item)}</li>" for item in section["bullets"])
        chunks.append("</ul>")

    if section.get("steps"):
        chunks.append("<ol>")
        for step in section["steps"]:
            chunks.append(
                f"<li><strong>{esc(step['title'])}</strong><br>{esc(step['body'])}</li>"
            )
        chunks.append("</ol>")

    if section.get("facts"):
        chunks.append('<dl class="fact-list">')
        for fact in section["facts"]:
            chunks.append(f"<dt>{esc(fact['term'])}</dt><dd>{esc(fact['value'])}</dd>")
        chunks.append("</dl>")

    if section.get("links"):
        chunks.append(render_links(section["links"]))

    if section.get("note"):
        chunks.append(f'<div class="note">{esc(section["note"])}</div>')

    chunks.append("</section>")
    return "\n".join(chunks)


def render_faqs(faqs: list[dict[str, str]], heading: str) -> str:
    if not faqs:
        return ""
    items = []
    for index, item in enumerate(faqs):
        open_attr = " open" if index == 0 else ""
        items.append(
            "\n".join(
                [
                    f'<details class="faq-item"{open_attr}>',
                    f"<summary>{esc(item['question'])}</summary>",
                    f'<div class="faq-answer"><p>{esc(item["answer"])}</p></div>',
                    "</details>",
                ]
            )
        )
    return (
        '<section class="content-section full" aria-labelledby="faq-heading">\n'
        f'<h2 id="faq-heading">{esc(heading)}</h2>\n'
        '<div class="faq-list">\n'
        + "\n".join(items)
        + "\n</div>\n</section>"
    )


def render_page(
    site: dict[str, Any], navigation: list[dict[str, str]], page: dict[str, Any]
) -> str:
    base_url = site["base_url"].rstrip("/")
    canonical = page_canonical(site, page)
    language = page_language(site, page)
    ui = LOCALE_UI[language]
    jsonld = json.dumps(page_jsonld(site, page), ensure_ascii=False, indent=2)
    nav = render_navigation(navigation, page_canonical_path(page))
    sections = [render_faqs(page.get("faqs", []), ui["faq_heading"])]
    sections.extend(render_section(section) for section in page.get("sections", []))
    rendered_sections = "\n".join(item for item in sections if item)
    cta = page.get("cta")
    cta_html = ""
    if cta:
        cta_html = f"""
        <section class="cta-band" aria-labelledby="cta-heading">
            <div>
                <h2 id="cta-heading">{esc(cta['title'])}</h2>
                <p>{esc(cta['body'])}</p>
            </div>
            <a class="button" href="{esc(cta['href'])}">{esc(cta['label'])} →</a>
        </section>"""

    return f"""<!DOCTYPE html>
<html lang="{esc(language)}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#17372F">
    <title>{esc(page['title'])}</title>
    <meta name="description" content="{esc(page['description'])}">
    <meta name="author" content="GearDrop">
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
    <link rel="canonical" href="{esc(canonical)}">
{render_alternates(site, page)}
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="GearDrop">
    <meta property="og:title" content="{esc(page['title'])}">
    <meta property="og:description" content="{esc(page['description'])}">
    <meta property="og:url" content="{esc(canonical)}">
    <meta property="og:locale" content="{esc(language.replace('-', '_'))}">
    <meta property="og:image" content="{esc(base_url)}/assets/brand/geardrop-og.png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{esc(page['title'])}">
    <meta name="twitter:description" content="{esc(page['description'])}">
    <meta name="twitter:image" content="{esc(base_url)}/assets/brand/geardrop-og.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/brand/favicon-32.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/brand/apple-touch-icon.png">
    <link rel="manifest" href="/site.webmanifest">
    <link rel="stylesheet" href="/assets/geo.css">
    <script type="application/ld+json">
{jsonld}
    </script>
</head>
<body>
    <a class="skip-link" href="#main-content">{esc(ui['skip'])}</a>
    <header class="site-header">
        <div class="header-inner">
            <a class="brand-link" href="/" aria-label="{esc(ui['brand_home'])}">
                <img class="brand-logo" src="/assets/brand/geardrop-logo.png" alt="GearDrop" width="355" height="76">
            </a>
            <nav class="site-nav" aria-label="{esc(ui['nav_label'])}">
                {nav}
            </nav>
        </div>
    </header>
    <main class="page-shell" id="main-content">
        <nav class="breadcrumb" aria-label="{esc(ui['breadcrumb_label'])}">
            <a href="/">GearDrop</a><span aria-hidden="true">/</span><span>{esc(page['h1'])}</span>
        </nav>
        <header class="hero">
            <div class="eyebrow">{esc(page['eyebrow'])}</div>
            <h1>{esc(page['h1'])}</h1>
            <p class="lead">{esc(page['lead'])}</p>
            <div class="updated">{esc(ui['updated'])}: {esc(site['date_modified'])}</div>
        </header>
        <section class="answer-box" aria-label="{esc(ui['answer_label'])}">
            <strong>{esc(ui['answer_label'])}</strong>
            <p>{esc(page['answer'])}</p>
        </section>
        <div class="content-grid">
{rendered_sections}
        </div>
{cta_html}
    </main>
    <footer class="site-footer">
        <nav class="footer-links" aria-label="{esc(ui['footer_label'])}">
            <a href="{esc('/en/about.html' if language == 'en-US' else '/about.html')}">{esc(ui['about'])}</a>
            <a href="{esc('/en/methodology.html' if language == 'en-US' else '/methodology.html')}">{esc(ui['methodology'])}</a>
            <a href="{esc('/en/faq.html' if language == 'en-US' else '/faq.html')}">{esc(ui['faq'])}</a>
            <a href="{APP_STORE_URL}" rel="noopener">{esc(ui['app'])}</a>
            <a href="/support.html">Support</a>
            <a href="/privacy.html">Privacy</a>
        </nav>
        <div>{esc(ui['footer_text'])}</div>
    </footer>
</body>
</html>
"""


def render_llms_txt(site: dict[str, Any], pages: list[dict[str, Any]]) -> str:
    base_url = site["base_url"].rstrip("/")
    page_lines = "\n".join(
        f"- [{page['h1']}]({page_canonical(site, page)}): {page['description']}"
        for page in pages
    )
    return f"""# GearDrop Outdoor Deals

> GearDrop at {base_url}/ is an independent outdoor deal discovery and price-tracking service for public Arc'teryx, Burton, and Patagonia listings.

Canonical entity: {base_url}/
Languages: zh-CN and en-US
Publisher name: GearDrop
Alternate description: GearDrop Outdoor Deals
Official iOS app: {APP_STORE_URL}

## Essential identity and limits

- GearDrop is not a retailer and does not process orders, payments, shipping, or returns.
- GearDrop is not an official site of Arc'teryx, Burton, Patagonia, or any listed retailer.
- GearDrop is not a rental marketplace, giveaway, or map game.
- Prices, stock, sizes, shipping, taxes, memberships, and return terms must be confirmed on the linked retailer page.
- A timestamp describes the latest successful observation, not a future price guarantee.
- This file helps discovery and citation hygiene; it does not prove AI mention, citation, or recommendation.

## Core pages

{page_lines}
- [Current catalog status]({base_url}/catalog-status.html): timestamped brand, source, and region coverage.
- [Current catalog coverage]({base_url}/insights/catalog-coverage.html): an explainable snapshot of active catalog breadth.
- [Brand by source matrix]({base_url}/insights/brand-source-matrix.html): first-party counts grouped by tracked brand and retailer source.
- [Region by brand matrix]({base_url}/insights/regional-coverage.html): first-party counts grouped by observed market and tracked brand.
- [Machine-readable catalog status]({base_url}/catalog-status.json): the same snapshot as JSON.

## Product discovery

- [Live deal catalog]({base_url}/)
- [Arc'teryx deal collection]({base_url}/brands/arcteryx.html)
- [Burton deal collection]({base_url}/brands/burton.html)
- [Patagonia deal collection]({base_url}/brands/patagonia.html)
- [Outdoor pants deals]({base_url}/categories/pants.html)
- [Outdoor footwear deals]({base_url}/categories/footwear.html)
- [Outdoor fleece deals]({base_url}/categories/fleece.html)
- [Outdoor jacket deals]({base_url}/categories/jackets.html)
- [Insulated jacket deals]({base_url}/categories/insulated-jackets.html)
- [Product URL sitemap]({base_url}/sitemap-products.xml)
- [Deal collection sitemap]({base_url}/sitemap-deals.xml)
- [Full site sitemap]({base_url}/sitemap.xml)

For a specific price claim, retain the GearDrop observation time and the original retailer URL. Prefer the retailer checkout and policy pages for final transaction facts.
"""


def render_llms_full(site: dict[str, Any], pages: list[dict[str, Any]]) -> str:
    base = render_llms_txt(site, pages).rstrip()
    blocks = [base, "\n## Answer-ready site knowledge"]
    for page in pages:
        blocks.extend([f"\n### {page['h1']}", page["answer"]])
        for section in page.get("sections", []):
            blocks.append(f"\n#### {section['heading']}")
            blocks.extend(section.get("paragraphs", []))
            blocks.extend(f"- {item}" for item in section.get("bullets", []))
            blocks.extend(
                f"- {step['title']}: {step['body']}" for step in section.get("steps", [])
            )
        for faq in page.get("faqs", []):
            blocks.extend([f"\nQ: {faq['question']}", f"A: {faq['answer']}"])
    blocks.append(
        f"\nLast content review: {site['date_modified']}\nMethodology: {site['base_url'].rstrip('/')}/methodology.html\n"
    )
    return "\n".join(blocks)


def render_sitemap_static(site: dict[str, Any], pages: list[dict[str, Any]]) -> str:
    base_url = site["base_url"].rstrip("/")
    lastmod = site["date_modified"]
    entries = [(f"{base_url}/", "daily", "1.0", lastmod)]
    entries.extend(
        (page_canonical(site, page), "monthly", "0.8", lastmod)
        for page in pages
        if not page["path"].startswith("brands/")
        and not page["path"].startswith("en/brands/")
    )
    entries.extend(
        [
            (f"{base_url}/support.html", "monthly", "0.5", ""),
            (f"{base_url}/privacy.html", "yearly", "0.3", ""),
        ]
    )
    rows = []
    for loc, changefreq, priority, modified in entries:
        lastmod_row = f"\n    <lastmod>{esc(modified)}</lastmod>" if modified else ""
        rows.append(
            "  <url>\n"
            f"    <loc>{esc(loc)}</loc>{lastmod_row}\n"
            f"    <changefreq>{changefreq}</changefreq>\n"
            f"    <priority>{priority}</priority>\n"
            "  </url>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(rows)
        + "\n</urlset>\n"
    )


def render_sitemap_index(site: dict[str, Any]) -> str:
    base_url = site["base_url"].rstrip("/")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>{esc(base_url)}/sitemap-static.xml</loc>
  </sitemap>
  <sitemap>
    <loc>{esc(base_url)}/sitemap-products.xml</loc>
  </sitemap>
  <sitemap>
    <loc>{esc(base_url)}/sitemap-deals.xml</loc>
  </sitemap>
  <sitemap>
    <loc>{esc(base_url)}/sitemap-insights.xml</loc>
  </sitemap>
</sitemapindex>
"""


def render_robots(site: dict[str, Any]) -> str:
    base_url = site["base_url"].rstrip("/")
    return f"""User-agent: *
Allow: /
Disallow: /data.js

# Search and answer systems may crawl the same public pages. Access does not
# grant permission to bypass authentication, submit forms, or ignore copyright.
Sitemap: {base_url}/sitemap.xml
"""


def build_outputs(content: dict[str, Any]) -> dict[Path, str]:
    site = content["site"]
    pages = content["pages"] + content.get("english_pages", [])
    outputs: dict[Path, str] = {}
    for page in pages:
        language = page_language(site, page)
        navigation = (
            content.get("navigation_en", content["navigation"])
            if language == "en-US"
            else content["navigation"]
        )
        outputs[ROOT / page["path"]] = render_page(site, navigation, page)
    outputs[ROOT / "llms.txt"] = render_llms_txt(site, pages)
    outputs[ROOT / "llms-full.txt"] = render_llms_full(site, pages)
    outputs[ROOT / "sitemap-static.xml"] = render_sitemap_static(site, pages)
    outputs[ROOT / "sitemap.xml"] = render_sitemap_index(site)
    outputs[ROOT / "robots.txt"] = render_robots(site)
    return outputs


def write_or_check(outputs: dict[Path, str], check: bool) -> int:
    drift: list[str] = []
    for path, expected in outputs.items():
        if check:
            actual = path.read_text(encoding="utf-8") if path.exists() else None
            if actual != expected:
                drift.append(str(path.relative_to(ROOT)))
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(expected, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")

    if drift:
        print("Generated GEO content is stale:", file=sys.stderr)
        for path in drift:
            print(f"- {path}", file=sys.stderr)
        return 1
    if check:
        print(f"GEO content is current ({len(outputs)} generated files).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if outputs differ")
    args = parser.parse_args()
    content = json.loads(CONTENT_PATH.read_text(encoding="utf-8"))
    return write_or_check(build_outputs(content), args.check)


if __name__ == "__main__":
    raise SystemExit(main())
