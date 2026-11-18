# Firebase 整合邊界

`config.ts` 驗證公開設定，`runtime.ts` 初始化 SDK 並在任何操作前連接 Emulator。
老師與學生使用不同名稱的 Firebase app，保留各自的登入身分。

`model.ts` 在讀取邊界驗證題庫版本、固定排列、答案與排名快照。
`classroom.ts` 實作 room/code batch、加入與恢復、原子答案及詳解領分、
擁有者查詢與私人／公開訂閱。UI 在 `src/app/cloud.ts`，本機示範在
`src/app/demo.ts`，不與正式資料混用。

Firestore rules 與精確欄位見 `docs/firestore-contract.md`。
管理員可在老師首次登入前建立 `teacherEmails/{小寫email}`，內容為 `authorized: true`。rules 驗證 Google provider 與已驗證的 token email；教室所有權仍使用 UID。部署由 GitHub vars 的 `TEACHER_EMAILS` 完整同步，手動工具與 Emulator 操作見根目錄 README。
