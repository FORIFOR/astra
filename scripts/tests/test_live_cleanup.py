"""Exercise the real EXIT handler with fake providers; never calls live services."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'reality/run-work-context-live.sh'

class LiveCleanupTests(unittest.TestCase):
    def run_cleanup(self, fixture_failure=False, database_failure=False, assertions_rc=0):
        source = SCRIPT.read_text()
        handler = source[source.index('cleanup() {'):source.index('fail() {')]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store, out = root / 'store', root / 'out'
            store.mkdir(); out.mkdir()
            (store / 'seeded.json').write_text('{"messages":["test-id"]}')
            (store / 'secrets.json').write_text('test-only-secret')
            (store / 'seed.log').write_text('seeded\n')
            setup = '''
GATEWAY_PID=""; HOST_PID=""; WORKER_PID=""
NAME=GOOGLE_DAILY_WORK_LIVE; PROVIDER=google; NONCE=test
ADMIN_URL=unused; ROOT=unused
pnpm() { echo cleanup-attempt; return "$FIXTURE_RC"; }
dbmate() { return "$DATABASE_RC"; }
'''
            result = subprocess.run(['bash', '-c', setup + handler + '\nexit "$ASSERTIONS_RC"'],
                env=dict(os.environ, STORE=str(store), OUT=str(out),
                         FIXTURE_RC=str(int(fixture_failure)), DATABASE_RC=str(int(database_failure)),
                         ASSERTIONS_RC=str(assertions_rc)), capture_output=True, text=True, timeout=5)
            self.assertFalse(store.exists(), 'temporary credentials must be removed')
            self.assertIn('cleanup-attempt', (out / 'seed.log').read_text())
            self.assertEqual((out / 'seeded-cleanup-pending-google.json').exists(), fixture_failure or database_failure)
            return result

    def test_pass_requires_successful_cleanup(self):
        result = self.run_cleanup()
        self.assertEqual(result.returncode, 0)
        self.assertIn('GOOGLE_DAILY_WORK_LIVE=PASS', result.stdout)

    def test_each_cleanup_failure_overrides_success(self):
        for fixture, database in [(True, False), (False, True)]:
            result = self.run_cleanup(fixture, database)
            self.assertEqual(result.returncode, 1)
            self.assertNotIn('=PASS', result.stdout)
            self.assertIn('=FAIL cleanup incomplete', result.stderr)

    def test_assertion_failure_cannot_be_hidden_by_cleanup_success(self):
        result = self.run_cleanup(assertions_rc=1)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn('=PASS', result.stdout)

if __name__ == '__main__':
    unittest.main()
