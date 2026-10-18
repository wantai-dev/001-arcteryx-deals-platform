"""Execute the workflow's lease shells locally without credentials or network."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import textwrap
import unittest


ROOT = Path(__file__).resolve().parents[1]


class DealerWorkflowLeaseShellTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (ROOT / '.github/workflows/refresh-dealers.yml').read_text()
        cls.gate_step = cls.workflow.split('      - id: lease\n', 1)[1].split('\n  refresh-dealers:', 1)[0]
        cls.release_step = cls.workflow.split('      - name: Release Dealers lease\n', 1)[1]

    def shell(self, step):
        match = re.search(r'^        run: \|\n((?:          .*\n|\n)+)', step, re.M)
        self.assertIsNotNone(match)
        return textwrap.dedent(match.group(1))

    def run_shell(self, shell, **values):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake = root / 'python'
            fake.write_text(
                '#!' + sys.executable + '\n'
                'import json, os, sys\n'
                'assert sys.argv[1] == "tools/crawler_lease.py"\n'
                'with open(os.environ["CALLS"], "a") as f: f.write(json.dumps(sys.argv[1:]) + "\\n")\n'
                'result = os.environ[sys.argv[2].upper().replace("-", "_")]\n'
                'if result == "error":\n'
                '    print("mock lease error", file=sys.stderr)\n'
                '    sys.exit(23)\n'
                'print(result)\n'
            )
            fake.chmod(0o755)
            output = root / 'output'
            calls = root / 'calls'
            env = dict(PATH=str(root) + os.pathsep + os.defpath,
                       GITHUB_RUN_ID='424242', GITHUB_OUTPUT=str(output),
                       CALLS=str(calls), FORCE_RUN='false',
                       NEEDS_FALLBACK='true', ACQUIRE='true', FINISH='true')
            env.update(values)
            result = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', shell],
                                    cwd=root, env=env, text=True, capture_output=True)
            outputs = dict(line.split('=', 1) for line in output.read_text().splitlines()) if output.exists() else {}
            recorded = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
            return result, outputs, recorded

    def test_gate_claim_and_fallback_matrix(self):
        for force, fallback, claim in [
            ('true', 'error', 'true'), ('true', 'error', 'false'),
            ('true', 'error', 'error'), ('false', 'false', 'error'),
            ('false', 'true', 'true'), ('false', 'true', 'false'),
            ('false', 'true', 'error'), ('false', 'error', 'true'),
        ]:
            with self.subTest(force=force, fallback=fallback, claim=claim):
                result, outputs, calls = self.run_shell(
                    self.shell(self.gate_step), FORCE_RUN=force,
                    NEEDS_FALLBACK=fallback, ACQUIRE=claim)
                expected = []
                if force != 'true':
                    expected.append(['tools/crawler_lease.py', 'needs-fallback', '--scope', 'dealers', '--stale-hours', '4.5'])
                should_claim = force == 'true' or fallback == 'true'
                if should_claim:
                    expected.append(['tools/crawler_lease.py', 'acquire', '--scope', 'dealers', '--owner', 'github-actions-dealers-424242', '--ttl-minutes', '180'])
                self.assertEqual(calls, expected)
                error = (force != 'true' and fallback == 'error') or (should_claim and claim == 'error')
                self.assertEqual(result.returncode, 23 if error else 0, result.stderr)
                if error:
                    self.assertEqual(outputs, {})
                else:
                    owned = 'true' if should_claim and claim == 'true' else 'false'
                    self.assertEqual(outputs, dict(owner='github-actions-dealers-424242', acquired=owned, lease_owned=owned))

    def test_release_status_and_owner_from_gate(self):
        self.assertIn("    if: needs.lease-gate.outputs.acquired == 'true'\n", self.workflow)
        self.assertIn("        if: always() && needs.lease-gate.outputs.lease_owned == 'true'\n", self.release_step)
        self.assertIn('LEASE_OWNER: ${{ needs.lease-gate.outputs.owner }}', self.release_step)
        self.assertIn('JOB_STATUS: ${{ job.status }}', self.release_step)
        # GitHub evaluates this guard; execute the actual shell only when owned.
        for claim in ('true', 'false'):
            _, outputs, _ = self.run_shell(self.shell(self.gate_step), FORCE_RUN='true', ACQUIRE=claim)
            for status in ('success', 'failure', 'cancelled'):
                with self.subTest(claim=claim, status=status):
                    shell = self.shell(self.release_step) if outputs['lease_owned'] == 'true' else ':'
                    result, _, calls = self.run_shell(shell, LEASE_OWNER=outputs['owner'], JOB_STATUS=status)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    expected = [] if claim == 'false' else [[
                        'tools/crawler_lease.py', 'finish', '--scope', 'dealers',
                        '--owner', outputs['owner'], '--status',
                        'success' if status == 'success' else 'failed',
                        '--message', f'GitHub Actions run 424242: {status}']]
                    self.assertEqual(calls, expected)


if __name__ == '__main__':
    unittest.main()
