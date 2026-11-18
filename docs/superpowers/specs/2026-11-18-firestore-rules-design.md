# Firestore rules 設計提案

狀態：使用者已選擇老師每 10 秒產生排名快照，並於 2026-11-18 核准整份設計與三項待確認行為。實作與本機驗證完成；正式 rules 後續經明確授權於同日發布，紀錄見 `docs/firebase-setup.md`。

依據 `SPEC.md` v0.3。目標是建立未來前端可直接使用的資料契約與權限，維持 Spark、不使用 Functions、不把用戶端計分宣稱為防作弊。

## 方案與選擇

1. **已選擇：老師每 10 秒聚合公開排名快照。** 學生只能讀自己的玩家文件與公開快照，老師讀自己房間的全部玩家並產生快照。估算單場約 7,200 次排行讀取；老師頁面必須保持在線，快照須標示更新時間。學生不得寫快照。使用者於 2026-11-18 回覆「10 秒延遲ok」，確認此新鮮度目標。
2. 學生直接監聽全部公開玩家文件。需額外把私人進度、洗牌與作答移出該文件；單場估算約 50,220 次排行讀取，另加詳解更新、重連與 rules 相依讀取。結構較多，容易超過免費每日讀取額度。

估算假設為 30 人、30 分鐘、40 題、13 次事件；不是計費承諾。兩種方案都讓全班讀到全部 30 人排名。

老師端只在資料改變時產生快照，寫入最多每 10 秒一次；學生使用 onSnapshot 接收快照，不輪詢整個玩家集合。學生自己的分數與進度立即更新。老師頁面離線時公開快照可能過時，顯示最後更新時間。

## 權限

| 資料 | 學生 | 已核准且擁有該房間的老師 | 其他人 |
| --- | --- | --- | --- |
| `teachers/{uid}` | 拒絕 | 僅讀自己的授權記錄 | 拒絕 |
| `rooms/{roomId}` | 已加入後讀取 | 建立、讀取、合法狀態轉換 | 拒絕 |
| 加入碼索引 | 登入後僅依完整加入碼讀單份文件，不可列舉 | 管理自己房間的索引 | 拒絕 |
| `players/{studentUid}` | 僅本人讀寫且遵守狀態轉換 | 讀取 | 拒絕 |
| 私人 `answers`、`events` | 僅本人讀寫且遵守狀態轉換 | 讀取 | 拒絕 |
| `public/leaderboard` | 已加入後讀取 | 寫入 | 拒絕 |
| 其他路徑 | 拒絕 | 拒絕 | 拒絕 |

老師必須同時具備 `google.com` sign-in provider 與管理員建立的 `teachers/{uid}.authorized == true`。所有客戶端均不得建立、更新或刪除老師 allowlist。移除授權後即失去老師權限。

學生須使用 Anonymous Auth，不能藉由寫入 role 或 ownerUid 自行升權。老師不能以管理權限任意改寫學生分數或私人答案。

## 房間與加入

房間包含 ownerUid、questionSetVersion、code、status 與時間戳。建立時固定 ownerUid，建立後不能換老師或題庫版本。加入碼索引須與房間以同一個 batch 建立，避免索引指向他人房間。禁止列舉全站房間及加入碼。

提案沿用 SPEC 尚待確認的值：6 位大寫英數加入碼、暱稱 2–12 字元。這是待核准提案，尚非既定規格。暱稱只存文字，前端仍須以 textContent 等安全方式呈現，rules 不能代替 HTML 輸出編碼。

新學生只在 lobby 加入；已加入者可在後續狀態恢復讀取自己的資料。禁止單純知道 roomId 就查看全班私人資料。

「只在 lobby 加入」也屬提案，SPEC 尚未明定老師開始後是否允許新學生加入；若允許，改為 lobby／running 可加入，結束與封存一律拒絕。

房間狀態提案：`lobby → running ↔ paused → ended → archived`，允許老師從 lobby／paused 直接結束。暫停擋新作答、事件與領分，已完成作答仍可閱讀；恢復後從持久化進度繼續。這項暫停政策仍需核准。

## 穩定洗牌與計分

每人保存固定 40 題順序與四選項排列，建立後不可改寫。rules 驗證基本結構，完整題庫成員、每單元 10 題與排列正確性由前端純函式與測試驗證，不宣稱 rules 能完整驗證任意題庫。

分數更新須與對應 answer／event 記錄在同一個 transaction 或 batch，透過 getAfter 檢查雙向關聯。玩家保存單調遞增的操作序號與最後操作種類／記錄 ID；單一操作只能對應一筆新紀錄或一次詳解狀態轉換。

### 實作資料契約

每份文件使用 `keys().hasAll` 與 `hasOnly` 限定欄位。所有建立／更新時間均以 `request.time` 驗證，前端使用 serverTimestamp。除下列明列操作外，不允許 update；delete 暫時全部拒絕。

- `roomCodes/{code}`：只有 `roomId`、`ownerUid`。學生登入後可 get，不可 list；它提供加入前的房間定位，不包含班級或玩家資料。房間同 batch 建立且互相驗證 code／roomId／ownerUid，建立後不可修改。
- `rooms/{roomId}`：`code`、`ownerUid`、`questionSetVersion`、`status`、`createdAt`、`updatedAt`、`startedAt`、`endedAt`。初始 lobby 且後兩時間為 null。狀態更新僅能改 status、updatedAt 與對應開始／結束時間。ownerUid、code、questionSetVersion、createdAt 不可變。
- `players/{studentUid}`：`nickname`、`joinedAt`、`questionOrder`、`choiceOrders`、`completedCount`、`score`、`eventCount`、`revision`、`lastOperation`、`finishedAt`。初始計數／分數為 0，lastOperation 與 finishedAt 為 null。加入時必須確認 room.code 對應索引指向同一房間。加入後暱稱、時間及排列不可變，學生不能另加 role 等欄位。
- `questionOrder`：40 個不重複 question ID 的 list。`choiceOrders`：以 question ID 為 key 的 map，keys 必須與 questionOrder 相同；每次答案操作驗證所引用的排列為四個整數 0、1、2、3 的完整排列。完整題目成員與單元配置需另外用題庫驗證器，不把初始 map 的淺層驗證當成完整題庫驗證。
- `answers/{questionId}`：`ordinal`、`selectedChoice`、`isCorrect`、`explanationViewed`、`awardedPoints`、`answeredAt`、`explanationViewedAt`。ordinal 是 1–40，對應 questionOrder；selectedChoice 是洗牌後索引 0–3。首次作答 explanationViewed 為 false、explanationViewedAt 為 null、awardedPoints 為正確 100 或錯誤 0。更新只允許詳解 false → true，並改 explanationViewedAt 及錯題 awardedPoints 為 20；答案、對錯與 answeredAt 不可改。正確題查看詳解不更新持久化資料。
- `events/{eventId}`：`eventIndex`、`awardedPoints`、`createdAt`。eventId 是 eventIndex 的字串表示，eventIndex 是 1–13。新增後不可修改；不保存尚未確認的事件名稱或跨玩家效果。
- `lastOperation`：僅有 `kind` 與 `id`，kind 為 answer／explanation／event，id 指向同 batch 的 answer 或 event。每次 revision 必須 +1。answer 時 completedCount 必須 +1，eventCount 不變；explanation 時兩個計數不變；event 時僅 eventCount +1。規則逐一驗證其餘玩家欄位未改、對應記錄由不存在變成存在，或詳解由未看變成已看，以及精確的分數差。
- 反向驗證 answer／event 寫入時，getAfter(player) 必須指向當前紀錄且 revision 確實遞增；防止同 batch 一次塞多題卻只更新一次玩家。answer 只可對應 completedCount 的下一題，event 只可對應 eventCount 的下一次。finishedAt 只在第 40 題提交時由 null 設為 request.time，之後不可改。

以上是待核准的實作契約，未有前端呼叫者；後續前端必須依此原子操作，不能各自 setDoc 改分。

- 首次提交每題最多一次，依保存的題目順序推進完成數。正確 +100，錯誤先 +0。
- 錯題 explanationViewed 僅可 false → true 一次，與 +20 同步；正確題沒有額外詳解分。
- 事件依已完成題數解鎖，每三題一次，最多 13 次；同一序號只能建立一次。delta 為整數且介於 -30 至 +80。
- 每次分數變更使用 `max(0, oldScore + delta)`，不允許單獨提高分數、退回進度或改答案後重領。
- 題目對錯與事件隨機性由用戶端提交，rules 無法證明學生誠實，也無法證明人真的閱讀了詳解。

事件機率、事件名稱及跨玩家效果本次不定義。所有跨玩家寫入一律拒絕，若未來要支援影響他人，需另行設計。

## 排名快照

只允許老師寫公開快照，使用 server timestamp。全班最多 30 筆，每筆僅 nickname、score，rank 由前端衍生。禁止混入 UID、email、答案或完整玩家文件。更新速率由老師端約 10 秒節流，快照顯示更新時間。客戶端不得宣稱老師離線時仍為即時排名。

實測單份文件驗證 30 筆會超出 Firestore 1,000 次運算上限。最終採兩份各最多 15 筆的文件 `leaderboard`／`leaderboard2`，同 batch 更新並以 getAfter 核對兩份 request.time。每份欄位為 `updatedAt`、`entries`。學生等兩份 updatedAt 相同才顯示合併排名。產生器使用每頁 15 筆短路檢查，沒有補齊資料，測試第 1 與第 30 筆混入 UID 都被拒絕。

估算讀取改為約 12,780 次／場，仍保留全班 30 人及 10 秒新鮮度。這是實作時因平台限制做的資料表示調整。exact schema 以 `docs/firestore-contract.md` 為準。

## 刪除與保留

不啟用 TTL。客戶端的房間、玩家、答案與事件刪除先拒絕，直到有可測試的完整清理工具，避免先刪房間而遺留子集合。此階段可由管理員使用可信任工具清理，但不提供不完整的學生或老師刪除路徑。完整老師手動清理仍列為後續功能，不宣稱已達成 SPEC 的刪除驗收。

## Emulator 驗證計畫

先寫測試並在目前全拒絕規則上確認正常授權情境失敗，再實作規則。用真正的 Firebase Rules Unit Testing 與 Emulator，不以 mock 代替權限判定。

驗證未登入拒絕、匿名自授老師拒絕、未核准 Google 使用者拒絕、跨老師及跨學生隔離、加入碼不可列舉、老師開始前不可答題、暫停與結束不可領分、欄位與數值邊界、不可變洗牌、重複答案／詳解／事件拒絕、單獨改分拒絕、原子操作成功、全班快照可讀但不可由學生修改、清理未完成前拒絕刪除。

驗證通過後提供規則與資料契約文件。發布至正式專案為獨立步驟，發布前須有明確授權；本提案與本機測試不會修改線上權限。
