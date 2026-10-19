# P3 人員動態資料契約

此契約供 PR #69 的隔離 P3 測試頁使用，不是正式 TaskFlow API 或正式像素辦公室的接入宣告。PR #65 僅是早期人員面板設計與歷史快照的來源，不是目前契約或即時狀態的權威。

## 角色分類

| ID | 名稱 | kind | 狀態來源規則 |
|---|---|---|---|
| `pm` | PM | `operator` | 沒有具來源及時效的手動紀錄時顯示未知 |
| `co` | Co | `agent` | 只接受短效確認交接或明確指派紀錄 |
| `gem` | Gem | `agent` | 只接受短效確認交接或明確指派紀錄 |
| `gpt` | GPT | `agent` | 只接受短效確認交接或明確指派紀錄 |
| `betty` | Betty | `resident` | 只顯示虛擬生活活動，不代表真人工作或位置 |
| `anan` | 安安 | `resident` | 只顯示虛擬生活活動，不代表真人工作或位置 |
| `kaka` | 卡卡 | `resident` | 只顯示虛擬生活活動，不代表真人工作或位置 |

## Evidence shape

```json
{
  "roles": [{
    "id": "co",
    "name": "Co",
    "kind": "agent",
    "role": "首席工程師",
    "description": "...",
    "visualActivity": null,
    "statusEvidence": {
      "label": "短效狀態文字",
      "sourceType": "confirmed_handoff",
      "sourceUrl": "https://github.com/QQweasdzxc/zhuge-ai-os/pull/69",
      "updatedAt": "ISO-8601",
      "ref": "PR #69",
      "taskId": null,
      "freshnessMs": 0,
      "validUntil": "ISO-8601",
      "state": "working"
    },
    "events": []
  }],
  "events": [],
  "refreshedAt": "ISO-8601",
  "sourceStatus": {
    "taskflow": "not-connected",
    "handoff": "fresh|stale|no-current-record|unavailable",
    "github": "fresh|partial|empty|snapshot|unavailable"
  }
}
```

`personnel-handoff.json` is an explicit, time-limited manual handoff snapshot. It must use a GitHub source link, an ISO timestamp, a valid agent ID, and an expiry no longer than one hour after `updatedAt`. Expired evidence remains a historical event with `freshness: stale`; it cannot set the current status.

## Read-only source behavior

- The isolated PR #69 page reads only its local handoff JSON and public GitHub REST resources for the explicitly configured review PR, commits, issue comments and check runs. Public GitHub API refreshes are cached for five minutes to avoid exhausting the unauthenticated 60-request/hour allowance.
- If the browser cannot reach GitHub, a static snapshot is eligible only when its pinned PR number matches the explicitly configured PR. The repository snapshot is pinned to PR #65, so it is not eligible for PR #69 and must never replace PR #69's live status. When eligible, the read-only historical snapshot pins its exact PR head and verification time, and events remain unattributed; it never identifies an individual engineer.
- Requests omit credentials. No GitHub token, browser session, TaskFlow token, Supabase key, or private data is sent or read.
- TaskFlow remains explicitly `not-connected` until a separately authorized read-only interface exists. This P3 code does not probe or bypass TaskFlow gates.
- GitHub author identity, commit activity, animation, timestamps, or an empty queue are never used to infer that Co, Gem, GPT, or PM is working, idle, waiting, or in a meeting.
- GitHub events are shown as unattributed source events unless an explicit, valid handoff record maps a specific agent to an activity.
- If a source is unavailable, malformed, stale, or points outside this repository's `github.com/QQweasdzxc/zhuge-ai-os/` path, the page shows no current verified status. It must not substitute fixture/demo data.

## Residents and motion

Betty, 安安 and 卡卡 have `kind: resident`. Their room movement, reading, lounging and interactions are decorative virtual activity only. The UI labels this distinction and does not link resident animation to a real person's location, work, TaskFlow or GitHub activity.
