import gzip
import pathlib
import shutil
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
LEGACY_HOST = "001." + "100app.dev"


class DirectServerReleaseTests(unittest.TestCase):
    def test_release_is_allowlisted_and_runnable(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            release = pathlib.Path(temp_dir) / "release"
            result = subprocess.run(
                ["bash", "ops/web/build-release.sh", str(release), "HEAD"],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertIn("release_commit=", result.stdout)
            self.assertIn("compressed_files=", result.stdout)
            self.assertTrue((release / "static/index.html").is_file())
            self.assertTrue((release / "static/en/index.html").is_file())
            self.assertTrue((release / "static/sitemap.xml").is_file())
            self.assertFalse((release / "static/data.js").exists())
            self.assertFalse((release / "static/dealers/results.json").exists())
            self.assertFalse((release / "static/sitemap-products.xml").exists())
            self.assertTrue((release / "api/product.mjs").is_file())
            self.assertTrue((release / "api/catalog.mjs").is_file())
            self.assertTrue((release / "api/seo-index.mjs").is_file())
            self.assertTrue((release / "seo-index-policy.json").is_file())
            self.assertTrue((release / "ops/web/product-server.mjs").is_file())
            self.assertFalse((release / "static/.agent").exists())
            self.assertFalse((release / "static/tests").exists())
            self.assertFalse((release / "static/supabase").exists())
            self.assertFalse(any((release / "static").rglob("*.py")))
            self.assertFalse(any((release / "static").rglob("*.sql")))
            self.assertEqual(
                (release / "REVISION").read_text(encoding="utf-8").strip(),
                subprocess.check_output(
                    ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
                ).strip(),
            )

            compressed_paths = sorted((release / "static").rglob("*.gz"))
            self.assertTrue(compressed_paths)
            self.assertTrue((release / "static/index.html.gz").is_file())
            self.assertTrue((release / "static/product-detail.html.gz").is_file())
            for compressed in compressed_paths:
                source = compressed.with_suffix("")
                self.assertTrue(source.is_file(), compressed)
                encoded = compressed.read_bytes()
                self.assertEqual(encoded[4:8], b"\x00\x00\x00\x00", compressed)
                self.assertEqual(
                    gzip.decompress(encoded), source.read_bytes(), compressed
                )

            second_release = pathlib.Path(temp_dir) / "release-second"
            subprocess.run(
                ["bash", "ops/web/build-release.sh", str(second_release), "HEAD"],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            second_compressed = sorted(
                path.relative_to(second_release)
                for path in (second_release / "static").rglob("*.gz")
            )
            self.assertEqual(
                [path.relative_to(release) for path in compressed_paths],
                second_compressed,
            )
            for relative_path in second_compressed:
                self.assertEqual(
                    (release / relative_path).read_bytes(),
                    (second_release / relative_path).read_bytes(),
                    relative_path,
                )

    def test_operational_templates_keep_scopes_separate(self):
        common = (ROOT / "ops/web/nginx/geardrop-common.conf").read_text()
        primary = (
            ROOT / "ops/web/nginx/geardrop.100app.dev-tls.conf"
        ).read_text()
        legacy_http = (
            ROOT / f"ops/web/nginx/{LEGACY_HOST}-http.conf"
        ).read_text()
        legacy_tls = (
            ROOT / f"ops/web/nginx/{LEGACY_HOST}-tls.conf"
        ).read_text()
        product_unit = (ROOT / "ops/web/systemd/geardrop-product.service").read_text()
        deploy_unit = (ROOT / "ops/web/systemd/geardrop-deploy.service").read_text()
        deploy_script = (ROOT / "ops/web/deploy-server.sh").read_text()
        self.assertIn("root /srv/geardrop/current/static;", common)
        self.assertIn("gzip_static on;", common)
        self.assertIn("gzip_vary on;", common)
        self.assertNotIn("gzip_static always;", common)
        self.assertIn(
            'Cache-Control "public, max-age=0, must-revalidate"', common
        )
        self.assertIn("location = /p", common)
        self.assertIn("location = /api/catalog", common)
        self.assertIn("location = /data-status.json", common)
        self.assertIn("/srv/geardrop/data/current/public", common)
        self.assertIn("data-manifest\\.json", common)
        self.assertIn("sitemap-(?:products|deals|insights)", common)
        self.assertIn("categories/(?:pants|footwear|fleece|jackets|insulated-jackets)", common)
        self.assertEqual(common.count("proxy_hide_header X-Content-Type-Options;"), 2)
        self.assertIn("proxy_pass http://127.0.0.1:4181;", common)
        self.assertIn('Strict-Transport-Security "max-age=86400"', common)
        self.assertIn("Content-Security-Policy-Report-Only", common)
        self.assertNotIn("includeSubDomains", common)
        self.assertNotIn("preload", common)
        self.assertIn("DynamicUser=yes", product_unit)
        self.assertNotIn("WorkingDirectory=", product_unit)
        self.assertIn("GEARDROP_PRODUCT_PORT=4181", product_unit)
        self.assertIn("User=ec2-user", deploy_unit)
        self.assertIn(
            "PRIMARY_ORIGIN=${GEARDROP_PRIMARY_ORIGIN:-https://geardrop.100app.dev}",
            deploy_script,
        )
        self.assertIn("encodeURIComponent(value.rows[0].sku_id)", deploy_script)
        self.assertNotIn("static/sitemap-products.xml", deploy_script)
        self.assertNotIn(LEGACY_HOST.replace(".", r"\."), deploy_script)
        self.assertIn("server_name geardrop.100app.dev;", primary)
        self.assertIn(
            "ssl_certificate /etc/letsencrypt/live/geardrop.100app.dev/fullchain.pem;",
            primary,
        )
        self.assertIn("include /etc/nginx/snippets/geardrop-common.conf;", primary)
        self.assertIn(
            "return 308 https://geardrop.100app.dev$request_uri;", primary
        )
        self.assertNotIn("https://$host$request_uri", primary)
        self.assertNotIn(f"server_name {LEGACY_HOST};", primary)
        for legacy in (legacy_http, legacy_tls):
            self.assertIn(f"server_name {LEGACY_HOST};", legacy)
            self.assertIn(
                "return 308 https://geardrop.100app.dev$request_uri;", legacy
            )
            self.assertNotIn(
                "include /etc/nginx/snippets/geardrop-common.conf;", legacy
            )
        self.assertIn("/.well-known/acme-challenge/", legacy_http)
        self.assertIn("/.well-known/acme-challenge/", legacy_tls)
        self.assertNotIn(
            "/home/ec2-user/arcteryx",
            common
            + primary
            + legacy_http
            + legacy_tls
            + product_unit
            + deploy_unit
            + deploy_script,
        )


if __name__ == "__main__":
    unittest.main()
