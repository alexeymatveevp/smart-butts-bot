# Family Todo Telegram Bot

Telegram bot for a shared family todo list: voice commands, task assignment, and reminders. Built with Node.js, TypeScript, grammY, SQLite (better-sqlite3), and OpenAI.

## Setup

### 1. Telegram Bot

- Open [@BotFather](https://t.me/BotFather), create a bot with `/newbot`, and copy the token.

### 2. OpenAI

- Create an [API key](https://platform.openai.com/api-keys) and copy it.

### 3. Environment Variables

Copy `.env.example` to `.env` and set:

- `BOT_TOKEN` — Telegram bot token
- `OPENAI_API_KEY` — OpenAI API key
- `DATABASE_PATH` — path to the SQLite file (default: `./data/bot.db`). On a VPS, prefer an absolute path like `/var/lib/smart-butts-bot/bot.db`. Parent directories are created on first run.
- `HUSBAND_CHAT_ID` / `WIFE_CHAT_ID` (optional) — pre-configured chat IDs; otherwise discovered via `/start`
- `HUSBAND_SHEET_USER` / `WIFE_SHEET_USER` (optional) — labels stored in `tasks.user` (default: `alexey` / `tanyu`). Empty or `both` / `оба` = unassigned (both get reminders).

The `users` and `tasks` tables are created automatically when the bot starts.

### 4. Run locally

Long polling — no webhook or public URL needed:

1. If the bot previously had a webhook, remove it:
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

### 5. Deploy to a VPS

One process handles everything: long polling + the once-per-minute reminder check. Webhook is not needed.

1. Clone the repo on the VPS, `npm install`, `npm run build`.
2. Set a durable `DATABASE_PATH` (e.g. `/var/lib/smart-butts-bot/bot.db`) in `.env`. Make sure the service user can read/write the parent directory.
3. Start with `npm start` (runs `node dist/src/poll.js`). Wire it into `systemd` / `pm2` / Docker as you prefer.
4. The process listens on `PORT` (default `3000`) and returns `200 OK` for health checks.

Back up the SQLite file the same way you'd back up any data file — `sqlite3 bot.db ".backup '/path/to/backup.db'"` works while the bot is running.

### 6. Importing existing Google Sheets data (one-time)

If you were running the previous Sheets-backed version and want to carry over existing tasks/users:

1. Temporarily add the old `GOOGLE_*` vars back to `.env` (see `.env.example`).
2. Run:
   ```bash
   npm run import-sheets
   ```
3. Remove the `GOOGLE_*` vars from `.env` once done.

The script is idempotent — rerun it safely.

### 7. Reminders

The scheduler runs in-process: every minute it checks due tasks and sends reminders. No external cron needed.

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

- `src/poll.ts` — entry point: long polling, reminder scheduler (runs every minute), HTTP health check
- `src/bot.ts` — grammY bot and handler registration
- `src/handlers/` — commands, voice, text, callbacks
- `src/services/` — `db.ts` (SQLite connection + schema bootstrap), `storage.ts` (tasks/users CRUD), `transcribe`, `llm`, `notify`
- `src/actions/execute.ts` — execute parsed LLM actions
- `scripts/import-from-sheets.ts` — one-time migration from the old Google Sheets backend
