#!/usr/bin/env python3
"""Bind the distributed zip to the exact tracked and untracked source snapshot."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def digest_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def snapshot(root):
    names = subprocess.check_output(
        ['git', '-C', str(root), 'ls-files', '-z', '--cached', '--others', '--exclude-standard']
    ).split(b'\0')
    digest = hashlib.sha256()
    digest.update(subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD']))
    for name in sorted(set(names) - {b''}):
        path = root / os.fsdecode(name)
        if path.is_symlink():
            value = ('link:' + os.readlink(path)).encode()
        elif path.is_file():
            value = f'file:{bool(path.stat().st_mode & 0o111)}:{digest_file(path)}'.encode()
        elif not path.exists():
            value = b'deleted'
        else:
            raise ValueError(f'unsupported source entry: {name!r}')
        digest.update(name + b'\0' + value + b'\0')
    return digest.hexdigest()


def main():
    mode, root_arg, *args = sys.argv[1:]
    root = Path(root_arg).resolve()
    current = snapshot(root)
    if mode == 'snapshot':
        print(current)
        return
    archive = Path(args[0]).resolve()
    manifest = Path(str(archive) + '.provenance.json')
    if mode == 'create':
        if current != args[1]:
            raise ValueError('source changed during release build; rebuild before attesting')
        data = dict(schema=1, source_sha256=current, archive_sha256=digest_file(archive),
                    revision=subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip())
        temporary = manifest.with_suffix('.tmp')
        temporary.write_text(json.dumps(data, indent=2) + '\n')
        temporary.replace(manifest)
    elif mode == 'verify':
        data = json.loads(manifest.read_text())
        if data.get('schema') != 1 or data.get('source_sha256') != current:
            raise ValueError('archive source does not match this checkout')
        if data.get('archive_sha256') != digest_file(archive):
            raise ValueError('archive hash does not match release provenance')
        print('RELEASE_PROVENANCE=PASS')
    else:
        raise ValueError(f'unknown mode: {mode}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'RELEASE_PROVENANCE=FAIL {error}', file=sys.stderr)
        sys.exit(1)
