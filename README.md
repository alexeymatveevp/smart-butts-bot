# Family Todo Telegram Bot

Telegram bot for a shared family todo list: voice commands, task assignment, and reminders. Built with Node.js, TypeScript, grammY, Google Sheets, and OpenAI.

## Setup

### 1. Telegram Bot

- Open [@BotFather](https://t.me/BotFather), create a bot with `/newbot`, and copy the token.

### 2. Google Sheets

- Create a [Google Cloud project](https://console.cloud.google.com/), enable **Google Sheets API**.
- Create a **Service Account** (IAM → Service Accounts → Create). Download the JSON key.
- Create a Google Sheet (or use your existing one). Share it with the **service account email** (Editor access).
- **Tasks sheet** (default tab name: `Sheet1` — set `TASKS_SHEET_NAME` if different). Row 1 = headers, data from row 2:
  - **A** — `user` (e.g. `alexey`, `tanyu`) — must match `HUSBAND_SHEET_USER` / `WIFE_SHEET_USER`. Empty or `both`/`оба` = unassigned (both get reminders).
  - **B** — `summary` (task title)
  - **C** — `created` (ISO date)
  - **D** — `lastNotified` (when the last reminder was sent; bot updates this)
  - **E** — `notify` (schedule template: `every 1 week`, `every 3 days`, etc.). Empty = no reminders.
  - **F** — `status` (`active` / `done`)
- **Users sheet**: add a second tab for users. Row 1 = headers: **A** `sheetUser`, **B** `chatId`, **C** `name`, **D** `role`. Data from row 2; the bot fills rows when users run `/start`. If you don’t rename the tab, it’s often **Sheet2** — set `USERS_SHEET_NAME=Sheet2` in `.env`. If you name it **Users**, no env needed.
- Copy the **Spreadsheet ID** from the sheet URL: `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`.

**If you get "The caller does not have permission" (403):**

1. **Share the spreadsheet with the service account**
   - Open your JSON key file (or the Service Account page in Google Cloud Console). Find the **client_email** — it looks like `something@your-project.iam.gserviceaccount.com`.
   - Open your Google Sheet in the browser → **Share**.
   - Add that email as a **Editor** (not Viewer). Uncheck "Notify people" if you like.
   - Save. The bot uses this identity to access the sheet; without sharing, Google returns 403.

2. **Enable Google Sheets API**
   - In [Google Cloud Console](https://console.cloud.google.com/) → your project → **APIs & Services** → **Library**.
   - Search for **Google Sheets API** → open it → **Enable**.

3. **Confirm the service account and key**
   - The `GOOGLE_SERVICE_ACCOUNT_EMAIL` in `.env` must match the `client_email` from the **same** JSON key you use for `GOOGLE_PRIVATE_KEY`.
   - If you created a new service account, use the new email and new key together.

### 3. OpenAI

- Create an [API key](https://platform.openai.com/api-keys) and copy it.

### 4. Environment Variables

Copy `.env.example` to `.env` and set:

- `BOT_TOKEN` — Telegram bot token
- `OPENAI_API_KEY` — OpenAI API key
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — from the service account JSON
- `GOOGLE_PRIVATE_KEY` — full private key from JSON (keep newlines or use `\n`)
- `GOOGLE_SHEET_ID` — spreadsheet ID
- `CRON_SECRET` (optional) — secret to protect the cron endpoint
- `TASKS_SHEET_NAME` (optional) — tab name for tasks (default: `Sheet1`)
- `USERS_SHEET_NAME` (optional) — tab name for the 2nd sheet (e.g. `Users` or `Sheet2`)
- `USERS_SHEET_INDEX` (optional) — use 2nd tab by position: set to `1`; avoids "Unable to parse range" when the tab name does not match
- `HUSBAND_SHEET_USER` / `WIFE_SHEET_USER` (optional) — values that match your sheet column B, e.g. `alexey` / `tanyu`

### 5. Run locally (optional)

Use **long polling** so Telegram sends updates to your machine (no webhook or public URL):

1. If the bot already had a webhook set, remove it:
   ```bash
   curl "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook"
   ```
2. Copy `.env.example` to `.env` and fill in the variables.
3. Run:
   ```bash
   npm install
   npm run dev
   ```
   (`npm run dev` uses `tsx watch src/poll.ts` — restarts on file changes.)

When you deploy to Vercel again, set the webhook so Telegram sends updates to your app instead of polling.

### 6. Deploy to Vercel

```bash
npm install
npx vercel
```

Add the same environment variables in the Vercel project settings.

### 7. Set Telegram Webhook

After deployment, set the webhook so Telegram sends updates to your app:

```bash
# Replace BOT_TOKEN and YOUR_VERCEL_URL with your values
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<YOUR_VERCEL_URL>/api/webhook"
```

To use a secret token (recommended), set it in [BotFather](https://t.me/BotFather) (Bot Settings → Secret Token) and add the same value as `WEBHOOK_SECRET` when calling `setWebhook` (or configure in grammY webhook options).

### 8. Cron (Reminders)

- On Vercel Pro, the built-in cron runs every 30 minutes.
- On Hobby, use an external cron (e.g. [cron-job.org](https://cron-job.org)) to call `https://<YOUR_VERCEL_URL>/api/cron/reminders` with method POST and header `Authorization: Bearer <CRON_SECRET>` every 30 minutes.

## Commands

- `/start` — Register and choose role (husband/wife)
- `/tasks` — Show task list with buttons (complete, remind partner)
- `/help` — Short help

Voice or text examples (Russian):

- «Добавь задачу купить молоко Лёше»
- «Покажи мои задачи»
- «Напомни Тане про оплату счетов»
- «Напоминать про X каждые 3 дня» (72 hours)
- «Добавь задачу X для обоих» — unassigned task; both get reminders
- «Добавь задачу X Лёше» (without saying "напоминай") — task with no reminders; it only appears when you open the list

## Project structure

- `api/webhook.ts` — Vercel serverless webhook handler
- `api/cron/reminders.ts` — Cron: send due reminders, update next reminder time
- `src/bot.ts` — grammY bot and handler registration
- `src/handlers/` — Commands, voice, text, callbacks
- `src/services/` — Sheets, transcribe, LLM, notify
- `src/actions/execute.ts` — Execute parsed LLM actions
