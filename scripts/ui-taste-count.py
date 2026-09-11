"""Count the existing lint patterns, with content-bound reviewed additions."""
import hashlib
import json
from pathlib import Path
import re
import sys

def count(root, name, pattern, review):
    total = 0
    for path in root.rglob('*.swift'):
        if path.name in ('SelfTest.swift', 'UIGeometry.swift', 'UIDiffImage.swift'):
            continue
        matches = re.findall(pattern, path.read_text())
        if name == '40字超の文言':
            # Interpolation expressions are source code, not displayed prose. Keep the
            # static literal segments: runtime string length belongs to rendered QA.
            matches = [m for m in matches if len(re.sub(r'\\\([^\n]*?\)', '', m)[6:-1]) >= 40]
        total += len(matches)
    accepted = 0
    for entry in review.get('entries', []):
        if entry['kind'] != name:
            continue
        path = root / entry['file']
        if hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError(f"review expired: {entry['file']}")
        if len(re.findall(pattern, path.read_text())) < entry['count']:
            raise ValueError(f"review count invalid: {entry['file']}")
        accepted += entry['count']
    return total, accepted

if __name__ == '__main__':
    root, name, pattern, review = sys.argv[1:]
    try:
        total, accepted = count(Path(root), name, pattern, json.loads(Path(review).read_text()))
        print(total - accepted)
        if accepted:
            print(f'  {name}: actual={total}, reviewed additions={accepted} (content-bound)', file=sys.stderr)
    except (ValueError, OSError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
