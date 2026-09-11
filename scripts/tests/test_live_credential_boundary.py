import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

class LiveCredentialBoundaryTests(unittest.TestCase):
    def test_gateway_does_not_inherit_seed_or_future_write_grants(self):
        script = Path(__file__).resolve().parents[1] / 'reality/without-test-credentials.py'
        env = dict(os.environ, ASTRA_TEST_GOOGLE_REFRESH_TOKEN='test-seed',
            ASTRA_TEST_GOOGLE_WRITE_REFRESH_TOKEN='test-write', ASTRA_TEST_MS_READ_REFRESH_TOKEN='test-read',
            ASTRA_OAUTH_GOOGLE_CLIENT_ID='public-app-id', ASTRA_API_URL='http://localhost:3399')
        program = 'import os,json; print(json.dumps({"test_keys": [k for k in os.environ if k.startswith("ASTRA_TEST_")], "client": os.environ["ASTRA_OAUTH_GOOGLE_CLIENT_ID"], "api": os.environ["ASTRA_API_URL"]}))'
        result = subprocess.run([sys.executable, str(script), sys.executable, '-c', program], env=env, capture_output=True, text=True, check=True, timeout=5)
        self.assertEqual(json.loads(result.stdout), {'test_keys': [], 'client': 'public-app-id', 'api': 'http://localhost:3399'})

if __name__ == '__main__':
    unittest.main()
