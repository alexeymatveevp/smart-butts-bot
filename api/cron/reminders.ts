import { Bot } from "grammy";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getTasksDueForReminder, updateTask, getAllFamilyChatIds } from "../../src/services/sheets.js";
import { sendReminder, sendReminderToMany } from "../../src/services/notify.js";
import { config as appConfig } from "../../src/config.js";
import { log } from "../../src/logger.js";

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).end();
    return;
  }
  if (appConfig.cronSecret) {
    const auth = req.headers.authorization;
    const token = auth?.replace(/^Bearer\s+/i, "").trim();
    if (token !== appConfig.cronSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }
  const bot = new Bot(appConfig.botToken);
  const now = new Date();
  const due = await getTasksDueForReminder(now);
  log("cron reminders", { dueCount: due.length });
  for (const task of due) {
    try {
      if (!task.assignedTo || task.assignedName === "Оба") {
        const chatIds = await getAllFamilyChatIds();
        await sendReminderToMany(bot.api, chatIds, task.title);
        log("reminder sent (scheduled)", { taskTitle: task.title, to: "both" });
      } else {
        await sendReminder(bot.api, task.assignedTo, task.title);
        log("reminder sent (scheduled)", { taskTitle: task.title, to: task.assignedName });
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
  res.status(200).json({ sent: due.length });
}
