#!/usr/bin/env python3
"""Launch a gateway/worker without inheriting harness provisioning credentials."""
import os
import sys

if len(sys.argv) < 2:
    raise SystemExit('missing child command')
environment = {key: value for key, value in os.environ.items() if not key.startswith('ASTRA_TEST_')}
os.execvpe(sys.argv[1], sys.argv[1:], environment)
