"""Apply the reviewed entry only after current canonical learning layers."""
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]);source=pathlib.Path(__file__).resolve().parents[1]/'apps/learning-archipelago-entry'
base={'index.html':'962c244bcb431e706ffa7638215e0f8320a46dec61313c39d5a9d21e96d78540','island-world.js':'f7f27ba93df8c32da893c38643bcc821a0fd20ee3cf054f11c1ec91152aba0e5'}
for name,digest in base.items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest, f'Newer map detected: {name}; rebase instead of overwrite'
for name in base:(root/name).write_bytes((source/name).read_bytes())
(root/'investment-entry-manifest.json').write_text(json.dumps({'release':'investment-island-entry-20261118','base':base,'sha256':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in base}},indent=2))
print('Private Investment island entry applied; prior map baseline verified')
