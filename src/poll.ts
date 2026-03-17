/**
 * Local development: run the bot with long polling.
 * Telegram sends updates to your bot via polling; no webhook or public URL needed.
 *
 * Before running: if the bot was previously used with a webhook, remove it:
 *   curl "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook"
 *
 * Напоминания: при локальном запуске раз в минуту проверяются задачи и отправляются напоминания
 * (на проде то же делает Vercel Cron, вызывающий api/cron/reminders.ts).
 */
import "dotenv/config";
import { bot } from "./bot.js";
import { log } from "./logger.js";
import { getTasksDueForReminder, updateTask, getAllFamilyChatIds } from "./services/sheets.js";
import { sendReminder, sendReminderToMany } from "./services/notify.js";

const REMINDER_CHECK_INTERVAL_MS = 60_000; // 1 минута

async function runReminderCheck(): Promise<void> {
  try {
    const now = new Date();
    const due = await getTasksDueForReminder(now);
    if (due.length === 0) return;
    log("reminders (local)", { dueCount: due.length });
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

bot.start({
  onStart: (info) => {
    log("Bot running locally", { username: info.username });
    setInterval(runReminderCheck, REMINDER_CHECK_INTERVAL_MS);
    runReminderCheck();
  },
});
