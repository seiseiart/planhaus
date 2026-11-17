# 築間 Planhaus

在瀏覽器中繪製牆體、房間、門窗與家具的房屋平面設計工具。

- 網站：https://seiseiart.github.io/planhaus/
- 無建置步驟的靜態網站，網站檔案在 `dist/`
- 推送到 `main` 後由 `.github/workflows/pages.yml` 自動語法檢查並部署到 GitHub Pages
- 協作說明見 `HANDOFF-CLOUD.md`
- 家具支援手動旋轉；櫃體與結構柱可輸入平面寬度／深度
- 房間外框使用 6px 粗牆線；門窗所在牆段會自動留出開口
- 門片可沿牆拖曳，放置時依拖曳方向決定內／外開；右鍵可翻轉門窗或旋轉家具
- 介面以手機／平板觸控為優先：手機與直向平板使用底部工具列及底部設定面板，橫向平板使用側邊工具列
- 選取模式可用手指拖動畫布；門窗與家具都有不依賴右鍵的觸控操作按鈕

本機預覽：`python -m http.server 8766 --bind 127.0.0.1 --directory dist`
