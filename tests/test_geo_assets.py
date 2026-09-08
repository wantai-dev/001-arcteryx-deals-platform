import importlib.util
import datetime as dt
import http.client
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EVALUATED_AT = dt.datetime(2026, 9, 7, 12, tzinfo=dt.timezone.utc)


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def indexable_row(
    sku: str,
    brand: str = "arcteryx",
    dealer: str = "evo",
    region: str = "us",
    category: str = "裤装",
) -> dict[str, object]:
    return {
        "sku_id": sku,
        "brand": brand,
        "dealer": dealer,
        "region": region,
        "category": category,
        "full_name": f"{brand} {sku}",
        "original_price": 200,
        "sale_price": 100,
        "discount_pct": 50,
        "currency": "USD",
        "symbol": "$",
        "image_url": f"//images.example.com/{sku}.jpg",
        "url": f"https://retailer.example.com/{sku}",
        "url_http_status": 200,
        "status": "active",
        "last_updated": "2026-09-07T08:00:00+00:00",
        "last_seen_at": "2026-09-07T08:00:00+00:00",
        "sizes": ["M"],
        "size_stock": {"M": "in_stock"},
    }


class GeoAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.detail = (ROOT / "product-detail.html").read_text(encoding="utf-8")
        cls.llms = (ROOT / "llms.txt").read_text(encoding="utf-8")
        cls.audit_dir = ROOT / "geo" / "audits" / "2026-08-14-baseline"
        cls.catalog_module = load_module(
            "generate_geo_catalog", ROOT / "tools" / "generate_geo_catalog.py"
        )
        cls.content_module = load_module(
            "build_geo_content", ROOT / "tools" / "build_geo_content.py"
        )
        cls.readiness_module = load_module(
            "check_geo_readiness", ROOT / "tools" / "check_geo_readiness.py"
        )
        cls.indexnow_module = load_module(
            "notify_indexnow", ROOT / "tools" / "notify_indexnow.py"
        )

    def test_generated_knowledge_pages_match_the_source(self):
        content = self.content_module.load_content()
        outputs = self.content_module.build_outputs(content)
        self.assertGreaterEqual(len(outputs), 20)
        for path, expected in outputs.items():
            self.assertTrue(path.exists(), path)
            self.assertEqual(path.read_text(encoding="utf-8"), expected, path)

    def test_intent_pages_are_bilingual_indexable_and_discoverable(self):
        pairs = (
            (
                "guides/outdoor-deal-aggregators.html",
                "en/guides/outdoor-deal-aggregators.html",
            ),
            (
                "guides/retailer-price-history.html",
                "en/guides/retailer-price-history.html",
            ),
            (
                "guides/compare-outdoor-gear-prices-across-countries.html",
                "en/guides/compare-outdoor-gear-prices-across-countries.html",
            ),
            (
                "guides/patagonia-sale-alerts.html",
                "en/guides/patagonia-sale-alerts.html",
            ),
        )
        base_url = "https://geardrop.100app.dev"
        sitemap = (ROOT / "sitemap-static.xml").read_text(encoding="utf-8")
        llms = (ROOT / "llms.txt").read_text(encoding="utf-8")
        llms_full = (ROOT / "llms-full.txt").read_text(encoding="utf-8")

        for zh_path, en_path in pairs:
            zh_url = f"{base_url}/{zh_path}"
            en_url = f"{base_url}/{en_path}"
            for page_path, canonical in ((zh_path, zh_url), (en_path, en_url)):
                source = (ROOT / page_path).read_text(encoding="utf-8")
                self.assertIn('<meta name="robots" content="index,follow', source)
                self.assertIn(f'<link rel="canonical" href="{canonical}">', source)
                self.assertIn(f'hreflang="zh-CN" href="{zh_url}"', source)
                self.assertIn(f'hreflang="en-US" href="{en_url}"', source)
                self.assertIn(f'hreflang="x-default" href="{zh_url}"', source)
                match = re.search(
                    r'<script type="application/ld\+json">\s*(.*?)\s*</script>',
                    source,
                    re.DOTALL,
                )
                self.assertIsNotNone(match, page_path)
                graph = json.loads(match.group(1))["@graph"]
                types = {item["@type"] for item in graph}
                self.assertTrue({"Article", "BreadcrumbList"} <= types, page_path)
                article = next(item for item in graph if item["@type"] == "Article")
                self.assertEqual(len(article["mainEntity"]), 3, page_path)

            self.assertIn(zh_url, sitemap)
            self.assertIn(en_url, sitemap)
            self.assertIn(zh_url, llms)
            self.assertIn(en_url, llms)
            self.assertIn(zh_url, llms_full)
            self.assertIn(en_url, llms_full)

        about = (ROOT / "about.html").read_text(encoding="utf-8")
        for zh_path, _ in pairs:
            self.assertIn(f'href="/{zh_path}"', about)

    def test_local_geo_readiness_contract_passes(self):
        rows = [
            indexable_row("a-1", category="裤装"),
            indexable_row("a-2", dealer="mec", region="ca", category="鞋类"),
            indexable_row("b-1", brand="burton", category="抓绒/摇粒绒"),
            indexable_row("b-2", brand="burton", category="夹克/外套"),
            indexable_row("p-1", brand="patagonia", category="保暖夹克"),
        ]
        with tempfile.TemporaryDirectory() as directory:
            dynamic_root = Path(directory)
            for path, value in self.catalog_module.build_outputs(
                rows, output_root=dynamic_root, evaluated_at=EVALUATED_AT
            ).items():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(value, encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "tools" / "check_geo_readiness.py"),
                    "--dynamic-root",
                    str(dynamic_root),
                    "--min-products",
                    "3",
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        report = json.loads(result.stdout)
        self.assertEqual(report["summary"]["failed"], 0)
        self.assertGreaterEqual(report["summary"]["passed"], 130)
        self.assertEqual(report["observed_ai_visibility"], "not_measured")

    def test_catalog_snapshots_are_not_part_of_the_code_release(self):
        manifest = (ROOT / "ops" / "web" / "public-files.txt").read_text()
        ignored = (ROOT / ".gitignore").read_text()
        for path in (
            "data.js",
            "global_data.json",
            "dealers/results.json",
            "sitemap-products.xml",
            "sitemap-deals.xml",
            "catalog-status.json",
        ):
            with self.subTest(path=path):
                self.assertNotIn(f"\n{path}\n", f"\n{manifest}")
        self.assertIn("global_data.json", ignored)

    def test_catalog_generator_encodes_sku_and_deduplicates_latest_row(self):
        rows = [
            {
                "sku_id": "evo:products/foo/bar",
                "brand": "arcteryx",
                "dealer": "evo",
                "region": "us",
                "status": "active",
                "last_updated": "2026-08-13T10:00:00+00:00",
            },
            {
                "sku_id": "evo:products/foo/bar",
                "brand": "arcteryx",
                "dealer": "evo",
                "region": "ca",
                "status": "active",
                "last_updated": "2026-08-13T11:00:00+00:00",
            },
            {"sku_id": "inactive", "status": "inactive"},
            {
                "sku_id": "ssense:retired",
                "brand": "arcteryx",
                "dealer": "ssense",
                "region": "us",
                "status": "active",
                "last_updated": "2026-08-13T12:00:00+00:00",
            },
        ]
        normalized = self.catalog_module.normalize_rows(rows)
        self.assertEqual(len(normalized), 1)
        self.assertEqual(normalized[0]["region"], "ca")
        url = self.catalog_module.product_url(normalized[0]["sku_id"])
        self.assertIn("evo%3Aproducts%2Ffoo%2Fbar", url)
        sitemap = self.catalog_module.render_product_sitemap(normalized)
        root = ET.fromstring(sitemap)
        namespace = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        self.assertEqual(root.find("sm:url/sm:loc", namespace).text, url)

    def test_index_policy_reports_reasons_and_normalizes_protocol_relative_images(self):
        row = indexable_row("policy-ok")
        self.assertEqual(
            self.catalog_module.assess_product_indexability(row, EVALUATED_AT), []
        )
        self.assertEqual(
            self.catalog_module.normalize_external_url(row["image_url"]),
            "https://images.example.com/policy-ok.jpg",
        )
        rejected = {
            **row,
            "discount_pct": 20,
            "original_price": 100,
            "sale_price": 80,
            "url_http_status": 503,
            "last_updated": "2026-08-01T00:00:00+00:00",
            "last_seen_at": "2026-08-01T00:00:00+00:00",
            "size_stock": {"M": "out_of_stock"},
        }
        self.assertEqual(
            self.catalog_module.assess_product_indexability(rejected, EVALUATED_AT),
            [
                "source_unverified",
                "discount_below_threshold",
                "out_of_stock",
                "stale_observation",
            ],
        )
        conflicting = {
            **row,
            "original_price": 100,
            "sale_price": 90,
            "discount_pct": 80,
        }
        self.assertIn(
            "discount_below_threshold",
            self.catalog_module.assess_product_indexability(conflicting, EVALUATED_AT),
        )
        self.assertIn(
            "inactive",
            self.catalog_module.assess_product_indexability(
                {**row, "status": None}, EVALUATED_AT
            ),
        )

    def test_deal_hubs_are_server_readable_and_paginated_with_stable_urls(self):
        rows = [indexable_row(f"pants-{number:03d}") for number in range(61)]
        outputs = self.catalog_module.build_outputs(rows, evaluated_at=EVALUATED_AT)
        first = outputs[ROOT / "brands" / "arcteryx.html"]
        second = outputs[ROOT / "brands" / "arcteryx" / "page" / "2.html"]
        sitemap = outputs[ROOT / "sitemap-deals.xml"]
        self.assertIn('<meta name="robots" content="index,follow', first)
        self.assertIn('rel="next" href="https://geardrop.100app.dev/brands/arcteryx/page/2.html"', first)
        self.assertIn('rel="prev" href="https://geardrop.100app.dev/brands/arcteryx.html"', second)
        self.assertEqual(first.count('<article class="deal-card">'), 60)
        self.assertEqual(second.count('<article class="deal-card">'), 1)
        self.assertIn('https://geardrop.100app.dev/brands/arcteryx/page/2.html', sitemap)
        self.assertIn('"@type": "ItemList"', first)
        self.assertIn('href="/guides/outdoor-deal-aggregators.html"', first)
        self.assertIn('href="/guides/retailer-price-history.html"', first)
        self.assertNotIn('href="/guides/retailer-price-history.html"', second)

    def test_patagonia_hubs_prioritize_the_matching_alert_guide(self):
        hub = next(
            item
            for item in self.catalog_module.hub_definitions()
            if item["kind"] == "brand" and item["value"] == "patagonia"
        )
        zh = self.catalog_module.render_deal_hub(
            hub, [indexable_row("p-1", brand="patagonia")], 1, "zh-CN"
        )
        en = self.catalog_module.render_deal_hub(
            hub, [indexable_row("p-1", brand="patagonia")], 1, "en-US"
        )
        zh_guides = zh.split("<h2>问题指南</h2>", 1)[1]
        en_guides = en.split("<h2>Answer guides</h2>", 1)[1]
        self.assertLess(
            zh_guides.index('/guides/patagonia-sale-alerts.html'),
            zh_guides.index('/guides/outdoor-deal-aggregators.html'),
        )
        self.assertLess(
            en_guides.index('/en/guides/patagonia-sale-alerts.html'),
            en_guides.index('/en/guides/outdoor-deal-aggregators.html'),
        )

    def test_deal_hubs_collapse_regional_duplicates_and_report_offer_coverage(self):
        us = indexable_row("same-us", region="us")
        ca = indexable_row("same-ca", region="ca")
        us["full_name"] = ca["full_name"] = "Arc'teryx Shared Jacket"
        hub = self.catalog_module.hub_definitions()[0]
        rows = self.catalog_module.hub_rows([us, ca], hub)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["_market_count"], 2)
        self.assertEqual(rows[0]["_offer_count"], 2)
        source = self.catalog_module.render_deal_hub(hub, rows, 1, "zh-CN")
        self.assertEqual(source.count('<article class="deal-card">'), 1)
        self.assertIn("覆盖 2 个地区 · 2 条报价", source)

    def test_catalog_generator_builds_reproducible_localized_data_pages(self):
        rows = [
            indexable_row("a-1"),
            indexable_row("a-2", dealer="mec", region="ca"),
            indexable_row("b-1", brand="burton"),
        ]
        outputs = self.catalog_module.build_outputs(rows, evaluated_at=EVALUATED_AT)
        summary = json.loads(outputs[ROOT / "catalog-status.json"])
        self.assertEqual(summary["schema_version"], "1.2.0")
        self.assertEqual(summary["indexed_product_urls"], 3)
        self.assertEqual(
            summary["deal_sitemap_url"],
            "https://geardrop.100app.dev/sitemap-deals.xml",
        )
        self.assertEqual(sum(item["total"] for item in summary["brand_platform_matrix"]), 3)
        self.assertEqual(sum(item["total"] for item in summary["region_brand_matrix"]), 3)
        expected = {
            ROOT / "sitemap-insights.xml",
            ROOT / "insights" / "catalog-coverage.html",
            ROOT / "insights" / "brand-source-matrix.html",
            ROOT / "insights" / "regional-coverage.html",
            ROOT / "en" / "catalog-status.html",
            ROOT / "en" / "insights" / "catalog-coverage.html",
            ROOT / "en" / "insights" / "brand-source-matrix.html",
            ROOT / "en" / "insights" / "regional-coverage.html",
        }
        self.assertTrue(expected <= set(outputs))
        for path in expected - {ROOT / "sitemap-insights.xml"}:
            source = outputs[path]
            self.assertIn("catalog-status.json", source)
            self.assertIn("hreflang=\"zh-CN\"", source)
            self.assertIn("hreflang=\"en-US\"", source)

    def test_catalog_fetch_retries_incomplete_chunked_responses(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def read(self):
                return b'[{"sku_id":"retry-ok"}]'

        responses = [http.client.IncompleteRead(b"partial", 12), Response()]
        with (
            mock.patch.object(
                self.catalog_module.urllib.request,
                "urlopen",
                side_effect=responses,
            ) as urlopen,
            mock.patch.object(self.catalog_module.time, "sleep") as sleep,
        ):
            payload = self.catalog_module.fetch_json(
                "https://example.invalid/catalog", {"apikey": "public"}
            )

        self.assertEqual(payload, [{"sku_id": "retry-ok"}])
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_deployed_readiness_reader_retries_incomplete_responses(self):
        class Response:
            def __init__(self, payload, status=None):
                self.payload = payload
                self.status = status

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def read(self):
                if isinstance(self.payload, Exception):
                    raise self.payload
                return self.payload

        responses = [
            Response(http.client.IncompleteRead(b"partial", 4)),
            Response(b"retry-ok"),
        ]
        with (
            mock.patch.object(
                self.readiness_module.urllib.request,
                "urlopen",
                side_effect=responses,
            ) as urlopen,
            mock.patch.object(self.readiness_module.time, "sleep") as sleep,
        ):
            read = self.readiness_module.url_reader("https://example.invalid")
            payload = read("/about.html")

        self.assertEqual(payload, "retry-ok")
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_deployed_readiness_reader_resumes_large_incomplete_response(self):
        class Response:
            def __init__(self, payload, status):
                self.payload = payload
                self.status = status

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def read(self):
                if isinstance(self.payload, Exception):
                    raise self.payload
                return self.payload

        responses = [
            Response(http.client.IncompleteRead(b"first-", 6), http.client.OK),
            Response(b"second", http.client.PARTIAL_CONTENT),
        ]
        with (
            mock.patch.object(
                self.readiness_module.urllib.request,
                "urlopen",
                side_effect=responses,
            ) as urlopen,
            mock.patch.object(self.readiness_module.time, "sleep") as sleep,
        ):
            read = self.readiness_module.url_reader("https://example.invalid")
            payload = read("/sitemap-products.xml")

        self.assertEqual(payload, "first-second")
        self.assertEqual(urlopen.call_count, 2)
        resumed_request = urlopen.call_args_list[1].args[0]
        self.assertEqual(resumed_request.get_header("Range"), "bytes=6-")
        sleep.assert_called_once_with(1)

        self.assertEqual(read("/sitemap-products.xml"), "first-second")
        self.assertEqual(urlopen.call_count, 2)

    def test_homepage_exposes_answer_ready_content_and_stable_product_urls(self):
        self.assertIn('<h1 id="catalog-heading">', self.index)
        self.assertRegex(
            self.index,
            r'<meta name="google-site-verification" content="[A-Za-z0-9_-]+">',
        )
        self.assertRegex(
            self.index,
            r'<meta name="msvalidate\.01" content="[A-F0-9]{32}">',
        )
        for path in (
            "/about.html",
            "/methodology.html",
            "/faq.html",
            "/guides/outdoor-deal-guide.html",
            "/guides/outdoor-deal-aggregators.html",
            "/guides/retailer-price-history.html",
            "/guides/compare-outdoor-gear-prices-across-countries.html",
            "/guides/patagonia-sale-alerts.html",
            "/brands/arcteryx.html",
            "/brands/burton.html",
            "/brands/patagonia.html",
            "/catalog-status.html",
            "/insights/catalog-coverage.html",
            "/insights/brand-source-matrix.html",
            "/insights/regional-coverage.html",
            "/en/",
        ):
            self.assertIn(f'href="{path}"', self.index)
        app_store_url = "https://apps.apple.com/us/app/geardrop-outdoor-deals/id6790165332"
        self.assertIn(f'href="{app_store_url}"', self.index)
        self.assertIn('"@type": "SoftwareApplication"', self.index)
        self.assertIn('"sameAs"', self.index)
        self.assertIn("? `product-detail.html?sku=${encodeURIComponent(p.sku_id)}`", self.index)
        self.assertNotIn("const skuParam = p.sku_id", self.index)

    def test_product_metadata_is_live_derived_and_truth_bounded(self):
        required = (
            'id="product-meta-description"',
            'id="product-canonical"',
            'id="product-jsonld"',
            "function updateProductMetadata(p)",
            "const productAvailability = (p)",
            "'@type': 'Product'",
            "'@type': 'Offer'",
            "function updateNotFoundMetadata()",
            "'noindex,follow'",
            "const PRODUCT_PAGE_BASE = 'https://geardrop.100app.dev/p';",
            "setMetaContent('product-meta-robots', 'noindex,follow');",
        )
        for token in required:
            self.assertIn(token, self.detail)
        self.assertNotIn("aggregateRating", self.detail)
        self.assertNotIn("reviewCount", self.detail)
        self.assertIn("最终价格、库存、配送和退货条件以销售平台为准", self.detail)

    def test_llms_file_is_discovery_aid_not_visibility_claim(self):
        self.assertIn("Canonical entity: https://geardrop.100app.dev/", self.llms)
        self.assertIn("GearDrop is not a retailer", self.llms)
        self.assertIn("GearDrop is not an official site", self.llms)
        self.assertIn("does not prove AI mention, citation, or recommendation", self.llms)
        self.assertIn("https://geardrop.100app.dev/methodology.html", self.llms)

    def test_continuous_workflows_refresh_and_audit_geo_assets(self):
        monitor = (ROOT / ".github" / "workflows" / "geo-readiness.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("schedule:", monitor)
        self.assertIn("permissions:\n  contents: read", monitor)
        self.assertIn("build_geo_content.py --check", monitor)
        self.assertIn("generate_geo_catalog.py --online --output-dir", monitor)
        self.assertIn("--dynamic-root", monitor)
        self.assertIn("check_geo_readiness.py --base-url", monitor)
        self.assertIn("Observed AI visibility remains not_measured", monitor)

        visibility_monitor = (
            ROOT / ".github" / "workflows" / "geo-visibility-baseline.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("schedule:", visibility_monitor)
        self.assertIn("permissions:\n  contents: read", visibility_monitor)
        self.assertIn("python tools/check_geo_visibility_baseline.py", visibility_monitor)
        self.assertIn("github.event_name == 'workflow_dispatch'", visibility_monitor)
        self.assertIn("inputs.run_paid_api_probe", visibility_monitor)
        self.assertNotIn(
            "run: python tools/probe_gemini_grounding.py",
            visibility_monitor.split("official-api-probe:", 1)[0],
        )

        for name in ("refresh-outlet.yml", "refresh-dealers.yml", "refresh-mec.yml"):
            workflow = (ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8")
            self.assertIn("permissions:\n  contents: read", workflow, name)
            self.assertIn("tools/wait_for_data_release.py", workflow, name)
            self.assertIn("tools/hydrate_runtime_snapshot.py", workflow, name)
            self.assertNotIn("tools/generate_geo_catalog.py", workflow, name)
            self.assertNotIn("git push origin main", workflow, name)
            self.assertIn("notify_indexnow.py --sitemap-url", workflow, name)
            self.assertIn("--since-days 2", workflow, name)

        server_runner = (ROOT / "server_run_update.sh").read_text(encoding="utf-8")
        self.assertNotIn("tools/generate_geo_catalog.py", server_runner)
        self.assertNotIn("git push origin main", server_runner)
        self.assertIn("tools/wait_for_data_release.py", server_runner)
        self.assertIn("notify_indexnow.py --sitemap-url", server_runner)
        self.assertIn("--since-days 2", server_runner)

    def test_indexnow_contract_is_credential_free_and_selects_recent_urls(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "notify_indexnow.py"), "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        report = json.loads(result.stdout)
        self.assertTrue(report["valid"])
        self.assertTrue(report["key_file_present"])
        self.assertTrue(report["key_file_valid"])
        self.assertFalse(report["credentials_logged"])
        self.assertEqual(
            report["key_location"], "https://geardrop.100app.dev/indexnow-key.txt"
        )
        self.assertEqual(
            report["credentials_required"], ["INDEXNOW_KEY", "INDEXNOW_KEY_LOCATION"]
        )

    def test_indexnow_accepts_only_primary_origin_remote_sitemaps(self):
        payload = b'''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://geardrop.100app.dev/p?sku=one</loc><lastmod>2026-08-31</lastmod></url>
</urlset>'''

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def read(self, _limit):
                return payload

        with mock.patch.object(
            self.indexnow_module.urllib.request, "urlopen", return_value=Response()
        ):
            rows = self.indexnow_module.read_sitemap(
                "https://geardrop.100app.dev/sitemap-products.xml"
            )
        self.assertEqual(rows[0][0], "https://geardrop.100app.dev/p?sku=one")
        with self.assertRaises(ValueError):
            self.indexnow_module.read_sitemap(
                "https://attacker.invalid/sitemap-products.xml"
            )

        key_file = ROOT / "indexnow-key.txt"
        configured_key = key_file.read_text(encoding="utf-8").strip()
        self.assertRegex(configured_key, r"^[a-f0-9]{64}$")
        self.indexnow_module.validate_key_file(
            configured_key,
            "https://geardrop.100app.dev/indexnow-key.txt",
            key_file,
        )
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.indexnow_module.validate_key_file(
                "0" * 64,
                "https://geardrop.100app.dev/indexnow-key.txt",
                key_file,
            )

        key, location = self.indexnow_module.read_credentials_from_stdin(
            io.StringIO(
                f"{configured_key}\nhttps://geardrop.100app.dev/indexnow-key.txt\n"
            )
        )
        self.assertEqual(key, configured_key)
        self.assertEqual(location, "https://geardrop.100app.dev/indexnow-key.txt")
        with self.assertRaises(ValueError):
            self.indexnow_module.read_credentials_from_stdin(io.StringIO("\n"))

        http_error = self.indexnow_module.urllib.error.HTTPError(
            "https://api.indexnow.org/indexnow",
            422,
            "Unprocessable Entity",
            {},
            None,
        )
        safe_error = self.indexnow_module.safe_submission_error(http_error, 2)
        self.assertEqual(
            safe_error,
            {
                "status": "submission_failed",
                "url_count": 2,
                "error_type": "HTTPError",
                "http_status": 422,
            },
        )

        sitemap = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://geardrop.100app.dev/recent</loc><lastmod>2026-08-28</lastmod></url>
  <url><loc>https://geardrop.100app.dev/old</loc><lastmod>2026-08-20</lastmod></url>
</urlset>
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sitemap.xml"
            path.write_text(sitemap, encoding="utf-8")
            urls = self.indexnow_module.collect_recent_urls(
                [path], since_days=2, today=dt.date(2026, 8, 28)
            )
        self.assertIn("https://geardrop.100app.dev/", urls)
        self.assertIn("https://geardrop.100app.dev/recent", urls)
        self.assertNotIn("https://geardrop.100app.dev/old", urls)

    def test_internal_audit_data_is_not_deployed(self):
        vercelignore = (ROOT / ".vercelignore").read_text(encoding="utf-8")
        self.assertIn("/geo/", vercelignore)
        self.assertIn(".github/", vercelignore)
        self.assertIn("/tests/", vercelignore)
        self.assertIn("tools/", vercelignore)
        self.assertIn(".agent/", vercelignore)
        self.assertIn("/*.py", vercelignore)
        self.assertIn("/*.sh", vercelignore)
        self.assertIn("/*.sql", vercelignore)
        self.assertIn("/.crawl_manifest.json", vercelignore)

    def test_gemini_visibility_baseline_contract(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "check_geo_visibility_baseline.py")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        report = json.loads(result.stdout)
        self.assertTrue(report["valid"])
        self.assertEqual(report["planned_runs"], 72)
        self.assertEqual(report["retained_runs"], 72)
        self.assertEqual(report["valid_runs"], 52)
        self.assertEqual(report["blocked_runs"], 20)
        self.assertEqual(report["unaided_mentions"], "0/41")

    def test_gemini_api_probe_check_is_credential_free(self):
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "tools" / "probe_gemini_grounding.py"),
                "--check",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        report = json.loads(result.stdout)
        self.assertTrue(report["valid"])
        self.assertEqual(report["tool"], "google_search")
        self.assertNotIn("key", report)

    def test_audit_report_binds_readiness_ux_and_continuous_validation(self):
        report_path = (
            self.audit_dir
            / "artifacts"
            / "geardrop-2026-08-14-seo-geo-report.html"
        )
        report = report_path.read_text(encoding="utf-8")
        audit = json.loads((self.audit_dir / "audit.json").read_text(encoding="utf-8"))
        ux = json.loads(
            (self.audit_dir / "evidence" / "website-experience-audit.json").read_text(
                encoding="utf-8"
            )
        )
        improvement = json.loads(
            (self.audit_dir / "improvement-validation.json").read_text(encoding="utf-8")
        )

        self.assertIn('<nav class="report-nav" aria-label="报告章节">', report)
        self.assertIn(f'SEO {audit["scores"]["seo"]["score"]}', report)
        self.assertIn(f'GEO {audit["scores"]["geo"]["score"]}', report)
        self.assertIn("网站体验不另外打分", report)
        self.assertEqual(
            set(re.findall(r'data-ux-finding="(UX-\d+)"', report)),
            {item["id"] for item in ux["findings"]},
        )
        self.assertEqual(
            set(re.findall(r'data-validation-workstream="(V-\d+)"', report)),
            {item["id"] for item in improvement["workstreams"]},
        )
        self.assertEqual(report.count('class="validation-layer"'), 3)
        self.assertEqual(report.count('class="validation-rule"'), 4)
        self.assertEqual(
            audit["observed_visibility"]["measurement_status"], "not_measured"
        )

        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "tools" / "enrich_geo_report.py"),
                str(report_path),
                "--audit",
                str(self.audit_dir / "audit.json"),
                "--website-experience",
                str(self.audit_dir / "evidence" / "website-experience-audit.json"),
                "--improvement-validation",
                str(self.audit_dir / "improvement-validation.json"),
                "--check",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)


if __name__ == "__main__":
    unittest.main()
