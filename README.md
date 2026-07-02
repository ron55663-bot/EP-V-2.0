# Line 儀器行程產生器

這是一個純前端網頁工具，可以直接部署成公開網站，不需要伺服器或資料庫。

## 最簡單公開方式

### GitHub Pages

1. 建立一個新的 GitHub repository。
2. 上傳這個資料夾內的所有檔案：
   - `index.html`
   - `styles.css`
   - `app.js`
   - `.nojekyll`
3. 到 repository 的 `Settings` -> `Pages`。
4. Source 選擇 `Deploy from a branch`。
5. Branch 選擇 `main`，資料夾選擇 `/root`。
6. 儲存後等待 1 到 3 分鐘，GitHub 會提供公開網址。

### Netlify

1. 到 Netlify 新增網站。
2. 選擇手動上傳。
3. 把這個資料夾整包拖曳上傳。
4. Netlify 會立即產生公開網址。

## 使用方式

打開公開網址後，貼上原始行程資料，按「產生訊息」即可輸出北區與中南區 Line 訊息。

## 注意

目前版本所有資料只在使用者瀏覽器內處理，不會上傳到任何伺服器。
