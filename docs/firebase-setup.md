# Firebase 初始化紀錄

2026-11-18，依使用者指定的 project number `355829324177` 操作。

| 項目           | 設定                                                                  |
| -------------- | --------------------------------------------------------------------- |
| Project ID     | `chinese-exam-survival-game`                                          |
| Project number | `355829324177`                                                        |
| Firestore      | `(default)`，`FIRESTORE_NATIVE`，`STANDARD`                           |
| Firestore 區域 | `asia-east1`，台灣                                                    |
| 免費資格       | 建立回應 `freeTier: true`；Billing API 已確認 `billingEnabled: false` |
| PITR           | 停用                                                                  |
| Hosting site   | `chinese-exam-survival-game`，沿用既有預設 site                       |
| Web App        | `chinese-exam-survival-game-web`                                      |
| Web App ID     | `1:355829324177:web:ab11e8c68a277ceb192230`                           |

本機 `.firebaserc` 綁定正式專案，`.env.local` 保存公開 Web SDK config，兩者均由 `.gitignore` 排除。`firebase.json` 明確指定 Hosting site。模擬器指令仍強制使用 `demo-chinese-exam`。

Firestore 區域無法原地更換。初始化階段沒有寫入學生資料或發布網站；正式 rules 後續經授權發布，見下方紀錄。網站入口預計使用 `https://chinese-exam-survival-game.web.app`，尚不代表遊戲已發布。

已重讀資料庫管理狀態，確認建立成功。未登入的 Firestore REST 讀取回傳 HTTP 403、`PERMISSION_DENIED` 與 `Missing or insufficient permissions.`，確認沒有公開讀取資料。

## 正式 rules 發布紀錄

使用者於 2026-11-18 核准發布，僅執行 `firebase deploy --only firestore:rules --project chinese-exam-survival-game`，未發布 Hosting 或變更 billing。

- 發布時間：`2026-11-18T07:26:01.945206Z`。
- Ruleset：`667228d6-2103-4df5-a4ba-b8d44ab1a988`。
- SHA-256：`0726d79d72ba88c77ee399bc998573cde6f5ca1ce8ea13a872917e9d3e17bb6a`。
- 發布前 62 項 Emulator rules 測試通過，正式編譯成功。
- 發布後讀回 release 與 ruleset，確認 source 與本機 `firestore.rules` 完全一致；未登入列舉房間仍回傳 403。

資料契約見 `docs/firestore-contract.md`。尚未建立老師 allowlist、串接前端或完成清理功能。

## Authentication

專案擁有者已於 Console 完成首次初始化。接著啟用 Anonymous provider，並透過管理 API 重新確認 Google provider 已啟用且有 OAuth client 設定。本次沒有呼叫需 billing 的 `identityPlatform:initializeAuth` API，也沒有升級方案。

已確認 authorized domains 包含 `localhost`、`chinese-exam-survival-game.firebaseapp.com`、`chinese-exam-survival-game.web.app`。

此次驗證服務設定，尚未實作前端登入或執行 Google 互動登入。Google 登入不代表有老師權限，`teachers/{uid}` allowlist 由管理員另行建立。

## 重查指令

```powershell
npx firebase firestore:databases:list --project chinese-exam-survival-game
npx firebase hosting:sites:list --project chinese-exam-survival-game
npx firebase apps:list WEB --project chinese-exam-survival-game
npm run test:rules
```

部署、正式 rules 發布與計費變更需另行授權。

## 前端串接

Firestore client PR 實作了 Google／匿名登入、房間與原子計分及排名。管理員工具 `scripts/authorize-teachers.mjs` 預設 dry-run，需明確加 `--apply` 才授權既有 Google 使用者。兩位指定老師尚待首次登入與管理員授權；本次開發只操作 demo Emulator，沒有變更正式 allowlist、rules 或 Hosting。操作步驟見根目錄 README。

## Email 白名單版本

上述設定與發布紀錄屬歷史狀態。本次 repository 改用 `teacherEmails/{小寫email}.authorized`，不再需要老師先登入才能授權，也不再查 Firebase Auth email→UID。教室的 `ownerUid` 仍保留。正式切換前須將既有老師的 email 納入 GitHub vars 的 `TEACHER_EMAILS`，並由管理員擴充部署身份的 Firestore／rules 權限。

本次實作僅以 demo Emulator 與本機瀏覽器驗證，不修改正式 IAM、白名單或 rules。實際發布後需另行核對。操作與失敗處理見 [Hosting 部署設定](hosting-auto-deploy.md)及根目錄 README。
