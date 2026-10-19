# P3 Lab iteration 2 — Test evidence and hold points

Git branch: `review/pixel-office-p3-isolated-20261018`. Production parent: `a9db9b2fe3051e22d59e52ad083c8d54d12dba62`. Only prototype Source is modified.

## Confirmed scripted preflight PASS

- JavaScript parser: PASS, no syntax errors.
- HTML static element references: PASS (no duplicate IDs; all queried static IDs exist).
- P2 once-only bonus: PASS: 0→500, repeat claim stays 500.
- Purchase one orange cat: PASS: 500→150; unlock recorded in localStorage.
- Switch orange→free black→owned orange: PASS: wallet remains 150; repeat purchase does not deduct.
- Camera + control: PASS, world transform scale changes.
- Animation waypoint: PASS, cat style left updates on animation frames.
- Keyboard character activation: PASS, opens role dialog from Enter.
- Pet selection visual styling added for black / orange / calico.
- Independent public GitHub proxy HTML/CSS/JS readback: PASS for `eb61ebe8302aad96425ab619a198b0cb319ec8de` precursor.
- Branch/PR isolation: PR #65 Draft / NOT merged; main stays 0.9.0-alpha.9.76.

## NOT VERIFIED / requires later engineering + PM
- Native on-device iPhone Safari portrait and landscape screenshots/touch handling.
- Real desktop landscape and portrait narrow screenshot/a11y color/contrast.
- Original Habblaud native Canvas integration and premium pixel-art fidelity.
- True TaskFlow/Co/Gem work state event sources; intentionally not connected.
- Full formal Version/Build, QA FullSource backup and PM final UI sign-off prior to replacing main.
- Production DB/Render/GitHub App migrations untouched.

No public payments, no purchasing randomness, no credentials or secrets. Economy entirely browser-local for test purposes.
