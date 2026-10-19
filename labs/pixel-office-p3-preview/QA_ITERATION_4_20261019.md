# P3 Pixel Office Lab — 2026-10-19 Character Sprite QA

Status: **DRAFT / NO DEPLOY / ART STILL IN PROGRESS**. Tested program Source SHA: `7c8b2f3b4a33c15f4deae586d8886049e05b711c`. Base official `main`: `a9db9b2fe3051e22d59e52ad083c8d54d12dba62` / `0.9.0-alpha.9.76`.

## Engineering changes
- New `sprites.js`: inlined small static SVG pixel sprites for **PM**, **Co**, **Gem** with hair, skin tone, clothes, legs, face and accessories; cat pixel sprite (ears, eyes, paws, tail).
- Showcase-only CSS action classes: walking, typing, meeting gesture and break. Simple periodic cat tail movement / blinking. **NOT** connected to real work or AI presence; original display-mode notices remain.
- Desktop large screen initially scales office to fill more screen width (instead of fitting entire height and shrinking all actors); room camera, touch pan, pinch zoom and immersive controls remain.
- Maintained GitHub PR #65 Draft, all files strictly in `labs/pixel-office-p3-preview/`, no production page edits.

## Browser QA: original exact program bytes read back from GitHub
Local headless **Chromium** HTML/CSS/SVG/JS rendering; no network or external sprite fetch. QA dimensions:

| Viewport | SVG agent count | Pixel pet | JS page errors | Status |
|---|---:|---:|---:|---|
| Mobile portrait 390×844 | 3 | 1 | 0 | PASS |
| Mobile landscape 844×390 | 3 | 1 | 0 | PASS |
| Desktop landscape 1440×900 | 3 | 1 | 0 | PASS |
| Desktop portrait 900×1200 | 3 | 1 | 0 | PASS |

Selected automated interactions at 390×844: once-only P2 bonus 0→500 PASS, repeat disabled PASS, orange cat buy 500→150 PASS, switch to black cat and back to owned orange without another deduction PASS, selected CSS cat color PASS, +camera zoom PASS, immersive toggle hides shops and returning restores them PASS. Browser JS errors: 0.

## Open / HOLD
- Visual reference is high-quality isometric game art: current sprites improve recognizability but **not** full illustrated 2.5D fidelity. More actor movements, collisions, depth and furnishing polishing are necessary.
- No hands-on **iPhone Safari** validation; Chromium emulated viewport is not physical device evidence.
- Not yet integrated into pinned original Habblaud native Canvas scene; cannot replace official homepage without separate PM exact-SHA approval.
- Economy remains localStorage demonstration only; no true work-derived backend event grants, payments or live presence.
- No new cloud charges, no Github App or DB changes, no TaskFlow Gate override.
