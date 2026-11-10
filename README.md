# 築間 Planhaus

在瀏覽器中繪製牆體、房間、門窗與家具的房屋平面設計工具。

- 網站：https://seiseiart.github.io/planhaus/
- 無建置步驟的靜態網站，網站檔案在 `dist/`
- 推送到 `main` 後由 `.github/workflows/pages.yml` 自動語法檢查並部署到 GitHub Pages
- 協作說明見 `HANDOFF-CLOUD.md`

本機預覽：`python -m http.server 8766 --bind 127.0.0.1 --directory dist`
