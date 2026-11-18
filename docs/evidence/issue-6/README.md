# Issue #6 驗證證據

以下為 2026-11-18 使用 Node.js 24、Java 21、Chrome 與 `demo-chinese-exam` Auth／Firestore Emulators 的 repository-verified 結果，不是正式環境驗收。

| 命令                                                      | 結果                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run check`                                           | strict types、52 個 unit tests、generated rules consistency、production build 通過 |
| `npm run test:rules`                                      | 74 個 rules tests 通過                                                             |
| `npm run test:integration`                                | 13 個 SDK／rules integration tests 通過                                            |
| `npm run test:browser`                                    | 4 個 browser flows 通過                                                            |
| cached Prettier CLI 檢查變更 Markdown、`git diff --check` | 通過                                                                               |

瀏覽器測試來源為 `tests/browser/classroom.spec.ts` 與 `tests/browser/targets.spec.ts`。後者以 emulator 管理端準備固定寶箱與起始分數，領取效果由兩個匿名學生透過可見 UI 操作，不代表機率樣本；類別與類內權重由單元測試驗證映射邊界。

- [老師分享與 QR code](teacher-share-qr.png)
- [手機錯題冷凍](student-mobile-freeze.png)
- [平板三個盲選寶箱](student-tablet-three-chests.png)
- [搶奪目標選擇](steal-target-tablet.png)
- [互換目標選擇](swap-target-tablet.png)
- [完整40題結算](student-summary.png)
- [老師離線時到期結算](expired-teacher-offline.png)

分享單元測試另驗證實際 QR 解碼、原生分享成功／取消／失敗與複製 fallback。沒有真實手機系統分享、相機掃碼、Google OAuth、正式部署 rules／IAM 或30台平板負載證據。未執行部署、正式資料修改或合併。

驗證過程修正了加入前交易讀取 lobby 設定的權限，以及並發分數衝突時重新讀取與重試。瀏覽器測試曾修正過早讀取結算文字、登入模擬視窗尚未載入完成的等待條件，最後完整套件通過。Build 保留 Firebase bundle 大於500kB的警告，沒有為消除警告修改打包方式。
