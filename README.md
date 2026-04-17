# 足球即時推播系統

輕量級比賽直播推播系統，操作員手動挑選訊息送給所有觀眾 widget。

## 快速開始

```bash
# 啟動伺服器（零依賴，只用 Node 內建模組）
node server.js

# 預設 port 8766，可用環境變數覆寫
PORT=9000 node server.js
```

啟動後打開瀏覽器：

| 頁面 | URL | 說明 |
|---|---|---|
| 入口 | http://localhost:8766/ | 總覽與連結 |
| 管理後台 | http://localhost:8766/admin.html | 建立比賽、推送事件 |
| 觀眾示範頁 | http://localhost:8766/demo-host.html | 第三方站台嵌入示範 |
| 直接看 widget | http://localhost:8766/widget.html?match=\<id\> | 觀眾端獨立視窗 |

## 使用流程

1. **建立比賽**：管理後台左欄 → 「＋ 新增比賽」輸入主/客隊名
2. **編輯事件**：中間欄選擇事件類型（進球/黃牌/換人…），填隊伍、球員、時間
3. **手動推送**：事件列表每一項都有「推送」按鈕，**按下才會送到觀眾**
4. **觀眾接收**：第三方站台嵌入一行 script，即時看到推送通知
5. **撤回**：已推送的事件可以「撤回」，觀眾端會同步移除

## 嵌入到其他站台

最簡單：

```html
<script src="http://your-host:8766/embed.js"
        data-match="m-xxxx-yyyy"
        data-position="bottom-right"></script>
```

可調屬性（全部選用）：

| 屬性 | 預設值 | 說明 |
|---|---|---|
| `data-match` | — | **必填**，比賽 id（從管理後台複製） |
| `data-position` | `bottom-right` | `bottom-right` / `bottom-left` / `top-right` / `top-left` / `custom` |
| `data-width` | `280` | 寬度 px |
| `data-height` | `460` | 高度 px |
| `data-offset` | `16` | 貼邊距離 px |
| `data-docked` | — | 初始化即收納：`left` / `right` |
| `data-closable` | `true` | 顯示右上角 × 關閉鈕 |

對外 API（host 頁面可呼叫）：

```js
FootballLivePush.close('m-xxxx');  // 隱藏
FootballLivePush.show('m-xxxx');   // 重新顯示
```

## 架構

```
瀏覽器（觀眾）              瀏覽器（Admin 操作員）
  widget.html                  admin.html
   │ WS 訂閱 ?match=xxx          │ REST API
   ▼                             ▼
  ┌──────────── Node.js server ──────────────┐
  │  HTTP: 靜態檔 + REST API                  │
  │  WS:   /ws?match=<id>  (房間制廣播)      │
  │  狀態: data/matches.json (自動持久化)    │
  └────────────────────────────────────────────┘
```

- **零依賴**：Node.js 原生 http / crypto，無需 `npm install`
- **房間制**：每個 `matchId` 是獨立 WS 房間，只會收到自己那場的更新
- **手動推送**：事件 `pushed` 欄位決定是否廣播；觀眾端只會看到 `pushed=true` 的事件
- **自動持久化**：每次狀態變更寫入 `data/matches.json`，重啟保留
- **自動重連**：widget 斷線 2 秒後自動重連，並重拉最新狀態

## 事件類型

`goal` ⚽ / `yellow` 🟨 / `red` 🟥 / `corner` 🚩 / `sub` 🔄 / `injury` 🩹 / `var` ⚠️ / `freekick` 🎯 / `throwin` 📥 / `kickoff` 🏟 / `halftime` ⏱ / `fulltime` ⏱ / `custom` 📣

## REST API（給需要二次開發的參考）

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/matches` | 所有比賽清單 |
| POST | `/api/matches` | 建立比賽 `{ home: { name }, away: { name } }` |
| GET | `/api/match/:id` | 單場比賽詳細（含未推送事件，供 admin 用） |
| PATCH | `/api/match/:id` | 更新比分 / 狀態 / 隊名 |
| DELETE | `/api/match/:id` | 刪除比賽 |
| POST | `/api/match/:id/events` | 建立事件 |
| PATCH | `/api/match/:id/events/:eid` | 編輯事件 |
| DELETE | `/api/match/:id/events/:eid` | 刪除事件 |
| POST | `/api/match/:id/events/:eid/push` | 推送事件給觀眾 |
| POST | `/api/match/:id/events/:eid/unpush` | 撤回已推送事件 |
| GET | `/healthz` | 健康檢查（含房間數、連線數） |

## WebSocket 訊息格式

Server → Client：

```json
{ "type": "match-state",    "data": { /* 公開的比賽狀態 */ } }
{ "type": "match-update",   "data": { /* 比分或狀態變更 */ } }
{ "type": "event",          "data": { /* 新推送的事件 */ }, "match": { ... } }
{ "type": "event-update",   "data": { /* 已推送事件內容修改 */ } }
{ "type": "event-retracted","data": { "id": "..." } }
{ "type": "match-missing",  "data": { "id": "..." } }
```

## 備註

- 目前為最小可行版本，無驗證／權限控管。正式上線前建議在 admin 路徑前加一層 proxy auth。
- `data/matches.json` 是單一檔案持久化；高流量場合應改接資料庫。
- OBS Browser Source 可以直接用 `widget.html?match=xxx`，背景是透明的。
