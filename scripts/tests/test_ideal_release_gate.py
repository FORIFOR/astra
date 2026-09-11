"""Fault injection for release aggregation; stubs are not product evidence."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "ideal-release-gate.sh"
STEPS = "01 02 03 04 05 06 06b 06c 06d 06e 06f 07 08 09 10 11 12 13 14 15 18 19".split()


class ReleaseAggregationTests(unittest.TestCase):
    def run_gate(self, step, fault="", work_status="PASS", work_exit=0):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts/reality").mkdir(parents=True)
            shutil.copy2(SCRIPT, root / "scripts/ideal-release-gate.sh")
            subprocess.run(["git", "init", "-q", directory], check=True)
            subprocess.run(
                ["git", "-C", directory, "-c", "user.name=Test", "-c",
                 "user.email=test@example.invalid", "commit", "-qm", "fixture", "--allow-empty"],
                check=True,
            )
            binary = root / "apps/astra-macos/.build/debug/AstraMac"
            binary.parent.mkdir(parents=True)
            binary.write_text('''#!/usr/bin/env bash
case "$2" in
  golden)
    if [[ "$FAULT" == light && "$3" != */dark ]]; then echo SELFTEST_FAIL; exit 1; fi
    echo 'SELFTEST_OK golden' ;;
  invocation)
    if [[ "$FAULT" == invocation ]]; then echo SELFTEST_FAIL; exit 1; fi
    echo 'SELFTEST_OK invocation' ;;
  invocationaudio) echo 'SELFTEST_OK invocationaudio' ;;
  update)
    if [[ "$FAULT" == update ]]; then echo SELFTEST_FAIL; exit 1; fi
    echo 'SELFTEST_OK update' ;;
esac
''')
            binary.chmod(0o755)
            atlas = root / "docs/ui-atlas"
            atlas.mkdir(parents=True)
            (atlas / "manifest.json").write_text(
                '{"screens":[{"id":"system.update-available","status":"CAPTURED"}]}'
            )
            (root / "scripts/reality/run-work-context-release-gate.sh").write_text(
                f"echo WORK_CONTEXT_RELEASE_GATE={work_status}\nexit {work_exit}\n"
            )
            env = dict(os.environ, ASTRA_RELEASE="0", FAULT=fault,
                       ASTRA_GATE_WORK=str(root / "evidence"),
                       ASTRA_GATE_SKIP=",".join(s for s in STEPS if s != step))
            result = subprocess.run(
                ["bash", str(root / "scripts/ideal-release-gate.sh")],
                env=env, text=True, capture_output=True, timeout=20,
            )
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("RELEASE_GO=NO", result.stdout)
            return result.stdout

    def test_light_failure_is_not_hidden_by_dark_success(self):
        self.assertRegex(self.run_gate("04", "light"), r"04\s+golden light\+dark\s+FAIL")

    def test_invocation_failure_is_not_hidden_by_audio_success(self):
        self.assertRegex(self.run_gate("06", "invocation"), r"06\s+Invocation acoustic\s+FAIL")

    def test_update_failure_is_not_hidden_by_saved_screenshot(self):
        self.assertRegex(self.run_gate("15", "update"), r"15\s+Sparkle\s+FAIL")

    def test_partial_work_context_cannot_pass_even_with_exit_zero(self):
        self.assertRegex(self.run_gate("06f", work_status="PASS_OFFLINE"),
                         r"06f\s+Work Context release\s+FAIL")

    def test_missing_work_identity_is_classified(self):
        self.assertRegex(self.run_gate("06f", work_status="AUTOMATION_MISSING", work_exit=3),
                         r"06f\s+Work Context release\s+AUTOMATION_MISSING")

    def test_successful_individual_checks_still_pass(self):
        for step, label in [("04", r"golden light\+dark"), ("06", "Invocation acoustic"),
                            ("15", "Sparkle"), ("06f", "Work Context release")]:
            with self.subTest(step=step):
                self.assertRegex(self.run_gate(step), rf"{step}\s+{label}\s+PASS")


if __name__ == "__main__":
    unittest.main()
