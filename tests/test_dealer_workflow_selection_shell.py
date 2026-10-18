"""Run the actual refresh shell with local scrapers and real merge/sync modules."""
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
ORDER = ['burton', 'backcountry', 'evo', 'rei']

# Executed by fake python, never imports a scraper or creates a network client.
DISPATCH = r'''
import json, os, sys, types
from pathlib import Path
def record(value):
    with open('calls.jsonl', 'a') as f: f.write(json.dumps(value) + '\n')
args = sys.argv[1:]
record(['python', args])
if args == ['tools/retire_dealer.py', '--dealer', 'ssense']:
    sys.exit(0)
if args and args[0] == 'tools/check_data_quality.py':
    sys.exit(0)
module = args[args.index('-m') + 1]
if module in ['dealers.' + k for k in ('burton', 'backcountry', 'evo', 'rei')]:
    key = module.split('.')[1]
    mode = os.environ['SCRAPE_MODE'] if key == 'burton' else 'success'
    if mode == 'fail': sys.exit(9)
    url = {'burton': 'https://www.burton.com/en-us/products/test',
           'backcountry': 'https://www.backcountry.com/burton-test'}.get(key, 'https://example.invalid/' + key)
    items = [] if mode == 'empty' else [dict(name='Burton Test', brand='burton', url=url,
                 source_id='test', sale_price=80, original_price=100)]
    Path('dealers/_partial/' + key + '.json').write_text(json.dumps(dict(
        name=key, count=len(items), items=items, crawl_complete=True, saved_at='2026-10-19 00:00:00')))
elif module == 'dealers.merge_partial':
    from dealers import merge_partial
    merge_partial.main()
elif module == 'dealers.supabase_sync':
    from dealers import supabase_sync as sync
    class Query:
        def __init__(self, table): self.table, self.ops = table, []
        def __getattr__(self, method):
            def call(*args, **kwargs):
                self.ops.append([method, args, kwargs])
                return self
            return call
        def execute(self):
            record(['db', self.table, self.ops])
            data = []
            if self.ops[0][0] == 'select':
                key = next(op[1][1] for op in self.ops if op[0] == 'eq')
                data = [dict(sku_id=key + ':test', sale_price=90, original_price=100),
                        dict(sku_id=key + ':absent', brand='burton', url='https://example.invalid/absent')]
            return types.SimpleNamespace(data=data)
    fake = types.ModuleType('supabase')
    fake.create_client = lambda *args: types.SimpleNamespace(table=Query)
    sys.modules['supabase'] = fake
    sync.RESULTS_FILE = Path('dealers/results.json')
    sync.SUPABASE_KEY = 'local-mock-only'
    sync.SUPABASE_URL = 'https://example.invalid'
    sync._infer_cat = lambda *args: ''
    sync.main()
else:
    raise AssertionError(args)
'''


class DealerSelectionShellTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (ROOT / '.github/workflows/refresh-dealers.yml').read_text()
        cls.step = cls.workflow.split('      - name: Refresh dealer scrape and sync\n', 1)[1].split('      - name:', 1)[0]
        cls.shell = textwrap.dedent(re.search(r'        run: \|\n(.*)', cls.step, re.S).group(1))

    def execute(self, requested, mode='success'):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'dealers/_partial').mkdir(parents=True)
            old = {key: dict(name=key, count=1, items=[{'url': 'old-' + key}],
                            refreshed_at='2026-01-01 00:00:00') for key in ORDER}
            (root / 'dealers/results.json').write_text(json.dumps({'dealers': old}))
            stale = root / 'dealers/_partial/evo.json'
            stale.write_text(json.dumps(dict(name='EVO', count=1, items=[{'url': 'stale-evo'}],
                                            crawl_complete=True, saved_at='old')))
            for name, body in {
                'python': '#!' + sys.executable + '\n' + DISPATCH,
                'timeout': '#!/bin/bash\nshift\nexec "$@"\n',
                'node': '#!' + sys.executable + '\nimport json,sys\nwith open("calls.jsonl", "a") as f: f.write(json.dumps(["node", sys.argv[1:]]) + "\\n")\n',
            }.items():
                path = root / name
                path.write_text(body)
                path.chmod(0o755)
            env = dict(PATH=str(root) + os.pathsep + os.defpath, PYTHONPATH=str(ROOT),
                       REQUESTED_DEALERS=requested, SCRAPE_MODE=mode, GITHUB_ENV=str(root / 'env'))
            result = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', self.shell],
                                    cwd=root, env=env, capture_output=True, text=True, timeout=30)
            self.assertFalse((root / 'injected').exists())
            calls = [json.loads(line) for line in (root / 'calls.jsonl').read_text().splitlines()] if (root / 'calls.jsonl').exists() else []
            merged = json.loads((root / 'dealers/results.json').read_text())
            partials = {p.name: json.loads(p.read_text()) for p in (root / 'dealers/_partial').glob('*.json')}
            return result, calls, merged, old, partials

    def test_selection_and_canonical_order(self):
        for value, expected in [('', ORDER), ('burton', ['burton']),
                                ('rei,burton,burton', ['burton', 'rei']),
                                ('backcountry,evo', ['backcountry', 'evo'])]:
            with self.subTest(value=value):
                result, calls, _, _, _ = self.execute(value)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                scraped = [c[1][-1].split('.')[1] for c in calls if c[0] == 'python' and c[1][:2] == ['-u', '-m'] and c[1][-1] != 'dealers.supabase_sync']
                self.assertEqual(scraped, expected)

    def test_invalid_input_has_no_commands_or_artifact_writes(self):
        for value in [',burton', 'burton,', 'burton,,evo', 'burton evo', 'Burton', 'unknown',
                      '--help', 'burton\nevo', 'burton\n', ' burton', 'burton ',
                      'burton; touch injected', '$(touch injected)', '`touch injected`', 'burton/../evo']:
            with self.subTest(value=value):
                result, calls, merged, old, partials = self.execute(value)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, [])
                self.assertEqual(merged, {'dealers': old})
                self.assertEqual(partials['evo.json']['items'], [{'url': 'stale-evo'}])

    def test_burton_only_real_merge_sync_isolation_and_failure(self):
        for mode in ['success', 'fail', 'empty']:
            with self.subTest(mode=mode):
                result, calls, merged, old, partials = self.execute('burton', mode)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertNotIn('evo.json', partials)
                for key in ['evo', 'backcountry', 'rei']:
                    self.assertEqual(merged['dealers'][key], old[key])
                self.assertEqual(merged['fresh_dealers'], ['burton'] if mode == 'success' else [])
                self.assertEqual(calls[0], ['python', ['tools/retire_dealer.py', '--dealer', 'ssense']])
                db = [c for c in calls if c[0] == 'db']
                if mode != 'success':
                    self.assertEqual(db, [])
                    self.assertEqual(merged['dealers']['burton'], old['burton'])
                    continue
                self.assertEqual(merged['dealers']['burton']['refreshed_at'], '2026-10-19 00:00:00')
                self.assertEqual([c[2][0][0] for c in db], ['select', 'upsert', 'insert', 'update'])
                for _, table, ops in db:
                    if ops[0][0] == 'select':
                        self.assertIn(['eq', ['dealer', 'burton'], {}], ops)
                    elif ops[0][0] == 'update':
                        self.assertEqual(ops[-1][1], ['sku_id', ['burton:absent']])
                    else:
                        for row in ops[0][1][0]:
                            self.assertTrue(row['sku_id'].startswith('burton:'))
                            if table == 'products': self.assertEqual(row['dealer'], 'burton')
                quality = next(c[1] for c in calls if c[0] == 'python' and c[1][0] == 'tools/check_data_quality.py')
                self.assertEqual([quality[i + 1] for i, arg in enumerate(quality) if arg == '--dealer'], ORDER)
                self.assertIn(['node', ['tools/audit_product_names.mjs', '--online', '--strict-source']], calls)

    def test_input_uses_step_env_and_shell_is_valid(self):
        self.assertIn("REQUESTED_DEALERS: ${{ inputs.dealers || '' }}", self.step)
        self.assertNotIn('${{', self.shell)
        self.assertRegex(self.workflow, r'dealers:\n        description:.*strict lowercase.*burton/backcountry/evo/rei.*\n        required: false\n        type: string\n        default: ""')
        result = subprocess.run(['bash', '-n'], input=self.shell, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
