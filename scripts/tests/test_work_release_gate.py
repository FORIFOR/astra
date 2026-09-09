"""Fault-inject aggregation only; the stubs are not live-service evidence."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

class WorkReleaseGateTests(unittest.TestCase):
    def run_gate(self, fault):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scripts = root / 'scripts/reality'
            scripts.mkdir(parents=True)
            original = Path(__file__).resolve().parents[1] / 'reality/run-work-context-release-gate.sh'
            shutil.copy2(original, scripts / original.name)
            for name in ['work-context', 'daily-work', 'reply-brief', 'meeting-work-loop']:
                file = scripts / f'run-{name}-gate.sh'
                file.write_text('#!/bin/bash\nexit 0\n')
                file.chmod(0o755)
            live = scripts / 'run-work-context-live.sh'
            live.write_text('''#!/usr/bin/env bash
prefix=$(echo "$ASTRA_LIVE_PROVIDER" | tr '[:lower:]' '[:upper:]')
if [ "$FAULT" = missing ]; then echo "${prefix}_DAILY_WORK_LIVE=AUTOMATION_MISSING"; exit 3; fi
name="${prefix}_DAILY_WORK_LIVE"
if [ "$ASTRA_LIVE_FAULT_MODE" = send-response-loss ]; then
  name="${prefix}_CONNECTOR_RESPONSE_LOSS_LIVE"
  if [ "$FAULT" = partial ]; then echo "$name=PASS_OFFLINE"; exit 0; fi
fi
echo "$name=PASS"
''')
            result = subprocess.run(['bash', str(scripts / original.name)], env=dict(os.environ, FAULT=fault,
                ASTRA_RELEASE_OUT=str(root / 'out')), capture_output=True, text=True, timeout=10)
            return result
    def test_offline_recovery_marker_cannot_pass(self):
        result = self.run_gate('partial')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('recovery = FAIL / FAIL', result.stdout)
    def test_missing_identity_is_reported_as_missing(self):
        result = self.run_gate('missing')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('live = AUTOMATION_MISSING / AUTOMATION_MISSING', result.stdout)
    def test_both_real_run_markers_and_recovery_markers_are_required(self):
        result = self.run_gate('none')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('WORK_CONTEXT_RELEASE_GATE=PASS', result.stdout)

if __name__ == '__main__':
    unittest.main()
