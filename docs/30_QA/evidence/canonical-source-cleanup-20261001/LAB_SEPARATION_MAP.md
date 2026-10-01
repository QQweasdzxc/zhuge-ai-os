# Lab Separation Map — 2026-10-01

External Lab root: `/Users/qq/Documents/GitHub/zhuge-labs/`

```text
zhuge-labs/
├── investment/
│   ├── genspark-stock-ai/                 # existing, unchanged
│   └── fubon-readonly-proof/              # relocated from AIOS
│       ├── .github/workflows/fubon-readonly-proof.yml
│       └── tools/fubon-readonly-adapter/
├── skyeye/
│   └── jimmy-runtime-clone/               # relocated standalone candidate
└── archive/
    └── repo-hygiene-tools-2-at-7c49182/
        └── tools 2/                       # nine legacy utilities, Git-blob verified
```

## Lab inventory

| Lab / material | Source authority | Current location / status | Separation decision |
|---|---|---|---|
| Genspark Stock AI | `https://github.com/dvorak0727/Genspark-Stock-AI` | `/Users/qq/Documents/GitHub/zhuge-labs/investment/genspark-stock-ai/`; both `upstream-original` and `working-copy` are clean at `35182db578b0b8c693d34f52f3988534d4c52f83`. | No code changes. Observed SHA differs from older requested freeze `fc05eed2fb28a1421392234fcd247389d13471e1`; preserve and report, do not silently reset. No VIP/license work in this task. |
| SkyEye Jimmy/God's Eye candidate | AIOS source snapshot at `248b1f78e043886976e135681ed9d8f149eb078b` | `/Users/qq/Documents/GitHub/zhuge-labs/skyeye/jimmy-runtime-clone/` | Entire tracked `skyeye-next/` tree moved and compared byte-for-byte. Provider experiments and MIT upstream source within that app move with it. Production `modules/skyeye/` and `supabase/functions/zhuge-skyeye-read/` remain in AIOS. |
| Fubon read-only SDK proof | AIOS source snapshot at `248b1f78e043886976e135681ed9d8f149eb078b` | `/Users/qq/Documents/GitHub/zhuge-labs/investment/fubon-readonly-proof/` | Adapter and manual proof workflow moved together. No Login, credential access, Secret copy, or Product Data operation occurred. Existing screenshot-import provenance labels in canonical Investment were not removed. |
| `tools 2` legacy utilities | Git commit `7c49182f4f260bd87edc94362378a25859a1df2a` | `/Users/qq/Documents/GitHub/zhuge-labs/archive/repo-hygiene-tools-2-at-7c49182/tools 2/` | Nine unique utilities preserved; all nine file contents match their Git blob IDs. No AIOS runtime/import/test/build reference was found. |
| Gloomberb original evaluation | Separate upstream clone at `62317c477c1ef9b8394a12eac971c5546441b76e` | Outside AIOS at `/Users/qq/Documents/Gloomberb Original Runtime Evaluation/upstream/` | Already separated; clean and unchanged. |
| Gloomberb Taiwan provider spike | Separate external spike with runtime cache/config/dependencies | `/Users/qq/Documents/Gloomberb Taiwan Provider Spike/` | Remains outside AIOS and untouched; not consolidated because runtime state and provenance are distinct. |
| Other upstream/evaluation folders | Separate evaluation directories outside formal AIOS repository | `/Users/qq/Documents/Zhuge AI OS/`, `/Users/qq/Documents/Gods Eye View Original Runtime Evaluation/`, `/Users/qq/Documents/Genspark Stock AI Original Runtime Evaluation/` | Evidence workspaces remain untouched; they are not copied into formal AIOS. |

## Registry and Lab Center boundary

`labs/registry.json` remains the only AIOS Lab catalog and currently contains the existing Genspark entry (`EXPERIMENT`, `PM_REVIEW`). It was not changed. `modules/labs/` remains the one shared `Lab 實驗室` navigation surface and does not import or bundle Lab source.

The current Lab Center has a Genspark-specific launch recipe. Adding SkyEye/Fubon entries now would imply a working generic launch contract that does not exist. They are therefore separated and documented, but not shown as runnable Lab Center entries. A generic launcher/registry adoption is a separate product task, not part of source cleanup.
