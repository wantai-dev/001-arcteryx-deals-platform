"""Engine tests for tools/development_ci.py: L0/L1/L2 `classify` on sample diffs, `--keep-going` / `check_summary`,
host `platform` steps, and this repository's own `classify` configuration. Runs in isolated git fixtures; the
fixture checks are trivial Python one-liners, never this repository's real check commands."""
import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('development_ci', ROOT / 'tools/development_ci.py')
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)

# ---- repository-specific samples: each path must fall in the named category of this repo's classify config ----
REPO_L2_SAMPLES = {
    "supabase/migrations/20260719161928_geardrop_submission_security.sql": "schema-migration",
    "ops/web/deploy-server.sh": "build-ci-config",
    "app/app.json": "build-ci-config",
    "app/app/privacy.tsx": "auth-payment-privacy",
    "app/lib/queuedSingleFlight.ts": "shared-module",
    "requirements.txt": "dependency-or-ci-engine",
}
REPO_L0_SAMPLES = ["DATA_UPDATE_REPORT.md"]

PASS = [sys.executable, '-c', 'pass']
FAIL = [sys.executable, '-c', 'raise SystemExit(3)']
FIXTURE_MANIFEST = {
    'version': 1, 'project': 'example/fixture', 'runner': 'ubuntu-latest', 'install': [], 'notes': [],
    'checks': [
        {'id': 'app', 'paths': ['src/**', 'packages/**', 'package.json'], 'command': PASS, 'cwd': '.'},
        {'id': 'tools', 'paths': ['tools/**'], 'command': PASS, 'cwd': '.'},
    ],
    'classify': {
        'l0_paths': ['tests/fixtures/**', 'locales/**'],
        'module_roots': ['packages/*'],
        'l2_paths': {'auth-payment': ['src/auth/**', 'src/pay/**']},
    },
}
SERVICE = 'src/service.py'
BASELINE = {SERVICE: 'def size(items):\n    return len(items)\n', 'src/view.js': 'export const n = 1;\n',
            'package.json': '{"name": "fixture"}\n'}


class Fixture(unittest.TestCase):
    manifest_data = FIXTURE_MANIFEST

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='development-ci-engine-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        (self.root / '.development-ci.json').write_text(json.dumps(self.manifest_data))
        for path, text in BASELINE.items():
            self.write(path, text)
        self.git('init', '-q')
        self.git('add', '.')
        self.commit('baseline')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.manifest = ci.load_manifest(self.root)

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.root), *args], check=True, capture_output=True, text=True,
                              env={**os.environ, 'GIT_CONFIG_NOSYSTEM': '1'}).stdout

    def commit(self, message):
        self.git('-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.invalid', 'commit', '-qm', message)

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def classify(self):
        return ci.classify(self.root, self.manifest, self.base)

    @staticmethod
    def rules(result):
        return {item['rule'] for item in result['reasons']}


class ClassifyTests(Fixture):
    def test_l0_documentation_only(self):
        self.write('docs/guide.md', '# Guide\n' * 500)
        self.write('README.md', 'hello\n')
        result = self.classify()
        self.assertEqual((result['level'], self.rules(result)), ('L0', {'docs-copy-or-test-data'}))
        self.assertEqual([c['command'] for c in result['suggested_commands']], [['git', 'diff', '--check', self.base]])

    def test_l0_copy_and_test_data_with_syntax_checks(self):
        self.write('tests/fixtures/order.json', '{"id": 1}\n')
        self.write('locales/zh.json', '{"title": "标题"}\n')
        result = self.classify()
        self.assertEqual(result['level'], 'L0')
        commands = [c['command'] for c in result['suggested_commands']]
        self.assertIn(['python3', '-m', 'json.tool', 'tests/fixtures/order.json'], commands)

    def test_l0_single_file_comment_only(self):
        self.write(SERVICE, '# Sizing helpers.\n' + BASELINE[SERVICE] + '\n# Items are de-duplicated upstream.\n')
        result = self.classify()
        self.assertEqual(result['level'], 'L0', result)
        self.assertIn('single-file-comment-only', self.rules(result))

    def test_l0_js_comment_but_l1_js_logic(self):
        self.write('src/view.js', '// Count shown on the badge.\n' + BASELINE['src/view.js'])
        self.assertEqual(self.classify()['level'], 'L0')
        self.write('src/view.js', BASELINE['src/view.js'].replace('1', '2'))
        self.assertEqual(self.classify()['level'], 'L1')

    def test_l1_small_logic_change_rounds_up(self):
        self.write(SERVICE, BASELINE[SERVICE].replace('len(items)', 'len(set(items))'))
        result = self.classify()
        self.assertEqual((result['level'], self.rules(result)), ('L1', {'small-logic-change'}))
        self.assertEqual([c['command'] for c in result['suggested_commands']],
                         [['python3', 'tools/development_ci.py', 'changed', '--base', self.base]])

    def test_l1_routine_counts_committed_and_untracked_work(self):
        self.write(SERVICE, BASELINE[SERVICE] + ''.join(f'\nLIMIT_{i} = {i}\n' for i in range(20)))
        self.git('add', SERVICE)
        self.commit('committed half')
        self.write('src/helpers.py', 'def one():\n    return 1\n')
        result = self.classify()
        self.assertEqual((result['level'], self.rules(result)), ('L1', {'routine'}))
        self.assertEqual(result['stats']['code_lines'], 42)
        self.assertEqual(result['selected_checks'], ['app'])

    def test_l2_paths_dependencies_and_engine(self):
        cases = {'src/auth/session.py': 'path:auth-payment', 'Dockerfile': 'path:build-ci-config',
                 'db/migrations/001_init.sql': 'path:schema-migration', 'package-lock.json': 'dependency-or-ci-engine',
                 '.github/workflows/ci.yml': 'dependency-or-ci-engine', 'tools/development_ci.py': 'dependency-or-ci-engine'}
        for path, rule in cases.items():
            with self.subTest(path=path):
                self.write(path, 'x = 1\n')
                try:
                    result = self.classify()
                    self.assertEqual(result['level'], 'L2')
                    self.assertIn(rule, self.rules(result))
                    self.assertEqual([c['command'][2:] for c in result['suggested_commands']],
                                     [['changed', '--base', self.base, '--keep-going'], ['full']])
                finally:
                    (self.root / path).unlink()

    def test_l2_diff_over_300_lines(self):
        self.write(SERVICE, BASELINE[SERVICE] + ''.join(f'V{i} = {i}\n' for i in range(301)))
        result = self.classify()
        self.assertEqual((result['level'], self.rules(result)), ('L2', {'diff-size'}))

    def test_l2_three_modules_but_not_two(self):
        self.write('packages/a/index.js', 'export const a = 1;\n')
        self.write('packages/b/index.js', 'export const b = 1;\n')
        two = self.classify()
        self.assertEqual((two['level'], two['stats']['modules']), ('L1', ['packages/a', 'packages/b']))
        self.write(SERVICE, BASELINE[SERVICE] + 'MAX = 8\n')
        three = self.classify()
        self.assertEqual((three['level'], self.rules(three)), ('L2', {'cross-module'}))

    def test_no_changes_is_l0(self):
        self.assertEqual(self.rules(self.classify()), {'no-changes'})

    def test_invalid_classify_configuration_is_rejected(self):
        for raw, message in [({'surprise': []}, 'unknown keys'), ({'l2_paths': {'Bad Name': ['x/**']}}, 'kebab-case'),
                             ({'l2_paths': {'ok': ['../escape/**']}}, 'escapes'), ({'l2_max_lines': 0}, 'positive'),
                             ({'l0_paths': 'docs/**'}, 'must be a list')]:
            with self.subTest(raw=raw), self.assertRaisesRegex(ci.CIError, message):
                ci.classify_config(raw)

    def test_cli_formats_and_bad_base(self):
        self.write('docs/guide.md', 'hello\n')
        for argv, check in [(['--format', 'json'], lambda out: json.loads(out)['level'] == 'L0'),
                            ([], lambda out: '改动级别：L0' in out)]:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = ci.main(['classify', '--base', self.base, *argv], root=self.root)
            self.assertEqual(code, 0)
            self.assertTrue(check(out.getvalue()))
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(ci.main(['classify', '--base', 'no-such-ref'], root=self.root), 1)


class KeepGoingAndPlatformTests(Fixture):
    manifest_data = {**FIXTURE_MANIFEST, 'checks': [
        {'id': 'first-fails', 'paths': ['src/**'], 'command': FAIL, 'cwd': '.'},
        {'id': 'second-passes', 'paths': ['src/**'], 'command': PASS, 'cwd': '.'},
        {'id': 'mac-only', 'paths': ['src/**'], 'command': PASS, 'cwd': '.', 'platform': 'macos'},
    ]}

    def run_mode(self, mode, **flags):
        self.write(SERVICE, BASELINE[SERVICE] + 'X = 1\n')
        args = argparse.Namespace(mode=mode, base=self.base, dry_run=False, install=False, host_platform='linux',
                                  **{'keep_going': False, 'fail_fast': False, **flags})
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(ci.CIError) as raised:
            ci.execute(self.root, self.manifest, args)
        return out.getvalue(), str(raised.exception)

    def test_changed_fails_fast_by_default(self):
        out, _ = self.run_mode('changed')
        self.assertIn('"step_result": "first-fails"', out)
        self.assertNotIn('"step": "second-passes"', out)
        self.assertNotIn('check_summary', out)

    def test_keep_going_runs_everything_and_reports_a_summary(self):
        out, error = self.run_mode('changed', keep_going=True)
        summary = [json.loads(line)['check_summary'] for line in out.splitlines() if 'check_summary' in line][0]
        self.assertEqual(summary, {'total': 2, 'passed': 1, 'failed': ['first-fails'],
                                   'not_run_on_this_host': ['mac-only']})
        self.assertIn('1/2 check(s) failed', error)

    def test_full_keeps_going_by_default(self):
        out, _ = self.run_mode('full')
        self.assertIn('check_summary', out)


class RepositoryConfigTests(unittest.TestCase):
    def test_repository_manifest_and_classify_samples(self):
        manifest = ci.load_manifest(ROOT)
        config = manifest['classify']
        for path, category in REPO_L2_SAMPLES.items():
            with self.subTest(path=path):
                self.assertTrue(ci.affects_all(path) if category == 'dependency-or-ci-engine' else
                                any(ci.matches(path, g) for g in config['l2_paths'][category]), (path, category))
        for path in REPO_L0_SAMPLES:
            with self.subTest(path=path):
                self.assertTrue(ci.documentation_only(path) or any(ci.matches(path, g) for g in config['l0_paths']))
        engine_tests = [c for c in manifest['checks'] if c['id'] == 'ci-engine-tests']
        self.assertEqual(len(engine_tests), 1, 'the engine tests must run as a configured check')
        self.assertTrue(any(ci.matches('tools/development_ci.py', g) for g in engine_tests[0]['paths']))


if __name__ == '__main__':
    unittest.main()
