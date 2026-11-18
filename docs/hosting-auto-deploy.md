# Hosting、rules 與老師白名單自動發布

## 日常更新

合併 PR 或 push 到 `main` 後，`.github/workflows/ci.yml` 先執行 `npm run check`、rules／integration Emulator 測試與瀏覽器測試。通過後 deploy job 建置同一份 commit，確認仍是最新 main，再依序執行：

1. 離線驗證 GitHub repository variable `TEACHER_EMAILS`。
2. 取得 OIDC 短效憑證。
3. 將完整 email 名單原子同步到 Firestore `teacherEmails` collection。
4. 以 `firebase deploy --only firestore:rules` 發布 repository rules。
5. 以 `firebase deploy --only hosting` 發布網站。

PR、其他分支及已被更新的 main commit 不執行正式同步／部署。deploy job 使用既有 concurrency group 序列化且不取消進行中的部署。發布網址：https://chinese-exam-survival-game.web.app 。目前網站包含本機示範與 Firestore 雲端教室。

在 Actions 的 `Repository checks and Hosting deployment` 查看執行紀錄。要重跑，選 Run workflow，分支選 `main`。修改 vars 本身不會觸發部署。失敗時先看紅色步驟，修正設定後重跑，不需要建立重複白名單文件。

## 設定名單與首次切換

在 Settings → Secrets and variables → Actions → Variables 設定 `TEACHER_EMAILS`：

```json
["teacher1@example.com", "teacher2@example.com"]
```

這是完整名單，最多 100 筆，會 trim／轉小寫／去重。部署會授權指定地址並刪除未列入的 email 授權文件。JSON `[]` 明確表示撤銷全部老師資格；缺值、空字串、錯誤格式會在正式寫入前停止。名單由 step env 傳給 Node 工具，不直接插入 shell 指令，不進入前端 `VITE_*`。GitHub vars 不是 secrets，具相應 repository 權限的人能查看。

首次切換前：

1. 將所有應保留資格的老師 email 納入 vars。老師不必先登入。
2. 由專案管理員檢查下列權限範圍，再執行更新後的 `bash scripts/setup-hosting-identity.sh`。
3. owner 核准合併後執行 main workflow，確認同步、rules 與 Hosting 步驟成功。
4. 使用已授權 Google 帳號驗證教師登入，未授權帳號應停留在等待授權頁，再確認既有教室仍屬相同 UID。

Firestore 沒有 SQL table migration。本次新增 `teacherEmails/{小寫email}`，文件為 `authorized: true`；原有 rooms、players、答案與 ownerUid 都保留。舊 `teachers/{uid}` 文件可以留存，但新 rules 不再用它授權。不要在公開 Issue／PR 貼實際老師名單。

## 身分與權限

使用 `google-github-actions/auth` 的 Workload Identity Federation，沒有 service account JSON 私鑰。action 產生的 `gha-creds-*.json` 由 action 清理並由 `.gitignore` 排除。同步工具透過 action 的 `access_token` output 取得短效 token，不將其寫入 repo 或日誌。

| 資源                               | 設定                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| Project                            | `chinese-exam-survival-game` / `355829324177`                                     |
| Service account                    | `github-hosting-deploy@chinese-exam-survival-game.iam.gserviceaccount.com`        |
| Hosting                            | `roles/firebasehosting.admin`                                                     |
| Firestore transactions、讀寫與刪除 | `roles/datastore.user`                                                            |
| Rules 發布                         | `roles/firebaserules.admin`                                                       |
| Firebase 專案查詢                  | `roles/firebase.viewer`                                                           |
| API 用量授權                       | `roles/serviceusage.serviceUsageConsumer`                                         |
| Pool / provider                    | `github-hosting` / `hosting-deploy`                                               |
| OIDC issuer                        | `https://token.actions.githubusercontent.com`                                     |
| Repo / owner ID                    | `1462402134` / `30860126`                                                         |
| Ref                                | `refs/heads/main`                                                                 |
| Workflow                           | `JosephT5566/chinese-exam-survival-game/.github/workflows/ci.yml@refs/heads/main` |
| Events                             | `push` 或 `workflow_dispatch`                                                     |

表列角色是更新後 setup script 的目標，這次實作未操作正式 IAM，不能視為已套用。`roles/datastore.user` 可讀寫整個 Firestore 資料庫，並非只限老師白名單；rules 不限制 IAM 管理端。Rules Admin 可發布整個專案的 rules。這是相較舊版 Hosting-only 部署新增的權限，需管理員明確執行設定。部署身份仍不具 Firebase Auth 管理、IAM 管理或計費管理角色。

Pool 透過 `roles/iam.workloadIdentityUser` 允許指定 repo 使用部署帳號，provider 再限制 owner、main、workflow 與 event。只有 deploy job 可要求 GitHub ID token。

更新後的 setup script 會重用既有資源、更新 provider 條件並補足 binding，不建立私鑰、不移除其他身分的權限，也不啟用計費。它會啟用 IAM／IAM Credentials／STS／Firestore／Firebase Rules API；不要在未經授權的環境執行。

參考 [OIDC action](https://github.com/google-github-actions/auth)、[Firestore IAM](https://firebase.google.com/docs/firestore/security/iam)及 [rules 發布](https://firebase.google.com/docs/firestore/security/get-started#deploying_rules)。本機檢查與 Emulator 無法驗證正式 IAM 是否足夠，首次發布仍需確認 Actions 結果。

## 失敗處理與回滾

Firestore 同步在單一 transaction 中以每頁 50 份查詢，再一次提交，避免分批授權造成部分結果。超過 100 份現有文件會停止，不截斷名單；請由管理員檢查後處理。單次失敗不自動無限重試，transaction conflict 可以重跑 workflow。手動 `--email` 授權也需更新 vars，否則下次部署會被完整名單取代。

資料同步、rules 與 Hosting 彼此沒有跨服務原子性：

- 同步失敗：後續 rules／Hosting 不執行。若 commit 回應因網路中斷而不確定，重跑會重新讀取狀態並收斂至同一名單。
- 同步成功、rules 失敗：email 名單已更新，網站仍是舊版。修正 rules 權限或發布問題後重跑。
- rules 成功、Hosting 失敗：新版 rules 已生效，舊網頁的 UID 授權讀取可能失敗。儘快重跑以完成對應 Hosting，或由管理員回復先前 rules。
- 首次切換存在舊頁面／新 rules 的短暫不相容；請避開上課時段。依 Firebase 文件，新查詢的 rules 更新可能需約一分鐘，既有 listener 最長可能需十分鐘；發布完成後請重新整理網頁再驗證。

Hosting rollback 不回復 rules、白名單或資料。要回滾授權，需由管理員獨立處理 rules 版本及對應授權資料；不要只回滾網站或盲目清空 collection。保留舊 UID 文件便於管理員評估回復，但新版不讀取它們。後續 main 部署仍會套用目前 vars 與 repo rules。

## 暫停發布

在 Actions 停用 workflow 會連 CI 一起停用；或將 deploy job 的 `if` 設成 `false` 保留 checks。要立即撤銷部署帳號存取，可停用 provider 或由管理員撤銷對應 IAM binding。只撤 Hosting Admin 不會撤銷新增的 Firestore／rules 權限。修改 workflow 路徑或 repo 所有權時須同步更新 provider 條件。
