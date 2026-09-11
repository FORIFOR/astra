import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

class CSharpGateTests(unittest.TestCase):
    def test_restore_and_non_csharp_failures_never_pass(self):
        for fault in ['restore', 'build']:
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'scripts').mkdir()
                script = root / 'scripts/verify-csharp-logic.sh'
                shutil.copy2(Path(__file__).resolve().parents[1] / script.name, script)
                binary = root / 'dotnet'
                binary.write_text('''#!/usr/bin/env bash
if [ "$1" = "$FAULT" ]; then
  echo 'error MSB0001: test dependency failure'
  exit 1
fi
exit 0
''')
                binary.chmod(0o755)
                result = subprocess.run(['bash', str(script)], env=dict(os.environ,
                    PATH=str(root)+os.pathsep+os.environ['PATH'], FAULT=fault),
                    capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('CSLOGIC_OK', result.stdout)

if __name__ == '__main__':
    unittest.main()
