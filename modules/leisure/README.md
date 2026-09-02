# 休閒小站 Module

休閒小站是 Zhuge AI OS 裡獨立的低風險遊戲容器。它沿用既有
ZhugeSharedNavigation、ZhugeSharedShell 與 Appearance runtime，但不擁有
Identity、Session、Supabase 或其他模組的資料。導覽上隸屬「系統」區，與
其他 Workspace 保持一致。

```text
modules/leisure/
├── config/game-registry.js          # 四款遊戲的最小 registry
├── games/territory/                 # 天蠶變：圈地玩法
│   └── territory-game.js
├── games/snake/                     # 貪食蛇：經典成長玩法
│   └── snake-game.js
├── games/gomoku/                    # 五子棋：本機雙人
│   └── gomoku-game.js
├── games/sudoku/                    # 數獨：本機單人
│   └── sudoku-game.js
├── leisure-runtime.js               # Container / game module bridge
├── leisure.css                      # 休閒小站與遊戲內容樣式
└── index.html                        # 同一個 Zhuge AI OS content entry
```

目前四款遊戲皆可在本機 Runtime 操作，不建立 Cloud Save、排行榜或多人
服務：天蠶變是圈地挑戰、貪食蛇是 Nokia 風格經典玩法，五子棋是本機
雙人，數獨使用內嵌有效題目。
