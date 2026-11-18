# 本機環境驗證紀錄

2026-11-18 初始化與更新。

| 工具 | 結果 |
| --- | --- |
| Node.js | 24.15.0 → 24.22.3，保留 Node 24 並設為 nvm 預設 |
| npm | 11.12.1 → 11.19.1，隨 Node 更新 |
| Java | 補裝 Homebrew OpenJDK 21.0.13.1，加入 `~/.zshrc` 的 PATH |
| Firebase CLI | 本機已是 15.36.0；repo 另列開發依賴以便重現 |
| Vite / TypeScript / Vitest | 8.3.8 / 7.0.2 / 5.1.0 |
| Firebase SDK / rules-unit-testing | 13.4.0 / 6.0.0 |

本機既有全域 npm 套件已隨 nvm 移轉到新 Node。開啟新終端機可載入環境，或在目前 zsh 執行 `source ~/.zshrc`。此 repo 的 `.nvmrc` 指定 Node 24；`package-lock.json` 鎖定套件解析結果。

## 相依套件安全檢查

安裝最新穩定版並執行 `npm audit fix` 後，當日仍有 26 個相依套件層級的 audit 告警，其中 12 high、14 moderate。相同底層公告會沿依賴鏈計入多個套件，不代表 26 個獨立漏洞。涉及 gRPC、OpenTelemetry、glob、minimatch、picomatch、uuid 等。

沒有執行 `npm audit fix --force`。當日 npm 建議會降級 Firebase 至 9.14.0、Firebase CLI 至 13.11.2、Vite 至 6.2.7 等，與目前工具鏈不符。未加入未經相容性驗證的 overrides。

目前頁面沒有匯入 Firebase；Node gRPC 也不是已上線的瀏覽器服務。這不代表未來整合已排除風險，上線前需重新 `npm audit`、評估實際使用路徑及上游修正。此次不宣稱依賴零漏洞。
