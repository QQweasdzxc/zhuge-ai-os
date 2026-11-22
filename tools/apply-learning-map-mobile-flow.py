"""Apply the bounded learning-map and cross-word presentation delta, or stop untouched."""
import base64
import gzip
import hashlib
import json
import pathlib
import sys

EXPECTED = {
    '1-zili-landscape.webp', '2-zili-portrait.webp', 'island-world.js', 'index.html',
    'chengyu/challenge.js', 'chengyu/index.html',
}


def apply(root, bundle=None):
    root = pathlib.Path(root).resolve()
    bundle = pathlib.Path(bundle) if bundle else pathlib.Path(__file__).resolve().parents[1] / '.github/learning-map-mobile-flow-20261122.json.gz'
    data = json.loads(gzip.decompress(bundle.read_bytes()))
    if data.get('release') != 'learning-map-mobile-flow-20261122' or set(data['sha256']) != EXPECTED or set(data['base_sha256']) != EXPECTED:
        raise ValueError('Unexpected learning delta scope')
    prepared = []
    for name in sorted(EXPECTED):
        target = root / name
        if not target.resolve().is_relative_to(root):
            raise ValueError('Learning path escapes target')
        current = target.read_bytes()
        if hashlib.sha256(current).hexdigest() != data['base_sha256'][name]:
            raise ValueError('Newer learning source detected, rebase instead of overwrite: ' + name)
        payload = data['files'][name].encode() if name in data['files'] else base64.b64decode(data['binary'][name], validate=True)
        if hashlib.sha256(payload).hexdigest() != data['sha256'][name]:
            raise ValueError('Learning payload digest mismatch: ' + name)
        prepared.append((target, payload))
    # Every input and digest is checked before the first write.
    for target, payload in prepared:
        target.write_bytes(payload)
    (root / 'map-mobile-flow-manifest.json').write_text(json.dumps({
        'release': data['release'], 'base_sha256': data['base_sha256'],
        'sha256': data['sha256'], 'preserved': data['preserved'],
    }, ensure_ascii=False, indent=2))
    return data


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: apply-learning-map-mobile-flow.py <assembled-learning-directory>')
    result = apply(sys.argv[1])
    print('Applied bounded learning presentation delta:', len(result['sha256']))
