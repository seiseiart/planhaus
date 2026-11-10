# 築間 Planhaus — Cloud 協作交接

更新日期：2026-11-10（Asia/Taipei）

## 專案識別

- 正式網站（2026-11-10 起）：https://seiseiart.github.io/planhaus/
- 原始碼：https://github.com/seiseiart/planhaus（公開，`main` 推送後由 GitHub Actions 自動部署 `dist/`）
- 舊網站（ChatGPT Sites，停止更新，僅保留搬遷提示）：https://planhaus-studio-20261109.rayark-codex-5015.chatgpt.site
- 舊 Sites 專案 ID：`appgprj_6af153112ce88191a7b0db479adaca8c`
- 公開狀態：`public`
- 應用類型：無建置步驟的靜態 HTML / CSS / JavaScript
- 網站輸出目錄：`dist/`

## 從哪裡開始

1. 完整閱讀本文件。
2. 主要介面位於 `dist/index.html`。
3. 全部視覺樣式位於 `dist/styles.css`。
4. 平面圖資料模型、SVG 繪圖與互動位於 `dist/app.js`。
5. `.openai/hosting.json` 保存 Sites 專案識別與靜態輸出目錄，修改時必須保留 `project_id`。

## 現有功能

- 房間、牆體、門窗與家具配置。
- 房間拖曳、格線吸附、復原與重做。
- 重疊房間可透過勾選通知合併為非方形多邊形。
- 雙擊房間後可拖曳角點變形。
- 房內設施會歸入房間資料夾並隨房間移動。
- 單開門、雙開門、拉門、折疊門。
- 固定窗、橫拉窗、凸窗、紗窗。
- 浴缸、馬桶、洗手台、櫃體、樓梯、結構柱等設施。
- 尺寸輸入、SVG 匯出及瀏覽器本機自動儲存。

## 資料模型重點

- 所有圖面物件存放於 `state.items`。
- 房間是 `type: "room"`；矩形以 `x/y/w/h` 表示，進入變形或合併後使用 `points: [{x,y}, ...]`。
- 門窗與家具使用 `parentRoomId` 關聯所屬房間。
- 圖面資料目前存於瀏覽器 `localStorage` 的 `planhaus-project` 鍵值。
- 不同瀏覽器與不同網域不會自動共用圖面資料。

## 本機預覽與檢查

不需安裝套件。在專案根目錄執行：

```text
python -m http.server 8766 --bind 127.0.0.1 --directory dist
```

開啟 `http://127.0.0.1:8766/`。

JavaScript 語法檢查：

```text
node --check dist/app.js
```

最低驗收項目：

1. 建立兩個重疊房間會出現合併勾選通知。
2. 不勾選時不建立新房間。
3. 勾選時產生單一非方形房間。
4. 雙擊矩形房間會出現四個角點。
5. 拖曳角點可變形，且不會與其他房間重疊。
6. 房間內不顯示個別平方公尺。
7. 門窗與家具能歸入房間並隨房間移動。
8. 主控台沒有 JavaScript 錯誤。

## Sites 發布規則

- 請勿建立新的 Sites 專案；必須沿用 `.openai/hosting.json` 的 `project_id`。
- 正式輸出為 `dist/`，其中必須包含 `index.html`。
- 原始碼更新後先推送對應提交，再以同一提交封裝與建立 Sites 版本。
- 網站目前是公開存取；除非使用者明確要求，不要改回私人或工作區限定。
- 不要在原始碼、交接檔或命令列參數中保存 Sites 存取權杖。

## 建議的下一階段

1. 將 localStorage 專案升級為可命名、可匯入／匯出的 JSON 圖面檔。
2. 增加物件旋轉控制點與牆體自動吸附。
3. 增加門窗高度、窗台高度與牆厚等建築屬性。
4. 為多邊形房間加入「新增角點」與「刪除角點」。
5. 增加列印比例、標註線及 PDF 輸出。
6. 若需要跨裝置保存，再評估加入後端資料庫與使用者登入。

## 給 Cloud 的接手提示詞

```text
你要接手「築間 Planhaus」房屋平面設計網站。請先完整閱讀 HANDOFF-CLOUD.md，保留 .openai/hosting.json 的 project_id 與既有公開網址。這是 buildless 靜態網站，主要修改 dist/index.html、dist/styles.css、dist/app.js。修改前先理解多邊形房間、parentRoomId 與 localStorage 資料模型；修改後執行 node --check dist/app.js，並逐項完成 HANDOFF-CLOUD.md 的最低驗收。不要新增外部套件、不要建立新的 Sites 專案、不要把任何憑證寫入檔案。完成後列出修改檔案、測試結果與仍待處理事項。
```

## 協作回傳方式

Cloud 完成修改後，可用以下任一方式交回：

- 回傳完整專案壓縮包；或
- 僅回傳 `dist/index.html`、`dist/styles.css`、`dist/app.js`；或
- 提供 Git 提交／差異檔。

合併前應先比較差異，避免覆蓋另一方同時進行的修改。

---

## Cloud 第一輪修改紀錄（2026-11-10）

基準：`planhaus-cloud-handoff.zip`（Git 基準提交 `Baseline: Codex handoff`）。未新增外部套件、未更動 `.openai/hosting.json`、未建立新的 Sites 專案。

### 修改檔案

| 檔案 | 類型 | 說明 |
| --- | --- | --- |
| `dist/planhaus-pro.js` | 新增 | 本輪所有新功能（約 590 行，可讀格式） |
| `dist/app.js` | 小幅修改 | 只加入擴充掛鉤與 `window.Planhaus` API、`autoRotate()`、房間清單 HTML 跳脫 |
| `dist/index.html` | 小幅修改 | 新增「圖面檔」按鈕、載入 `planhaus-pro.js`、更新快捷提示文字 |
| `dist/styles.css` | 檔尾追加 | `/* ===== Planhaus Pro 擴充 ===== */` 區塊，未改動既有規則 |

刻意把新功能放進獨立檔案，`app.js` 只改動掛鉤點，以降低與 Codex 同時修改時的合併衝突。

### `app.js` 掛鉤點

`hooks = {afterRender, itemPointerDown, pointerdown, pointermove, pointerup, keydown, place, snapPoint}`；回傳 `true` 代表已處理、後續預設行為略過。`window.Planhaus` 暴露 `state / selected / editingRoomId / tool / view` 存取器及 `commit、persist、render、snapshot、pushHistory、loadState、beginHandleDrag、getPoints、overlapsRoom、roomAt` 等內部函式。

其他 `app.js` 行為變更：

- 原本 `x.rotation = facilityRotation(room)` 四處改為 `autoRotate(x, room)`：手動旋轉（`rotationManual`）或吸附牆面（`wallRef`）的物件不再被房間形狀變更覆蓋角度。
- 房間清單的 `innerHTML` 改用 `esc()` / `safeColor()`，避免匯入 JSON 的房間名稱造成 XSS。
- 對話框開啟時不觸發工具快捷鍵；`SELECT` 輸入框也排除在快捷鍵之外。

### 新功能

1. **JSON 圖面檔**：「圖面檔」按鈕（Ctrl+O）開啟對話框：儲存到專案庫（Ctrl+S，以專案名稱為鍵，同名覆寫）、開啟／匯出／刪除（兩段式確認）、匯出 `.planhaus.json`、匯入 JSON（亦可拖放檔案到畫布）。匯入會白名單驗證欄位、重建重複 id、修正 `parentRoomId`，並可用「復原」還原。專案庫存於 `localStorage['planhaus-library']`；原本 `planhaus-project` 自動儲存不變。
2. **多邊形角點增刪**：角點編輯模式下每條邊中點顯示「＋」，拖曳即新增角點；右鍵角點、或點選後按 Delete 可刪除（至少保留 3 點，並檢查面積與重疊）。右側面板也有「刪除選取角點」。
3. **建築屬性**（右側「建築屬性」面板）：門窗 `width / height`、窗 `sill`、牆 `thickness`（預設 0.3 m＝原 12px 線寬）、房間 `ceiling`（預設 2.8 m）。開口依寬度縮放繪製；選取時顯示 W×H／窗台標註；窗台＋窗高超過天花板時提示。
4. **旋轉與牆體吸附**：選取門窗家具時出現旋轉控制點（15° 對齊，Alt 自由），`[` / `]` 鍵 ±15°，面板有 ±90° 按鈕。門窗家具現在可拖曳移動；門窗放置／拖曳時自動吸附牆體或房間邊（門片朝房內開），家具自動靠牆（植栽、柱體除外，Alt 暫停吸附）。繪製牆體時端點吸附既有牆端點與房間角點。

### 資料模型新增欄位（皆為選填，舊資料相容）

`door/window`：`width`、`height`、`sill`（窗）、`wallRef: {kind:'wall'|'room', id, edge?}`、`rotationManual`；`furniture`：`wallRef`、`rotationManual`；`wall`：`thickness`；`room`：`ceiling`。JSON 檔格式：`{format:'planhaus', version:1, project, exportedAt, units:{pxPerMeter:40}, items}`。

### 驗收結果（Playwright 自動化，Chromium）

原最低驗收 1–8 全部通過（8：除 Google Fonts 在沙箱被擋外無主控台錯誤）。新增項目通過：邊中點新增角點、Delete／右鍵刪除角點、最少 3 點、門吸附房間邊、窗吸附牆體、牆端點吸附、家具靠牆、旋轉控制點 15° 對齊、`]` 旋轉、門窗拖曳脫離牆面、窗寬縮放繪製、牆厚、JSON 匯出格式、專案庫儲存／開啟、匯入（含惡意名稱與無效物件）與復原。`node --check` 兩支 JS 皆通過。

### 仍待處理

- 既有 `polygonsOverlap` 以格點取樣判斷重疊，斜邊多邊形的細長重疊可能偵測不到（非本輪引入）。
- 房間角點變形時，吸附在房間邊上的門窗不會跟著邊移動（房間整體移動則會）。
- 匯出 SVG 未內嵌 CSS，離線開啟時樣式會遺失（既有行為）。
- 家具文字隨物件旋轉，180° 時會倒置（既有行為）。
- 下一階段：列印比例、標註線、PDF 輸出；跨裝置保存需後端。

---

## 2026-11-10 搬遷到 GitHub Pages

- 正式來源改為 GitHub repo `seiseiart/planhaus`；**請 Codex 改以 Git 提交／PR 協作，不再以壓縮包交換**。
- 部署：`.github/workflows/pages.yml`（`node --check` → 上傳 `dist/` → `deploy-pages`）。Repo 設定 Pages → Source 必須是「GitHub Actions」。
- 圖面資料存於各網域的 localStorage，不會自動跨網址。`planhaus-pro.js` 的 `CANONICAL_URL` 會在 `*.chatgpt.site` 顯示搬遷橫幅（匯出 JSON + 前往新網址）。
- **待 Codex 執行一次**：把目前 `dist/` 發布到舊 Sites 專案，讓舊使用者看到搬遷橫幅並能匯出 JSON；之後舊 Sites 不再更新。
