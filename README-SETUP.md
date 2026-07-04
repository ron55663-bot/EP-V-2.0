# Netlify 私人試算表設定

## Google 設定

1. 在 Google Cloud 建立專案並啟用 Google Sheets API 與 Google Drive API。
2. 建立服務帳戶並產生 JSON 金鑰。
3. 將月份資料夾分享給 JSON 內的 `client_email`，權限只設為「檢視者」。
4. 不要把 JSON 金鑰放入本資料夾或上傳到 GitHub。

## Netlify 設定

1. 將本資料夾放入私人 GitHub repository，並把該 repository 連接到 Netlify。
2. 在 Netlify 開啟 Identity，Registration preferences 設為 Invite only。
3. 在 Identity > Registration > External providers 啟用 Google。
4. 邀請允許使用程式的 Google 帳號 Email；使用者直接透過 Google 登入，不需建立 Netlify 密碼。
5. 在 Project configuration > Environment variables 新增：
   - `GOOGLE_CLIENT_EMAIL`：JSON 內的 `client_email`
   - `GOOGLE_PRIVATE_KEY`：JSON 內的完整 `private_key`
6. 重新部署網站。

## 月份資料夾

- Drive folder ID：`135RnZu-d1nKdnPiysxpvCtZKlomrGwND`
- 支援現有命名：`EP儀器調度表-07月行程輸出`
- 建議未來命名：`EP儀器調度表-2026-07月行程輸出`
- 日期跨月時會自動尋找並合併兩個月份。
- 同月份有多份時，優先使用非備份且最近修改的檔案，並顯示警告。
- 找不到月份時會顯示警告，不會靜默略過。

## 讀取位置

- 讀取範圍：自動掃描月份工作表。
- 每日資料：尋找底部彙整表的「合併結果」欄位及其下方內容。
- 日期：自動配對同一彙整表內的「日期」欄位。
- 單次日期範圍：最多 10 日。

## 部署方式

此版本包含 Netlify Function，不能只把 `public` 資料夾拖曳到 Netlify Drop。請使用 Git repository 連接 Netlify，或使用 Netlify CLI 部署整個資料夾。
