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
import {
  getTasksDueForReminder,
  updateTask,
  getChatIdsForTaskUser,
} from "./services/sheets.js";
import { getNextNotificationAt, FAR_FUTURE } from "./services/notifySchedule.js";
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
        const chatIds = await getChatIdsForTaskUser(task.user);
        if (chatIds.length === 0) continue;
        if (chatIds.length > 1) {
          await sendReminderToMany(bot.api, chatIds, task.summary);
          log("reminder sent", { taskSummary: task.summary, to: "both" });
        } else {
          await sendReminder(bot.api, chatIds[0], task.summary);
          log("reminder sent", { taskSummary: task.summary, to: task.user });
        }
        const { next, isOneTime } = getNextNotificationAt(
          task.notify,
          now,
          now.toISOString(),
          task.createdAt
        );
        const nextNotificationAt = isOneTime ? FAR_FUTURE : next;
        await updateTask(task.id, {
          lastNotifiedAt: now.toISOString(),
          nextNotificationAt,
        });
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
