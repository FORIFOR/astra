#!/usr/bin/env python3
"""Stop a process tree started by this harness, including pnpm/tsx wrappers."""
import os
import signal
import subprocess
import sys
import time

root = int(sys.argv[1])
if root <= 1 or root == os.getpid():
    raise SystemExit("invalid harness PID")
parents = {}
for line in subprocess.check_output(['ps', '-axo', 'pid=,ppid='], text=True).splitlines():
    pid, parent = map(int, line.split())
    parents.setdefault(parent, []).append(pid)
pids = []
def visit(pid):
    for child in parents.get(pid, []):
        visit(child)
    pids.append(pid)
visit(root)
for sig in (signal.SIGTERM, signal.SIGKILL):
    for pid in pids:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass
    if sig == signal.SIGTERM:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            alive = []
            for pid in pids:
                try:
                    os.kill(pid, 0)
                    alive.append(pid)
                except ProcessLookupError:
                    pass
            if not alive:
                break
            time.sleep(0.1)
