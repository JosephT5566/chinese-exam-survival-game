# Hosting 自動發布

## 日常更新

合併 PR 或 push 到 `main` 後，`.github/workflows/ci.yml` 先執行 rules 產生碼檢查、型別、單元測試、production build 與 Firestore Emulator 測試。通過後 deploy job 建置同一份 commit，只發布 `hosting`。PR 與其他分支沒有發布權限。

發布網址：https://chinese-exam-survival-game.web.app 。這版仍是同一瀏覽器內的本機示範，發布不等於已完成跨裝置 Firebase 整合。

在 GitHub Actions 的 `Repository checks and Hosting deployment` 可檢查執行紀錄。需要重新發布時，選 Run workflow，分支選 `main`。失敗時先看 check 或 deploy 的紅色步驟，修正後再重跑。部署會序列化，已被較新 main 提交取代的舊執行會跳過。

## 身分與權限

使用 `google-github-actions/auth` 的 Workload Identity Federation，沒有 GitHub secret 或 service account JSON 私鑰。每次工作取得短效憑證，產生的 `gha-creds-*.json` 由 action 清理，並由 `.gitignore` 排除。

| 資源 | 設定 |
| --- | --- |
| Project | `chinese-exam-survival-game` / `355829324177` |
| Service account | `github-hosting-deploy@chinese-exam-survival-game.iam.gserviceaccount.com` |
| 專案角色 | `roles/firebasehosting.admin` |
| Pool / provider | `github-hosting` / `hosting-deploy` |
| OIDC issuer | `https://token.actions.githubusercontent.com` |
| Repo / owner ID | `1462402134` / `30860126` |
| Ref | `refs/heads/main` |
| Workflow | `JosephT5566/chinese-exam-survival-game/.github/workflows/ci.yml@refs/heads/main` |
| Events | `push` 或 `workflow_dispatch` |

Pool 透過 `roles/iam.workloadIdentityUser` 允許指定 repo 身分使用專用 service account，provider 條件再限制 owner、main、workflow 與 event。只有 deploy job 可要求 GitHub ID token。service account 沒有 Firestore、Auth 管理、IAM 管理或計費角色。

管理員可用 `bash scripts/setup-hosting-identity.sh` 重現設定；重跑會沿用同名資源並更新 provider 條件及必要 binding，不建立私鑰，不移除其他身分的權限。它只啟用 IAM／IAM Credentials／STS API，不啟用計費。

## 暫停發布與回滾

暫停所有自動發布可在 GitHub Actions 停用此 workflow，這也會停用其 CI；或修改 deploy job 的 `if` 為 `false`，保留 check job。要立即撤銷雲端存取，可停用專用 provider 或撤銷此 service account 的 Hosting Admin binding。修改 workflow 檔名或 repo 所有權時，需要同步更新 provider 條件。

回滾可在 Firebase Console → Hosting → release history 選擇已知正常 release。回滾不修改 Git，後續 main 更新會再次部署；若需持續保留回滾版本，先暫停自動部署或 revert 對應程式碼。流程從不部署 Firestore rules，也不處理資料還原。
