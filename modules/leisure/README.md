# 休閒小站 Module

休閒小站是 Zhuge AI OS 裡獨立的低風險遊戲容器。它沿用既有
ZhugeSharedNavigation、ZhugeSharedShell 與 Appearance runtime，但不擁有
Identity、Session、Supabase 或其他模組的資料。

```text
modules/leisure/
├── config/game-registry.js       # 可用/未來遊戲的最小 registry
├── games/silkworm/
│   └── silkworm-game.js          # 天蠶變規則、Canvas、輸入與 lifecycle
├── leisure-runtime.js             # Container / game module bridge
├── leisure.css                    # 休閒小站與遊戲內容樣式
└── index.html                     # 同一個 Zhuge AI OS content entry
```

第一版只啟用天蠶變。五子棋與數獨只有 disabled registry metadata，尚未
載入或實作任何遊戲 runtime。
