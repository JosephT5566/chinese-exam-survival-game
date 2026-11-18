# Firestore rules implementation plan

> For agentic workers: use superpowers:executing-plans to implement this plan task by task.

**Goal:** 實作已核准的房間、私人作答及老師排名快照權限，並以 Emulator 驗證。

**Architecture:** rules 是唯一用戶端授權邊界。計分由用戶端計算，規則以 getAfter 核對成對的原子寫入，阻擋一般重放與任意改分。

**Tech stack:** Firestore Rules v2、Firebase Rules Unit Testing、Vitest、Node 24、Java 21。

**Spec:** `SPEC.md` 與 `docs/superpowers/specs/2026-11-18-firestore-rules-design.md`，使用者已核准設計。

## Global constraints

- 不啟用 billing／Functions，不部署網站或正式 rules。
- 正確 +100；錯題查看詳解 +20 一次；事件整數 -30 至 +80；分數下限 0。
- 每人 40 題、13 個事件；所有私人資料依房間與 UID 隔離。
- 老師須 Google + 管理員 allowlist，只管理自己的房間。
- 老師產生最多 30 筆公開排名，約每 10 秒更新。

## Review focus

- 沒有玩家更新的孤立 answer／event 寫入必須拒絕。
- 同 batch 塞入多筆紀錄而只更新一次玩家必須拒絕。
- 房間與加入碼不可被接管，既有學生不能以覆寫方式重新加入重置分數。
- 第 30 筆排名也必須拒絕 UID 等私人欄位。
- 完成第 40 題、負分歸零、錯題詳解與事件的重試必須維持一致。

## Task 1: 行為測試

Files: `tests/rules/classroom.test.ts`，取代初始化專用的 `tests/rules/default-deny.test.ts`。

- [x] 寫入 Emulator fixture、房間／玩家建置與原子操作 helper。
- [x] 測試正常路徑及上述攻擊情境，允許與拒絕均使用真實 SDK。
- [x] 在全拒絕規則上執行，確認正常路徑因 permission-denied 失敗。

## Task 2: 規則

Files: `firestore.rules`、`scripts/generate-leaderboard-validation.mjs`。

- [x] 實作老師身分、加入碼、房間生命週期及會員讀取規則。
- [x] 實作不可變洗牌、revision、答案／詳解／事件原子操作及欄位限制。
- [x] 用產生器建立兩份各 15 筆的有界排名驗證，支援 `--check` 重現驗證。
- [x] 執行規則測試並修正失敗，保留所有負面測試。

## Task 3: 驗證與文件

Files: `docs/firestore-contract.md`、`README.md`、相關現況文件。

- [x] 記錄 exact schema、前端 transaction／batch 範例、查詢限制及未完成的刪除功能。
- [x] 執行 `npm run check`、`npm run test:rules` 與產生器 `--check`。
- [x] 審查規則與測試，完成必要修正；不自動 commit／push／deploy。

## 執行紀錄

- RED：全拒絕規則上 21 個正常授權案例因 permission-denied 失敗，37 個拒絕案例通過。
- Ruling：單份 30 筆驗證超過平台 1,000 次運算上限，改兩份各 15 筆、同 batch 更新；不保存 rank，前端衍生同分名次。成本為排行文件交付量增加與前端需要合併相同時間戳。若前端未遵守契約，可能顯示混合版本，已在文件明確標示。
- 安全審查沒有發現具體升權、跨房間／跨學生、任意改分或重放漏洞；建議的固定兩頁、同時間戳、單頁更新拒絕均已測試。
- GREEN：62 個 Emulator rules 測試通過，含完整 40 題／13 事件、並發重複提交與 30 人快照；型別、產生碼、2 個 smoke tests 與 build 通過。
- 不代表已通過 30 裝置壓測、完整清理驗收、前端串接或正式部署。
