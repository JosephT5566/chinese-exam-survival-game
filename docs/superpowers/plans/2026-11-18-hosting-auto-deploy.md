# Hosting 自動發布計畫

使用者已要求合併至 main 後自動發布。沿用既有 CI 與 Firebase Hosting site，不改計分、題庫或 Firestore rules。

- [ ] 使用 Google Cloud Workload Identity Federation 與專用 Hosting service account，限制 repo／owner 數字 ID、main ref 與指定工作流程；不產生私鑰。
- [ ] 在既有 CI 增加 deploy job，needs: check，僅 main push 或 main 手動觸發可發布；相同發布序列化，PR 不授予部署權限。
- [ ] 使用鎖定套件的 Firebase CLI，只部署 hosting。於發布前建置，再取得短效身分；失敗停止。
- [ ] 檢查工作流程與 IAM 設定，更新 README 與設定紀錄，跑完整現有測試。
- [ ] 提交、push、PR、通過 CI 後 merge，追蹤 main 的第一次實際發布並檢查 Hosting URL。

驗收：PR 不部署；main 的 check 與 deploy 成功；公開 URL 取得本次產物；service account 無私鑰；只有指定 repo/main/workflow 可交換憑證。
