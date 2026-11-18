# 國文段考生存戰：命運大富翁

台灣國三國文課堂練習遊戲，目標為 30 台平板、40 題、20–30 分鐘。產品依據為 [SPEC.md](SPEC.md)。

目前是 repo 初始化版本，提供準備中頁面、TypeScript／測試工具與 Firebase 設定骨架。尚未實作作答、題庫、登入、房間、排行榜或資料刪除。Firebase 專案已綁定 `chinese-exam-survival-game`，服務設定進度見 [Firebase 初始化紀錄](docs/firebase-setup.md)。頁面尚未呼叫 Firebase SDK。

## 本機開始，Windows PowerShell 亦適用

安裝 Node.js 24 LTS 與 npm。Firestore Emulator 另需 Java JDK 21 以上。macOS 若使用 nvm，可執行 `nvm install`、`nvm use`。

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

macOS 複製環境檔改用 `cp .env.example .env.local`。開啟終端機顯示的 Vite 網址，不設定 Firebase 也能啟動。所有 `VITE_` 值會進入瀏覽器 bundle，只能放公開 Web config，不可放私鑰或學生資料。現階段環境檔僅預留，程式尚未讀取。

```powershell
npm run check
npm run test:rules
npm run emulators
```

`check` 檢查 rules 產生碼、strict 型別、初始化 smoke tests 與 production build。`test:rules` 自動啟停 Firestore Emulator，驗證老師 allowlist、房間狀態、跨學生隔離、原子計分、重複操作拒絕及完整 30 人排名快照。Emulator 使用 `demo-chinese-exam`，不需登入 Firebase、不會指向正式專案。預設 Auth 9099、Firestore 8080、Emulator UI 4000；Vite 尚未串接 Emulator。

## 目錄與下一步

原始碼在 `src/`；[初始化與後續計畫](docs/implementation-plan.md) 說明範圍及待確認決策；[架構、用量與安全限制](docs/architecture.md) 比較全班排行方案。題庫資料規範見 [題庫說明](src/questions/README.md)。

本次本機工具更新版本與相依套件 audit 結果見 [開發環境紀錄](docs/development-environment.md)。

Firestore 權限與原子寫入的 exact schema 見 [資料契約](docs/firestore-contract.md)。規則已於 2026-11-18 發布並讀回驗證；前端尚未串接這些資料操作。手動刪除功能完成前，rules 仍拒絕所有客戶端刪除。

## Firebase 設定與部署，必須另行授權

以下是未來部署操作文件，本次沒有執行。先由專案擁有者核准部署目標、正式 rules 與產品驗收。Firebase 專案須已建立 Hosting、Firestore、Anonymous／Google Auth，並建立老師 allowlist。不得為此升級 Blaze 或啟用 billing。

```powershell
npx firebase login
Copy-Item .firebaserc.example .firebaserc
# 編輯 .firebaserc 為已核准的專案 ID
npm run build
npx firebase deploy --only hosting --project YOUR_FIREBASE_PROJECT_ID
```

本機規則通過 Emulator 測試後，仍須經核准才可發布正式 rules。Hosting 指令刻意只發布靜態網站。Hosting site 已存在，但本次尚未發布遊戲或產生 QR code。

回滾：在 Firebase Console → Hosting → release history 選已知正常版本回復。Hosting rollback 不會回復 Firestore 資料或 rules；資料還原須有事先備份與獨立授權。

## 疑難排解

- 無法啟動 Vite：檢查 `node --version` 為 24，再執行 `npm ci`。
- Emulator 找不到 Java：安裝 JDK 21 以上並重新開啟終端機，以 `java -version` 確認。
- Port 被占用：停止既有 Emulator，或同步修改 `firebase.json` 與 rules 測試連線埠。
- Permission denied：須使用正確 Auth provider、老師 allowlist、membership 與原子寫入，詳見資料契約。Google 登入不會自動取得老師權限。
- 切勿提交 `.env.local`、service account JSON、存取權杖或學生資料。

## 首次課堂驗收，後續功能完成後執行

- 老師核對四個單元各 10 題，未核對前保持 `pending_source_review`。
- 2–3 台裝置確認加入、老師開始、作答、詳解、重新整理與斷線恢復。
- 確認未核准老師無法操作、跨學生無法讀寫答案、重複操作不重複計分。
- 30 台演練全班排行與讀寫量，確認老師暫停／結束行為。
- 驗證完整手動刪除巢狀資料，並提醒老師於 30 天內清理。
