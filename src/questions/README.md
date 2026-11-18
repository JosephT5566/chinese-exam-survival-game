四單元各十題，全部標記 pending_source_review。粥與獵人單元的閱讀句為原創練習素材，課名、課文對應與難度需由教師覆核。更新 bank.ts 後執行 npm run check。

計分與題目內容分開管理。v2 不因答對或閱讀詳解直接加分：答對進入三選一寶箱，答錯凍結 3 秒；閱讀詳解維持可用且不加分。寶箱機率與分數轉移在 `../game/config.ts`、`../game/rewards.ts`，完整產品規則見 [SPEC.md §4](../../SPEC.md#4-game-mechanics)。修改題目須保留穩定 ID 與正解映射；不要把寶箱結果、分數或房間時間寫入題庫。
