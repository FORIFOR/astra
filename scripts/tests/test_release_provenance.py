"""A newer filename must never substitute for the archive built from this source."""
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'release-provenance.py'


class ReleaseProvenanceTests(unittest.TestCase):
    def test_source_and_archive_must_both_match(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            (root / '.gitignore').write_text('dist/\n')
            source = root / 'source.txt'
            source.write_text('original')
            subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(root), '-c', 'user.name=Test', '-c',
                            'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], check=True)
            (root / 'dist').mkdir()
            archive = root / 'dist/Astra.zip'
            archive.write_bytes(b'archive fixture')
            def run(mode, *args):
                return subprocess.run(['python3', str(SCRIPT), mode, str(root), *map(str, args)],
                                      capture_output=True, text=True, timeout=10)
            initial = run('snapshot').stdout.strip()
            self.assertEqual(run('create', archive, initial).returncode, 0)
            self.assertEqual(run('verify', archive).returncode, 0)
            archive.write_bytes(b'wrong archive')
            self.assertNotEqual(run('verify', archive).returncode, 0)
            archive.write_bytes(b'archive fixture')
            source.write_text('changed')
            self.assertNotEqual(run('verify', archive).returncode, 0)
            self.assertNotEqual(run('create', archive, initial).returncode, 0)
            source.write_text('original')
            untracked = root / 'new-source.txt'
            untracked.write_text('uncommitted feature')
            self.assertNotEqual(run('verify', archive).returncode, 0)
            untracked.unlink()
            self.assertEqual(run('verify', archive).returncode, 0)


if __name__ == '__main__':
    unittest.main()
