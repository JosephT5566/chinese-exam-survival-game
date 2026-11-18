# 限時寶箱與教室分享 Implementation Plan

**Goal:** 實作已核准 Issue #6，保留私人答案與老師授權。
**Architecture:** 以持久化總倒數與冷凍狀態控制答題；公開 scores 與私人作答分離，寶箱原子交易更新雙方分數。共用純計分及時間函式供 demo/cloud 使用，分享使用本機 QR 編碼與平台 API。
**Tech Stack:** Vite、TypeScript、Firebase Auth/Firestore、Vitest、Playwright。
**Spec:** https://github.com/JosephT5566/chinese-exam-survival-game/issues/6

## Global constraints

- Node.js 24、Java 21+；emulator project demo-chinese-exam。
- 不變更教師授權、匿名身分及答案私密性，不部署、不合併。
- UI gate 已豁免，沿用現有頁面；若生成圖片使用 Astra agent。
- 1–60 分鐘、答錯冷凍 3000ms、答對只有寶箱；機率依 Issue。

## Review focus

- 並發搶分/互換，交易重試、雙分頁與重新整理不得重領。
- 教師分頁關閉仍禁止超時操作，暫停不得重置計時。
- 第40題必須完成最後寶箱或冷凍，答案保持可回顧。
- 目標選單不得開放私人玩家文件，舊房間不靜默遷移。
- 分享取消、API缺失、複製失敗與本機demo跨裝置限制。

## Tasks

- [x] 實作純 rewards/timer 引擎、local 持久狀態、demo flow；單元測分布邊界、冷凍/到期、最後一題與原子分數。
- [x] 實作 v2 Firestore rules：持久倒數、playerCount、私密作答與公開 scores 的單次效果證明；rules 測越權、重領、並發/過期。
- [x] 實作 sharing module、本機 QR、capability fallback 與真實解碼單元測試。
- [x] 串接 Firebase adapter/model/cloud view；integration 測公開資料隔離、交易互換與搶分、暫停/冷凍/到期/最後題。
- [x] 更新 browser flows 與 tablet/mobile evidence，更新 SPEC/README/contracts/architecture。
- [x] npm run check、test:rules、test:integration、test:browser，git diff --check；獨立 review 與修正。PR 連結記錄於 Issue #6。

本次依 owner「let's work on this」直接執行，不另加計畫核准關卡。分享、game/demo、rules 為互不重疊檔案的平行子任務；Firebase adapter 與整合由主 agent 執行。
