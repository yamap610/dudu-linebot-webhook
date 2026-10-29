# 推播與 LINE 免費額度規劃

## 早晨合併推播

排程只需呼叫一次 `POST /api/morning-push`，並帶入：

`Authorization: Bearer <CRON_SECRET>`

目前由 `vercel.json` 設定兩個每日排程（Vercel cron 使用 UTC）：

- `00:00 UTC`（台北時間 08:00）呼叫 `/api/morning-push`，提醒當日紀念日。
- `13:00 UTC`（台北時間 21:00）呼叫 `/api/tomorrow-preview`，提醒隔日紀念日。

Vercel 環境變數需有既有的 Notion、Google Calendar、LINE 設定，另加 `CRON_SECRET`、`LINE_USER_ID` 與選用的 `LINE_USER_ID_2`。紀念日資料庫可用 `ANNIVERSARY_DB_ID` 覆蓋，預設為 `9dd10d10e0414e2593d16ec8f57ec8f4`。Notion Integration 必須有紀念日資料庫的讀取權限；只有勾選「Line Bot 提醒」且日期符合的紀念日會推播。效期管家預設讀取資料庫 `f40a3915e858492daa9a941ddccea34d`；如需切換資料庫，可設定 `EXPIRY_DB_ID`。舊的「每日帳單」與「每日行程」兩個排程應停用，以免重複推播。

紀念日資料需要以下欄位：

- `名稱`：紀念日或生日名稱。
- `日期`：原始日期。
- `類型`：生日、紀念日、節日或其他。
- `每年重複`：勾選時以月／日判斷每年提醒。
- `Line Bot 提醒`：只有勾選的項目會進入 21:00 前一日預告與 08:00 當日提醒。

LINE Rich Menu 的「紀念日」可隨時查看近期項目，清單中的 `🔔／🔕` 會顯示目前提醒開關狀態。

## LINE 內明細清單

待辦或待買只要在 Notion 勾選 `內含明細`，LINE 清單就會顯示「開啟清單」。使用者可直接在 LINE 勾選 Notion 頁面內的 to-do blocks，不再跳轉 Notion。由於 LINE 無法改寫已送出的 Flex Message，連續勾選會靜默同步；完成後按「重新整理清單」即可查看最新狀態。

## Rich Menu 更新

六格選單依序為：待繳費、效期提醒、行程查詢、待辦事項、待買清單、更多。更多功能依序提供紀念日、垃圾分類與快速新增。

```powershell
npm run rich-menu:generate
npm run rich-menu:setup
```

第一個指令只在本機產生圖片；第二個指令會呼叫 LINE API 建立並設為預設 Rich Menu，需先設定 `LINE_TOKEN`。

## 額度估算與週報建議

LINE 計費以「訊息則數 × 收件人數」計。以目前 2 位收件人估算：

- 每日早晨合併推播：最多 31 天 × 2 人 = 62 則／月。
- 每週一週報：通常 4–5 次 × 2 人 = 8–10 則／月。
- 固定推播合計：最多約 72 則／月，保留約 128 則給其他主動推播。

因此目前不需要為了 200 則額度把週報併入每日訊息。建議維持週報獨立，閱讀情境較清楚；若未來收件人增至 5 人以上，或新增其他每日推播，再把週一早晨訊息擴充成「今日行程＋待繳＋本週摘要」，並停掉獨立週報。
