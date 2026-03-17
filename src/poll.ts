/**
 * Entry point for Railway (and local dev): long polling + планировщик напоминаний.
 *
 * - Бот получает обновления через long polling (webhook не нужен).
 * - Раз в минуту проверяются задачи из таблицы и отправляются напоминания.
 * - HTTP‑сервер на PORT для health check (Railway).
 *
 * Если раньше был webhook: curl "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook"
 */
import "dotenv/config";
import http from "node:http";
import { bot } from "./bot.js";
import { log } from "./logger.js";
import { getTasksDueForReminder, updateTask, getAllFamilyChatIds } from "./services/sheets.js";
import { sendReminder, sendReminderToMany } from "./services/notify.js";

const REMINDER_CHECK_INTERVAL_MS = 60_000; // раз в минуту
const PORT = Number(process.env.PORT) || 3000;

async function runReminderCheck(): Promise<void> {
  try {
    const now = new Date();
    const due = await getTasksDueForReminder(now);
    if (due.length === 0) return;
    log("reminders", { dueCount: due.length });
    for (const task of due) {
      try {
        if (!task.assignedTo || task.assignedName === "Оба") {
          const chatIds = await getAllFamilyChatIds();
          await sendReminderToMany(bot.api, chatIds, task.title);
          log("reminder sent", { taskTitle: task.title, to: "both" });
        } else {
          await sendReminder(bot.api, task.assignedTo, task.title);
          log("reminder sent", { taskTitle: task.title, to: task.assignedName });
        }
        const next =
          task.reminderPeriodHours > 0
            ? new Date(now.getTime() + task.reminderPeriodHours * 60 * 60 * 1000).toISOString()
            : "9999-12-31T23:59:59.000Z";
        await updateTask(task.id, { nextReminderAt: next, lastNotified: now.toISOString() });
      } catch (err) {
        console.error("[bot] Reminder failed for task", task.id, err);
      }
    }
  } catch (err) {
    console.error("[bot] Reminder check failed", err);
  }
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok");
});
server.listen(PORT, () => log("Health check", { port: PORT }));

bot.start({
  onStart: (info) => {
    log("Bot running", { username: info.username });
    setInterval(runReminderCheck, REMINDER_CHECK_INTERVAL_MS);
    runReminderCheck();
  },
});
