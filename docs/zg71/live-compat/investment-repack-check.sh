#!/bin/bash
# Reproducible equivalence check for the investment-intelligence-read import-only repack.
# Needs: deno (2.x), python3, run from the repo root. Writes nothing into the repo.
# Layout A: repo layout (../../../labs/... imports) with the live-gated index.
# Layout B: dashboard-resolvable layout (labs under ../_shared/labs/...), only import specifiers rewritten.
# Live yahoo-us-market.mjs differs from the repo only by the user-agent brand string, so the live text is used.
set -euo pipefail
R=$(pwd); D=$R/docs/zg71/live-compat; W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
mkdir -p $W/A/supabase/functions/investment-intelligence-read $W/A/labs/investment $W/B/fn/source $W/B/fn/_shared/labs/investment
cp $D/investment-intelligence-read.gated.ts $W/A/supabase/functions/investment-intelligence-read/index.ts
cp -r $R/supabase/functions/_shared $W/A/supabase/functions/; cp -r $R/labs/investment/src $W/A/labs/investment/
sed -i 's#"TRQN Investment read-only provider"#"Tron Investment read-only provider"#' $W/A/supabase/functions/_shared/yahoo-us-market.mjs
cp $W/A/supabase/functions/_shared/*.mjs $W/A/supabase/functions/_shared/app-access.ts $W/B/fn/_shared/
cp -r $R/labs/investment/src $W/B/fn/_shared/labs/investment/
cp $D/investment-intelligence-read.gated-repack.ts $W/B/fn/source/index.ts
sed -i 's#"\.\./\.\./\.\./labs/#"./labs/#g' $W/B/fn/_shared/*.mjs
(cd $W/A/supabase/functions/investment-intelligence-read && deno info --json index.ts > $W/A.json)
(cd $W/B/fn/source && deno info --json index.ts > $W/B.json)
python3 - $W <<'PY'
import json,hashlib,re,sys
W=sys.argv[1]
def load(f,root):
    g=json.load(open(f)); loc={}; rem=set(); err=[]
    for m in g['modules']:
        if 'error' in m: err.append(m['specifier']); continue
        s=m['specifier']
        if s.startswith('file://'): loc[s[7:].replace(root,'')]=s[7:]
        else: rem.add(s)
    return loc,rem,err
def norm(p):
    for a,b in [(r'^/supabase/functions/investment-intelligence-read/index.ts$','INDEX'),(r'^/fn/source/index.ts$','INDEX'),
                (r'^/supabase/functions/_shared/','S/'),(r'^/labs/investment/src/','L/'),(r'^/fn/_shared/labs/investment/src/','L/'),(r'^/fn/_shared/','S/')]:
        p=re.sub(a,b,p)
    return p
def h(path):
    t=open(path).read(); t=re.sub(r'"(?:\.\./)+(?:_shared/)?labs/|"\./labs/|"\.\./_shared/labs/|"\.\./_shared/','"@',t); return hashlib.sha256(t.encode()).hexdigest()[:12]
la,ra,ea=load(W+'/A.json',W+'/A'); lb,rb,eb=load(W+'/B.json',W+'/B')
a={norm(k):h(v) for k,v in la.items()}; b={norm(k):h(v) for k,v in lb.items()}
ok=not ea and not eb and a==b and ra==rb
print(json.dumps({'errors':[len(ea),len(eb)],'local_modules':[len(a),len(b)],'same_modules_and_normalised_content':a==b,'same_remote_deps':ra==rb,'remote_deps':len(ra)}))
sys.exit(0 if ok else 1)
PY
