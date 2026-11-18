# 初始化範圍與後續計畫

依據 `SPEC.md` v0.3。初始盤點：repo 僅有規格，無 prototype、題庫、Firebase config 或既有 commit。

## 本次初始化

- Vite 靜態 SPA、TypeScript strict、繁中準備中頁面。
- 題目型別與已確認規則常數，預留規格建議的模組邊界。
- Firebase SDK、CLI、Hosting 與本機 Emulator 設定，Firestore 預設全部拒絕。
- Vitest、預設拒絕 rules 測試、CI、PowerShell 文件。
- 不建立外部資源、不部署、不變更正式 rules、不啟用付費服務。

## 後續分段

1. 離線遊戲：40 題暫定題庫、穩定洗牌、作答／詳解狀態、計分與重複操作測試。待確認事件機率與是否影響他人後實作命運事件。
2. Firebase：集中驗證設定、Anonymous／Google Auth、管理員 allowlist、房間及每人持久化狀態。先以 Emulator 驗證所有權、跨學生拒絕、重複作答、房間狀態轉換。
3. 課堂同步：確認排行策略後實作，保留全班 30 人排名。測試 30 client 行為、斷線恢復、老師控制、手動刪除所有巢狀資料。
4. 上線前：教師校對題庫、2–3 裝置試跑、30 台演練，取得部署與正式 rules 授權。

## 尚未採用的提案

暫停是否擋提交、CSV 匯出、單一活動房間限制、加入碼／暱稱規則、排行榜同步策略、事件效果／機率、音效。依規格保留待確認，不把提議當成已核准。

初始化不代表 SPEC 的完整遊戲驗收完成。
