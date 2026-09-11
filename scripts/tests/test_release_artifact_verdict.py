"""Check final release criteria independently of unavailable signing credentials."""
from pathlib import Path
import subprocess
import unittest


class ReleaseArtifactVerdictTests(unittest.TestCase):
    def verdict(self, readiness='NOTARIZED', skips=0, bad=0):
        source = (Path(__file__).resolve().parents[1] / 'verify-release-artifact.sh').read_text()
        verdict = source[source.index('[[ "$BAD" -eq 0 ]]'):]
        setup = f'fail=0; BAD={bad}; SKIP={skips}; PASS=50; BADLIST=""; READINESS={readiness}\n'
        return subprocess.run(['bash', '-c', setup + verdict], capture_output=True, text=True)

    def test_unsigned_or_unstapled_cannot_pass(self):
        for readiness in ['SIGNED_NOT_STAPLED', 'SIGNED_NOT_NOTARIZED']:
            result = self.verdict(readiness=readiness)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('RELEASE_ARTIFACT_OK', result.stdout)

    def test_skipped_or_failed_mandatory_tests_cannot_pass(self):
        self.assertNotEqual(self.verdict(skips=1).returncode, 0)
        self.assertNotEqual(self.verdict(bad=1).returncode, 0)
        self.assertEqual(self.verdict().returncode, 0)


if __name__ == '__main__':
    unittest.main()
