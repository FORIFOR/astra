"""Exercise app/evidence failure handling without running the real LLM."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class ScreenshotGateTests(unittest.TestCase):
    def run_result(self, marker, app_rc=0):
        source = (Path(__file__).resolve().parents[1] / 'reality/run-screenshot-e2e.sh').read_text()
        tail = source[source.index('"$BIN" --selftest screenshote2e'):]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / 'app'
            app.write_text('#!/bin/bash\nprintf "%s\\n" "$MARKER"\nexit "$APP_RC"\n')
            app.chmod(0o755)
            return subprocess.run(['bash', '-c', 'set -uo pipefail\nfail() { exit 1; }\n' + tail],
                env=dict(os.environ, BIN=str(app), BASE='unused', EMAIL='unused',
                         STORE=directory, OUT=directory, MARKER=marker, APP_RC=str(app_rc)),
                capture_output=True, text=True, timeout=5)

    def test_nonzero_exit_overrides_pass_marker(self):
        self.assertNotEqual(self.run_result('SCREENSHOT_E2E=PASS nonce=test', 2).returncode, 0)

    def test_only_actual_pass_marker_is_accepted(self):
        for marker in ['SCREENSHOT_E2E=PASS_OFFLINE', 'SCREENSHOT_E2E=SKIP', 'quoted SCREENSHOT_E2E=PASS']:
            self.assertNotEqual(self.run_result(marker).returncode, 0)
        self.assertEqual(self.run_result('SCREENSHOT_E2E=PASS nonce=test task=test').returncode, 0)


if __name__ == '__main__':
    unittest.main()
