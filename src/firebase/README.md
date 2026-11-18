# Firebase 整合邊界

已安裝 modular Web SDK，初始化階段不呼叫 SDK，不建立網路連線或登入。

實作階段從 `.env.local` 讀取並驗證 Web config，集中初始化 Auth 與 Firestore。Emulator 必須在首次操作前連接，學生使用 Anonymous Auth，老師使用 Google Auth 且另外檢查管理員建立的 `teachers/{uid}` allowlist。

目前 Firestore rules 拒絕全部存取。不要把準備完成的 SDK、設定模板或測試骨架視為已完成權限與房間功能。
