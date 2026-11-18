# Firestore 用戶端資料契約

本文件對應 `firestore.rules`，已於 2026-11-18 發布至 `chinese-exam-survival-game` 並讀回比對一致。已核准方案為老師約每 10 秒發布公開排名快照；學生自己的分數立即更新。快照以兩份原子更新的文件承載，前端串接見 `src/firebase/classroom.ts` 與 `src/app/cloud.ts`。

## 身分與查詢

- 學生用 Anonymous Auth。老師用 Google Auth，且管理員必須另外建立 `teachers/{uid}`，內容包含 `authorized: true`。客戶端不能寫入 allowlist。
- 老師可讀取自己的授權文件。未授權帳號回傳 permission-denied，不代表可自行建立該文件。
- 老師查房間時必須加 `where('ownerUid', '==', auth.currentUser.uid)`，不能列舉全站房間。
- 學生以完整 6 位大寫英數碼 get `roomCodes/{code}`，得到 roomId，再建立自己的 membership。不可列舉加入碼。這不是防暴力猜碼機制。
- 學生加入後可讀房間、自己的玩家、答案、事件，以及 `public/leaderboard`。不能讀其他玩家文件，連暱稱與分數也須從快照取得。
- 老師只能讀自己房間的全部玩家、答案與事件，不能改寫學生私人資料或分數。可信任管理員 SDK 依 IAM 存取，不受這些 rules 限制。

## 建立房間與加入

使用同一個 batch 建立：

```text
rooms/{roomId}
  code: 6 位大寫英數碼
  ownerUid: 當前老師 UID
  questionSetVersion: 非空字串，最多 80 字
  status: 'lobby'
  createdAt, updatedAt: serverTimestamp()
  startedAt, endedAt: null

roomCodes/{code}
  roomId: 上述 roomId
  ownerUid: 當前老師 UID
```

加入碼與房間互相核對，建立後不可改 code、ownerUid、題庫版本或加入碼索引。老師只能依 `lobby → running ↔ paused → ended → archived` 轉換狀態；lobby／paused 也可直接 ended。每次帶 updatedAt；首次開始帶 startedAt；結束帶 endedAt，均為 serverTimestamp，其餘欄位維持原值。

新學生只可在 lobby 建立 `rooms/{roomId}/players/{uid}`：

```text
nickname: 2–12 字元
joinedAt: serverTimestamp()
questionOrder: 40 個不重複的 question ID
choiceOrders: 以全部 question ID 為 key、排列為 value 的 map
completedCount, score, eventCount, revision: 0
lastOperation, finishedAt: null
```

選項排列為 `[0,1,2,3]` 的排列，代表畫面順序到原始選項索引的對應。規則在作答時驗證使用的排列。題目順序與選項 map 加入後不可變；前端須驗證題目 ID 合法、四單元各 10 題及每一個排列，不可把 rules 的結構檢查當成題庫驗證。

已存在的玩家不可透過覆寫或重新加入來重置。暱稱請用 textContent 等安全方法呈現。rules 不限制全班最多只能加入 30 人，老師 UI 須管理課堂人數；快照固定最多 30 筆。

## 原子作答操作

每次操作更新玩家時必須 `revision = 原值 + 1`，將 lastOperation 設成僅含 kind 與 id 的 map。用 transaction 讀原狀態後計算；固定讀取結果的 batch 可用於首次提交，衝突時應重新讀取，不可盲目重試累加。

### 答題

同一 transaction／batch：

1. 建立 `players/{uid}/answers/{questionId}`，不得覆寫既有答案。
2. 更新玩家 completedCount +1、score +本題 awardedPoints、revision +1、lastOperation `{kind:'answer', id:questionId}`。

答案必須包含且只能包含：

```text
ordinal: completedCount 的下一題序號，1–40
selectedChoice: 畫面選項索引，整數 0–3
isCorrect: boolean
explanationViewed: false
awardedPoints: isCorrect ? 100 : 0
answeredAt: serverTimestamp()
explanationViewedAt: null
```

questionId 必須對應固定題序。第 40 題同時把玩家 finishedAt 設為 serverTimestamp，其餘題維持 null。eventCount 與其他不可變欄位不變。

### 錯題詳解

同 batch 更新既有錯題 explanationViewed false → true、explanationViewedAt 為 serverTimestamp、awardedPoints 為 20，玩家 score +20、revision +1、lastOperation `{kind:'explanation',id:questionId}`。其他欄位不變。正確題閱讀詳解不寫入領分操作。

### 命運事件

同 batch 建立 `players/{uid}/events/{eventIndex字串}` 與更新玩家：

```text
eventIndex: 下一個未領取序號，整數 1–13
awardedPoints: 整數 -30 至 +80
createdAt: serverTimestamp()
```

玩家必須完成至少 eventIndex ×3 題。玩家 eventCount +1、score 設為 `Math.max(0, oldScore + awardedPoints)`、revision +1、lastOperation `{kind:'event', id:String(eventIndex)}`。其餘欄位不變。

事件解鎖可以延後領取，規則保證每個序號最多一次，前端負責每三題展示事件。機率、事件名稱及跨玩家效果尚未定義，不能跨玩家寫分。玩家總分上限 5040，revision 上限 93，對應 40 題、最多 40 次錯題詳解與 13 次事件。

所有三種寫入都要求房間 running。暫停、結束或封存後仍可讀已保存資料，但不能作答、領詳解分或事件分。前端若正在讀未領分詳解，恢復後才能提交領分操作。

## 排名快照

`rooms/{roomId}/public/leaderboard` 與 `rooms/{roomId}/public/leaderboard2` 只能由擁有房間的已核准老師在同一個 batch create／update：

```text
updatedAt: serverTimestamp()
entries: 每份最多 15 筆 [{ nickname: string, score: 非負整數 }]
```

禁止額外欄位，包含 UID、email、答案。規則逐一驗證全部 30 筆，空快照也必須寫兩份空 entries。老師是內容可信任的產生者，rules 不計算排序，也不能證明快照暱稱對應真實學生。學生暱稱的 2–12 字限制在加入時驗證，快照驗證暱稱為文字。老師依分數降序排序全部玩家，前 15 筆寫第一份，剩下寫第二份；前端依分數與位置計算同分同名次，例如 1、1、3。分數相同時老師以 finishedAt 升序、未完成者置後，再依加入時間與 UID 決定穩定顯示順序；UID 僅用於老師端排序，不寫入快照。前端已依此排序與計算名次。

設計調整：原提案每筆也保存 rank，實測單份文件的完整 30 筆驗證會超出 Firestore 1,000 次運算限制。最終每份最多 15 筆，兩份共 30 筆；名次由前端衍生，不保存 rank。完整保留全班排名功能。

學生分別使用 onSnapshot 監聽兩份快照。rules 透過 getAfter 要求兩份 updatedAt 都等於本次 request.time，禁止只更新一份。兩個 listener 仍可能先後回呼，前端必須暫存到兩份時間相同才合併顯示，不可混合不同版本。不能列舉任意 public 文件，僅開放上述兩個固定 ID 的 get。

老師監聽自己房間的玩家，僅在資料有變更時最多每 10 秒寫一次快照。用戶端以交易讀取已發布的時間與內容，協調不同分頁，rules 不強制時間間隔。結束或封存時例外補發最終排名，先凍結房間再讀取完整玩家；週期發布也讀取房間狀態以避免舊排名覆蓋最終結果。老師離線時標示最後更新時間，不宣稱排名仍即時。估算 30 人、30 分鐘、31 個排行讀取端、每 10 秒兩份快照約 11,160 次讀取，加老師玩家監聽約 1,620 次，合計約 12,780；初始載入、詳解更新、重連及 rules 相依讀取另計。

`scripts/generate-leaderboard-validation.mjs` 產生每份至多 15 筆的長度短路驗證，不依賴規則不支援的迴圈。`npm run rules:check` 驗證產物一致。需要診斷時可設定 `RULES_COVERAGE_PATH`，Emulator 測試會輸出官方 ruleCoverage JSON，不影響正式資料。

## 限制與刪除

rules 核對精確計分差、操作次序及原子寫入，不能驗證用戶端的 isCorrect、隨機結果或人是否真的看過詳解；答案隨前端發送亦可被檢視。這是形成性課堂遊戲，不是可信任考試系統。

規則拒絕客戶端所有刪除，避免只有 room 被刪而遺留子集合。待完整清理工具及測試完成後，再開放老師的安全刪除流程。尚未達成 SPEC 的手動刪除驗收；無 TTL。rules 使用 get／getAfter 的相依文件讀取也會影響用量，Emulator 測試不代表正式帳單估算或 30 台裝置壓測。
