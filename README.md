# 國文段考生存戰：命運大富翁

台灣國三國文課堂練習遊戲，目標為 30 台平板、40 題、20–30 分鐘。產品依據為 [SPEC.md](SPEC.md)。

提供 Firestore 雲端教室與本機示範。老師以 Google 登入，經管理員白名單授權後開房；學生以匿名身分輸入房間碼加入。老師可開始、暫停、恢復、結束及封存教室。學生的答案與詳解分數以交易保存，重新整理可接續原有進度，其他裝置則無法取回匿名帳號。老師與學生使用分離的 Auth 儲存，老師登入不會取代另一分頁的學生身分。

40 題教材仍待老師校對，命運事件每三題提示解鎖，這版不計分。自己的分數在伺服器確認後更新；老師控制台開啟且排名有變更時，約每 10 秒發布最多 30 人的全班快照。老師離線或關閉控制台後，排行榜保留最後更新時間。結束與封存會補發最終排名；平時的 10 秒限制以交易協調，避免多個老師分頁重複發布。

## 本機開發

安裝 Node.js 24 與 npm。Firestore Emulator 另需 Java JDK 21 以上。

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Windows PowerShell 的複製指令為 `Copy-Item .env.example .env.local`。開發設定全部留白時使用本機示範；也可隨時用 `?demo=1` 強制進入示範，預設房間碼 `DEMO01`。示範資料只存在瀏覽器，不會遷移到 Firestore。

要開發雲端流程，將 `.env.local` 設為：

```dotenv
VITE_FIREBASE_EMULATORS=true
VITE_FIREBASE_PROJECT_ID=demo-chinese-exam
```

在不同終端執行 `npm run emulators` 與 `npm run dev`。只連接本機 Auth 9099 與 Firestore 8080，不會連接正式資料庫。Emulator UI 在 http://127.0.0.1:4000 。若沿用正式設定，請把 project ID 一起改成上述 demo ID，錯配會阻止啟動。

老師控制台 `?view=teacher` 的 Google 登入會開啟模擬登入視窗。首次登入後先以管理工具授權，再按「重新檢查授權」。學生由老師分享的連結加入。以不同瀏覽器 context 或無痕視窗模擬多位學生；同一瀏覽器的一般分頁共用同一位匿名學生。

## 老師授權

Google 登入不等於老師權限。老師資格以已驗證 Google email 比對 Firestore 的 `teacherEmails/{小寫email}.authorized == true`，不再比對 `teachers/{uid}`。管理員可以先加入 email，老師第一次登入即可使用。教室擁有者與學生身分仍用 UID，不重建既有教室資料；同一 email 換成另一個 UID 不會繼承舊教室。

### 透過 GitHub vars 管理

在 repository Settings → Secrets and variables → Actions → Variables 新增 `TEACHER_EMAILS`，值是 JSON array：

```json
["teacher1@example.com", "teacher2@example.com"]
```

最多 100 個地址，去除前後空白並轉為小寫；不合併 Gmail 的點號或 `+` 別名。這是完整名單，部署會撤銷不在陣列內的 email 授權。缺少、空字串或無效值會停止部署，不寫入；只有明確的 `[]` 才會撤銷所有 email 授權。名單不放入 `VITE_*` 或網站 bundle，但 repository vars 不是 secret，擁有相應 repository 權限的人可查看。

變更 vars 不會自動觸發 workflow，需在 Actions 對 `main` 執行 Run workflow，或隨下次 main 更新部署。首次啟用前，管理員需依 [Hosting 部署設定](docs/hosting-auto-deploy.md)補足部署帳號權限，並把所有既有老師 email 列入 vars。不要將實際老師名單貼到公開 Issue／PR。

### 管理員手動授權

在專案目錄使用已登入的 `gcloud` 管理員身分執行，不需老師先登入，不需 Firebase Auth 查詢權限：

```sh
# 預覽，不寫入
node scripts/authorize-teachers.mjs --project chinese-exam-survival-game --email teacher@example.com
# 確認後授權；保留其他 email 授權
node scripts/authorize-teachers.mjs --project chinese-exam-survival-game --email teacher@example.com --apply
```

`--email` 可重複指定，最多 10 位；整個 collection 上限為 100 份文件。工具只輸出變更數量，不輸出 email 名單或憑證。預設 dry-run，`--apply` 才寫入。需要 Firestore 讀寫與 transaction IAM 權限，客戶端不能自授權。

也可由管理員在 Firebase Console 建立 `teacherEmails` collection，以小寫 email 作為文件 ID，新增 Boolean 欄位 `authorized: true`。撤銷可刪除該 email 文件或改為 false。已登入老師會收到授權變更；正式 rules 的變更傳播與 token 更新並非瞬時。

手動變更也要同步更新 GitHub vars，否則下次部署將以 vars 覆蓋名單。管理工具可用環境中的 `TEACHER_EMAILS` 加 `--sync-env` 預覽完整同步，加 `--apply` 套用；`--validate-env` 僅離線驗證格式，不取得憑證或存取資料。

Emulator 測試加 `--emulator` 並使用 `--project demo-chinese-exam`。這時只存取本機 Firestore，不取得正式憑證。不要將管理員 token、service account 私鑰或學生資料放入程式庫。

## 驗證

```sh
npm run check
npm run test:rules
npm run test:integration
npx playwright install chromium
npm run test:browser
```

`check` 包含 rules 產物一致性、strict TypeScript、單元測試及正式 build。`test:rules` 驗證完整權限邊界；`test:integration` 啟動 Auth 與 Firestore Emulator，用真實 SDK 測試開房、加入與恢復、並發作答及詳解不重複領分、私人資料隔離、排名、生命週期與管理員授權工具。Emulator 指令皆固定使用 demo project。瀏覽器測試以同一瀏覽器的老師／學生分頁走完 40 題，包含刷新、最後詳解領分、排行與示範導覽。若要使用本機 Chrome，可設定 `PLAYWRIGHT_CHROME_PATH` 為執行檔絕對路徑。

## 正式 build 與部署

`.env.production` 刻意追蹤四個公開 Firebase Web SDK 設定，讓 CI build 能接上正確專案；這些值會進入瀏覽器，權限由 Firestore rules 決定。`.env.local` 仍不追蹤，且本機值優先。正式專案為 `chinese-exam-survival-game`，狀態見 [設定紀錄](docs/firebase-setup.md)。

GitHub Actions 在 PR 執行所有檢查；合併或 push 至 `main` 後，使用 OIDC 短效憑證同步老師 email 白名單、發布 Firestore rules，再部署 Hosting。開 PR 不會操作正式資料或發布，也不會更改計費。[部署設定](docs/hosting-auto-deploy.md)說明重跑與停用方式。

手動發布需有授權並確認本機 `.env.local` 未蓋過正式設定：

```sh
npm ci
npm run check
npx firebase deploy --only hosting --project chinese-exam-survival-game
```

發布後網站為 https://chinese-exam-survival-game.web.app 。手動 `--only hosting` 不會同步白名單或發布 rules。Hosting rollback 不會回復 Firestore 資料或 rules。

## 限制與課堂驗收

- 這是形成性課堂練習。答對與否由前端計算，答案可被檢視，並非防作弊考試系統。
- 現有 rules 未強制 30 人上限；老師頁會提示超額，排名固定顯示前 30 人。開始後不接受新學生。
- 斷線時停止送出新答案；收到伺服器確認前不顯示已保存。若訂閱失敗，恢復連線後可重新整理以恢復進度。
- 老師可封存，客戶端仍禁止刪除資料；完整巢狀清理與 30 天保留政策尚未實作。
- 上課前核對四單元各 10 題，以 2–3 台真實裝置驗收登入、加入、作答、詳解、刷新與斷線，再進行 30 台課堂壓測。

資料欄位與原子操作見 [Firestore 資料契約](docs/firestore-contract.md)，架構背景見 [架構紀錄](docs/architecture.md)，題庫規範見 [題庫說明](src/questions/README.md)。

## Agent 開發流程

採用 Issue-first workflow，操作見 [Agent workflow](docs/agent-workflow.md)，專案規則與驗證矩陣見 [AGENTS.md](AGENTS.md)。先以 `issue-enhance` 整理規格；UI 變更經 `ui-design-gate` 選定方案，owner 確認並加上 `ai-ready` 後，由 `implement-from-issue` 實作、`verify` 驗證、另一個 session 以 `review-pr` 審查。專案導覽與文件維護使用 `chinese-exam-guide`。

Issue／PR 範本放在 `.github/`，skills 放在 `.agents/skills/`。流程不會自行啟動；`ai-ready` label、branch protection 與 required checks 需由 repository owner 在 GitHub 設定。Agent 不合併 PR，owner 合併至 `main` 後可能觸發現有 Hosting 自動部署。
