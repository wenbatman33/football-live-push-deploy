# 部署到 Glitch（免費快速測試）

整個專案零依賴，Glitch 上部署只需把 `footballLivePush/` 裡的檔案放上去就能跑。

---

## 最快做法：上傳 zip

1. 在這台電腦打包 zip（會比逐檔上傳快很多）
   ```bash
   cd /Users/batman_work/claude/apps/xenoTactic/.claude/worktrees/elegant-mclean-435f8b/footballLivePush
   zip -r /tmp/football-live-push.zip . -x "data/matches.json"
   ```
   （順便排除本地已累積的測試比賽，上線後從乾淨狀態開始）

2. 到 https://glitch.com 註冊 / 登入

3. 右上角 **New Project** → 先選 `glitch-hello-node`（隨便挑一個 Node 模板）

4. 進入編輯器後：
   - 左側檔案列點 `…` → **Upload a folder** 或 **Import from GitHub**
   - 或打開 Glitch 的 terminal（左下角 Tools → Terminal）：
     ```bash
     rm -rf * .* 2>/dev/null
     wget https://你的/football-live-push.zip
     unzip football-live-push.zip
     refresh
     ```
     （你也可以不用 wget，改用 Glitch 內建的 Upload 拖拉）

5. 上傳完 Glitch 會自動重啟，看到 `足球即時推播伺服器啟動` 就是成功

6. 右上 **Share** → **Live site** 拿到 URL，例如：
   - `https://xxx.glitch.me/admin.html`
   - `https://xxx.glitch.me/demo-host.html`

---

## 另一做法：從 GitHub 匯入

如果已經把 `footballLivePush/` 推到一個 GitHub repo 的**根目錄**：

1. Glitch → New Project → **Import from GitHub**
2. 貼 repo URL（例如 `https://github.com/batman/football-live-push`）
3. 等它自動 clone + npm install（其實沒 deps） + 啟動

注意：Glitch 要求 `package.json` 在 repo 根，所以如果你的 repo 長這樣：
```
xenoTactic/
  footballLivePush/
    server.js
    package.json
    ...
```
這樣**不能直接匯入**，要單獨把 `footballLivePush` 做成一個新 repo。

---

## 部署後會自動運作

- `process.env.PORT` 由 Glitch 給，server.js 已支援 ✅
- HTTPS / WSS 由 Glitch 自動包，widget 會用 `wss://` 連線 ✅
- WebSocket 不用特別設定，Glitch 的 proxy 直接轉發 ✅

---

## 注意事項

- **免費方案 5 分鐘沒人訪問會休眠**，重新打開頁面要 10–30 秒喚醒（UptimeRobot / cron-job 之類可以做定時 ping 保持醒著，但 Glitch 有禁止「keep awake」的條款，不建議長期這樣做）
- **資料持久性**：Glitch 上 `data/matches.json` 會寫入並保留；但如果你 remix 專案就會重置。想要更私密可改存到 `.data/` 資料夾（Glitch 把 `.data/` 當 private storage 不會被 remix 帶走）
- **免費專案最多 1000 小時/月**、靜態 URL 在你的帳號下會記錄

## 演示用 URL 模板

部署完後，分享這些連結給要看的人：
- 操作員管理後台：`https://<projectname>.glitch.me/admin.html`
- 第三方站台示範：`https://<projectname>.glitch.me/demo-host.html`
- 單場觀眾 widget：`https://<projectname>.glitch.me/widget.html?match=<matchId>`
- 一行嵌入代碼：
  ```html
  <script src="https://<projectname>.glitch.me/embed.js" data-match="<matchId>"></script>
  ```
