# Firestore 用戶端資料契約

本文件對應 repository 的 v2 寶箱競賽規則，不表示已部署或讀回驗證正式環境。新房間使用 rulesVersion 2，舊房間僅能回顧，不會靜默重算、重置或遷移。

## 身分與查詢

- 學生使用 Anonymous Auth。老師須為已驗證 Google provider，token email 小寫對應 `teacherEmails/{email}.authorized == true`；Google 登入本身不授予老師資格，客戶端不能自授權。
- 已驗證 Google 使用者僅可精確讀取自己 email 的授權文件，不可列舉白名單或讀取他人授權。老師查房間須加 `where('ownerUid', '==', auth.currentUser.uid)`。
- 加入前的匿名使用者可精確讀取 v2 lobby 房間的公開設定，供原子加入交易核對人數；不可列舉房間，也不能讀取尚未加入的 running 房間。
- 學生以完整六位碼讀 `roomCodes/{code}`，不能列舉加入碼。加入後可讀房間、自己的私人玩家與答案、同房公開 `scores` 與兩份排名快照。
- 他人 `players` 與 `answers` 仍私密；老師只能讀自己教室的私人進度。公開目標選單不讀私人排列、答案或 email。
- 管理員 SDK 依 IAM 存取，不受 client rules 限制。教師與學生 Auth 儲存分開。

## 老師白名單與切換

```text
teacherEmails/{email 小寫}
  authorized: true
```

管理工具與 client/rules 使用小寫地址，不把 Gmail 點號或 plus 別名視為相同地址。老師可以在首次登入前被授權。email 改名或被組織重新配發會影響資格；房間 `ownerUid` 仍不可變，不會隨 email 轉移。

舊 `teachers/{uid}` 文件不再參與授權，新 rules 對該路徑沒有 client 讀寫權限。切換只新增 email collection，無需重建 rooms、players 或答案；舊文件不由工具刪除。部署同步以 `TEACHER_EMAILS` 為完整名單，在同一 Firestore transaction 中以每頁 50 筆查詢全部現有文件，再原子新增／恢復指定 email、刪除其餘文件。現有或目標名單超過 100 份則拒絕寫入；衝突或失敗不做部分提交，可重新執行。手動 `--email` 模式只新增／恢復指定 email，不移除其他 email。

管理端 IAM 寫入不受 client rules 約束。部署身份取得資料庫層級 Firestore 權限，並非僅能操作這個 collection；詳見 [部署設定](hosting-auto-deploy.md)。

## 房間與倒數

同 batch 建立 `rooms/{roomId}` 與 `roomCodes/{code}`，相互核對不可變加入碼及 ownerUid：

```text
room: code, ownerUid, questionSetVersion, rulesVersion: 2
status: lobby
createdAt, updatedAt: serverTimestamp()
startedAt, endedAt, runningSince, pausedAt: null
durationMinutes: 1–60 整數，預設20
remainingMs: durationMinutes * 60000
playerCount: 0
roomCode: {roomId, ownerUid}
```

老師狀態為 `lobby → running ↔ paused → ended → archived`，lobby／paused 也能提前結束。只在 lobby 設定總分鐘。開始將 runningSince 設為 serverTimestamp；伺服器規則以 `request.time < runningSince + remainingMs` 拒絕超時操作，不依賴教師分頁在線。

暫停只保存 `pausedAt: serverTimestamp()`，保留原 runningSince 與 remainingMs。恢復以伺服器已保存的兩個時間差扣除消耗毫秒，再設定新的 runningSince 並清除 pausedAt。前端 parseRoom 將 paused 剩餘時間正規化，不讓教師暫停期間繼續倒數。此設計避免用戶端猜測未來 serverTimestamp，也不以誤差容忍放寬可用時間。到期不能再暫停／恢復。

結束清除 runningSince／pausedAt、remainingMs 歸零、記錄 endedAt。老師控制台在線時自動結束到期教室並補發最終排名；離線時學生仍立即停止操作，老師回來後再補發。已結束資料不可改分。

## 加入與私人玩家

lobby 以同一 transaction 建立私人玩家、公開 score 並將 playerCount +1。規則要求原兩文件不存在、索引正確、整體計數最多30人，既有玩家重新加入只能讀回，不可重置。

```text
players/{uid}
nickname: 2–12字元
joinedAt: serverTimestamp()
questionOrder: 40個不重複question ID
choiceOrders: question ID → [0,1,2,3]排列
completedCount, revision: 0
lastOperation, finishedAt, cooldownStartedAt, pendingId: null

scores/{uid}
nickname: 同私人玩家，之後不可改
score: 0
lastOperation: null
```

questionOrder／choiceOrders 加入後不可改。SDK 驗證合法題目、四單元各10題及選項排列，規則作答時核對目前排列。暱稱等外部文字需安全呈現。

分數只有公開 scores 是新版權威值，私人玩家不再存 score。學生可讀同房 scores 文件 ID、暱稱及分數，lastOperation 僅含一次性交易所需 actor ID 與題目 ID，不含答案。SDK 不再假設總分等於本人的答案分數總和。

## 作答、冷凍與完成

每次 own player 操作 revision +1，lastOperation 為 `{kind, id: questionId}`。kind 限 answer／open／claim／finish；revision 上限120對應40題最多各答題、開箱、結算。操作須為自己匿名身分、同房 v2、running 且未到期。

answer 同交易建立不可變作答欄位，更新玩家 completedCount +1：

```text
ordinal: 下一題序號1–40
selectedChoice: 畫面索引0–3
isCorrect: boolean
answeredAt: serverTimestamp()
explanationViewed: false
explanationViewedAt: null
awardedPoints: 0
chest: null
```

答對只設定 pendingId 為本題ID，不加分，cooldownStartedAt=null。答錯 pendingId=null、cooldownStartedAt=serverTimestamp，不加扣分。下一題須沒有 pendingId，且 request.time 已到 cooldownStartedAt +3秒；重新整理或第二分頁不能跳過。前端將 cooldownStartedAt 衍生為 cooldownUntil 顯示，詳解不加分且不要求讀完才能繼續。

第40題答對須完成最後寶箱結算才設 finishedAt；第40題答錯滿3秒後，以 finish 操作保存 finishedAt=serverTimestamp，不能送出答案就算完成。若先逾時則只回顧已有進度，不補發效果。

## 盲選寶箱與原子分數

open 只能將本題正確答案的 chest 由 null 變成以下資料，並更新 own player revision／lastOperation：

```text
{box: 0..2, outcome: {kind, amount}, targetId: null,
 settled: false, delta: 0, fallback: false}
```

箱子外觀相同，選後才顯示；重新整理、並發開箱以第一個已保存結果為準。結果由用戶端抽樣，機率集中在 `src/game/config.ts`，不是防作弊隨機服務。

| 類型  | 類別機率 | 類內數值機率                                 |
| ----- | -------: | -------------------------------------------- |
| gain  |      50% | +20：30%、+50：50%、+80：20%                 |
| steal |      20% | amount=0，指定對方轉移 min(100,對方當下分數) |
| swap  |      10% | amount=0，交換雙方當下分數                   |
| loss  |      20% | -10：50%、-20：30%、-30：20%，最低0          |

claim 同 transaction 必須更新：

1. 原未結算 chest 改為 settled=true，box／outcome 不變，保存 targetId、delta 與 fallback。
2. own player 清除 pendingId、revision +1、lastOperation=claim；最後一題同時完成。
3. own scores 改為精確計算結果，lastOperation=`{actor: 發動者UID, id: questionId}`。
4. 指定目標時也更新目標 scores，使用同一 lastOperation，依提交時兩人現值計算。

目標限同房其他已加入玩家，已答完或離線玩家仍可選。只有 playerCount=1 時，steal／swap 可 targetId=null 且 fallback=true 改領20分；其他玩家零分不觸發替代獎勵。gain／loss 不可帶目標。搶分及互換保持雙方總分，不得只寫一方、自己當目標或跨房間操作。分數範圍0–96000，依30人×40題×最多80分產生量推導。

規則在 actor player 寫入集中驗證整個 claim 的數值、不可變結果、雙方公開分數及一次性進度。答案及分數 companion 文件要求同交易 actor revision +1 的配對操作，不重複執行整套計算，避免 Firestore 1000-expression 限制；不能只改 lastOperation 或利用舊 claim 重播。SDK 交易衝突重新讀取雙方現值，不盲目重送加分。

舊每三題命運事件與詳解加分寫入入口不再開放。舊資料保留原值供 owner／本人讀取，無破壞性遷移。

## 排名快照

`rooms/{roomId}/public/leaderboard` 與 `rooms/{roomId}/public/leaderboard2` 只能由擁有房間的已核准老師在同一個 batch create／update：

```text
updatedAt: serverTimestamp()
entries: 每份最多 15 筆 [{ nickname: string, score: 非負整數 }]
```

禁止額外欄位，包含 UID、email、答案。規則逐一驗證全部 30 筆，空快照也必須寫兩份空 entries。老師是內容可信任的產生者，rules 不計算排序，也不能證明快照暱稱對應真實學生。學生暱稱的 2–12 字限制在加入時驗證，快照驗證暱稱為文字。老師依分數降序排序全部玩家，前 15 筆寫第一份，剩下寫第二份；前端依分數與位置計算同分同名次，例如 1、1、3。分數相同時老師以 finishedAt 升序、未完成者置後，再依加入時間與 UID 決定穩定顯示順序；UID 僅用於老師端排序，不寫入快照。前端已依此排序與計算名次。

設計調整：原提案每筆也保存 rank，實測單份文件的完整 30 筆驗證會超出 Firestore 1,000 次運算限制。最終每份最多 15 筆，兩份共 30 筆；名次由前端衍生，不保存 rank。完整保留全班排名功能。

學生分別使用 onSnapshot 監聽兩份快照。rules 透過 getAfter 要求兩份 updatedAt 都等於本次 request.time，禁止只更新一份。兩個 listener 仍可能先後回呼，前端必須暫存到兩份時間相同才合併顯示，不可混合不同版本。不能列舉任意 public 文件，僅開放上述兩個固定 ID 的 get。

老師監聽自己房間的玩家，僅在資料有變更時最多每 10 秒寫一次快照。用戶端以交易讀取已發布的時間與內容，協調不同分頁，rules 不強制時間間隔。結束或封存時例外補發最終排名，先凍結房間再讀取完整玩家；週期發布也讀取房間狀態以避免舊排名覆蓋最終結果。老師離線時標示最後更新時間，不宣稱排名仍即時。

`scripts/generate-leaderboard-validation.mjs` 產生每份至多 15 筆的長度短路驗證，`npm run rules:check` 驗證產物一致。需要診斷時可設定 `RULES_COVERAGE_PATH`，Emulator 測試會輸出官方 ruleCoverage JSON。

## 限制與刪除

rules 核對操作次序、分數差及原子寫入，不能證明用戶端 isCorrect 或抽樣結果誠實；答案隨 bundle 發送仍可被檢視。這是課堂練習遊戲，不是防作弊考試。

只有目前仍獲授權的 owner 可依下列流程清理自己的 deleting 房間。TTL 與自動 30 天清理未實作。get／getAfter 相依讀取與新增公開 scores 監聽會增加用量，舊快照估算不適用完整寶箱流程。Emulator 不驗證部署規則、IAM、Google OAuth、正式資料或30台負載。


## 可重試的房間刪除

`retiredRoomCodes/{code}` 為永久退役與完成紀錄，內容只有 `{roomId, ownerUid, state: 'deleting' | 'completed'}`，不保存學生資料。與 roomCodes 相同，只允許登入者依完整代碼 get，不能 list。客戶端不能刪除此紀錄或重用該碼建立新房間。

開始時在同一交易中將房間 status 改為 deleting、更新 updatedAt、建立退役紀錄，並刪除指向該房間的 roomCodes 索引。v2 只接受 lobby、ended、archived；缺少 rulesVersion 的舊房間接受既有五種狀態。未知版本拒絕。索引缺漏可續刪，錯指其他房間則停止並回報。

Deleting 不可恢復遊戲。Rules 拒絕加入、作答、開箱、分數轉移、完成與排名發布，並只對仍獲授權的 owner 開放已知路徑清理。每批最多 20 份，重新查詢剩餘文件：對每位 player 清空 answers 與 events，再刪 player；隨後獨立列舉 scores 與 public 清空。清理使用原始文件，不依賴題庫、玩家或排名解析成功。撤權、離線或失敗時停止，保留父房間供續刪。

最後以交易刪除房間並將退役紀錄改為 completed。重試先查對應 roomId／ownerUid 的完成紀錄，不能將失去讀權當成成功。多個分頁可收斂至同一完成結果。父房間消失後不再查詢無讀權的子集合；測試以 Emulator 管理權另行查核殘留。

這是受控 schema 的正常客戶端清理流程。Rules 不會遞迴刪除，也不能證明任意子集合已空；惡意 owner 略過步驟或既存未知孤兒不在此保證內，需可信任管理員工具。刪除不移除匿名 Auth 帳號，也不影響其他房間。
