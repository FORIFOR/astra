"""Exercise the real dump wrapper across client versions without a database."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class DumpSchemaTests(unittest.TestCase):
    def run_dump(self, work, version, timeout_line='', column='id', fail=False):
        bin_dir = work / 'bin'
        bin_dir.mkdir(exist_ok=True)
        psql = bin_dir / 'psql'
        psql.write_text("#!/bin/sh\ncase \"$*\" in *server_version_num*) echo 160006;; *) echo \"INSERT INTO schema_migrations (version) VALUES ('202609090001');\";; esac\n")
        psql.chmod(0o755)
        dump = work / 'input.sql'
        dump.write_text('-- Dumped from database version 16.6\n'
                        f'-- Dumped by pg_dump version {version}.0\n'
                        '\\restrict random-client-token\n'
                        + timeout_line
                        + 'SET statement_timeout = 0;\n'
                        + ''.join(f'CREATE TABLE sample_{i} ({column} integer);\n' for i in range(55))
                        + '\\unrestrict random-client-token\n')
        pg_dump = bin_dir / 'pg_dump'
        pg_dump.write_text(f'#!/bin/sh\nif [ "$1" = --version ]; then echo "pg_dump (PostgreSQL) {version}.0"; exit 0; fi\n'
                           + ('exit 1\n' if fail else 'cat "$DUMP_FIXTURE"\n'))
        pg_dump.chmod(0o755)
        out = work / 'schema.sql'
        env = dict(os.environ, PATH=f'{bin_dir}:{os.environ["PATH"]}', DUMP_FIXTURE=str(dump))
        result = subprocess.run(['bash', str(ROOT / 'scripts/dump-schema.sh'),
                                 'postgres://test@localhost/test', str(out)],
                                env=env, capture_output=True, text=True)
        return result, out

    def test_pg16_and_pg18_have_identical_schema_output(self):
        with tempfile.TemporaryDirectory() as d:
            work = Path(d)
            old, out = self.run_dump(work, 16)
            self.assertEqual(old.returncode, 0, old.stderr)
            expected = out.read_text()
            new, out = self.run_dump(work, 18, 'SET transaction_timeout = 0;\n')
            self.assertEqual(new.returncode, 0, new.stderr)
            self.assertEqual(out.read_text(), expected)
            self.assertIn('SET statement_timeout = 0;', expected)
            self.assertIn('CREATE TABLE sample_0 (id integer);', expected)
            changed, out = self.run_dump(work, 18, 'SET transaction_timeout = 0;\n', column='changed')
            self.assertEqual(changed.returncode, 0, changed.stderr)
            self.assertNotEqual(out.read_text(), expected)

    def test_failed_dump_preserves_previous_schema(self):
        with tempfile.TemporaryDirectory() as d:
            work = Path(d)
            (work / 'schema.sql').write_text('previous schema')
            result, out = self.run_dump(work, 18, fail=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(out.read_text(), 'previous schema')


if __name__ == '__main__':
    unittest.main()
