import importlib
import ssl
import unittest
from datetime import datetime, timezone
from unittest.mock import patch


alerts = importlib.import_module("check_price_alerts")


def pending_alert(**overrides):
    value = {
        "id": "alert/one",
        "sku_id": "sku-1",
        "email": "buyer@example.com",
        "currency": "USD",
        "product_name": "Alpha Jacket",
        "product_url": "https://shop.example/product",
        "image_url": "https://img.example/product.jpg",
        "target_price": 90,
        "last_price_seen": 110,
        "unsubscribe_token": "token/value",
    }
    value.update(overrides)
    return value


def matching_product(**overrides):
    value = {
        "sku_id": "sku-1",
        "sale_price": 80,
        "url": "https://shop.example/latest",
        "image_url": "https://img.example/latest.jpg",
    }
    value.update(overrides)
    return value


class PriceAlertDeliveryTests(unittest.TestCase):
    def test_success_marks_the_alert_only_after_delivery(self):
        calls = []
        patches = []
        fixed_now = datetime(2026, 9, 7, 7, 30, tzinfo=timezone.utc)

        summary = alerts.process_alerts(
            [pending_alert()],
            [matching_product()],
            sender=lambda to, subject, body: calls.append((to, subject, body)) or True,
            patcher=lambda path, body: patches.append((path, body)),
            now=lambda: fixed_now,
        )

        self.assertEqual(summary, {"sent": 1, "failed": 0, "skipped": 0, "missing_sku": 0})
        self.assertEqual(len(calls), 1)
        self.assertEqual(
            patches,
            [("/rest/v1/price_alerts?id=eq.alert%2Fone", {"notified_at": fixed_now.isoformat()})],
        )

    def test_failed_or_dry_run_delivery_stays_pending(self):
        patches = []
        with patch.object(alerts, "RESEND_API_KEY", ""), patch.object(
            alerts.urllib.request, "urlopen"
        ) as urlopen:
            summary = alerts.process_alerts(
                [pending_alert()],
                [matching_product()],
                sender=alerts.send_email_resend,
                patcher=lambda path, body: patches.append((path, body)),
            )

        self.assertEqual(summary, {"sent": 0, "failed": 1, "skipped": 0, "missing_sku": 0})
        self.assertEqual(patches, [])
        urlopen.assert_not_called()

    def test_patch_failure_does_not_claim_success(self):
        def fail_patch(_path, _body):
            raise OSError("database unavailable")

        summary = alerts.process_alerts(
            [pending_alert()],
            [matching_product()],
            sender=lambda *_: True,
            patcher=fail_patch,
        )

        self.assertEqual(summary, {"sent": 0, "failed": 1, "skipped": 0, "missing_sku": 0})

    def test_main_returns_failure_when_a_triggered_delivery_fails(self):
        responses = iter([[pending_alert()], [matching_product()]])
        with patch.object(alerts, "SUPABASE_KEY", "offline-test"):
            status = alerts.main(
                getter=lambda _path: next(responses),
                sender=lambda *_: False,
                patcher=lambda *_: self.fail("dry-run must not PATCH"),
            )
        self.assertEqual(status, 1)

    def test_import_is_safe_without_credentials_and_main_guards_network(self):
        with patch.object(alerts, "SUPABASE_KEY", ""):
            status = alerts.main(getter=lambda _path: self.fail("guard must run before HTTP"))
        self.assertEqual(status, 2)

    def test_email_escapes_content_rejects_non_https_urls_and_describes_one_record(self):
        subject, body = alerts.render_email(
            pending_alert(
                product_name='<Alpha & "Beta">',
                product_url='javascript:alert("x")',
                image_url='http://img.example/unsafe.jpg',
                unsubscribe_token='token&next=<script>',
            ),
            80,
        )

        self.assertIn('<Alpha & "Beta">', subject)
        self.assertIn("&lt;Alpha &amp; &quot;Beta&quot;&gt;", body)
        self.assertNotIn("javascript:", body)
        self.assertNotIn("http://img.example", body)
        self.assertIn('href="https://geardrop.100app.dev"', body)
        self.assertIn("token%26next%3D%3Cscript%3E", body)
        self.assertIn("这是本条提醒的一次发送", body)
        self.assertIn("删除本条提醒记录", body)
        self.assertNotIn("已自动取消订阅", body)
        self.assertNotIn("退订所有提醒", body)

    def test_default_tls_context_verifies_certificates_and_hostnames(self):
        self.assertTrue(alerts._CTX.check_hostname)
        self.assertEqual(alerts._CTX.verify_mode, ssl.CERT_REQUIRED)


if __name__ == "__main__":
    unittest.main()
