import type { Api } from "grammy";
import { getEncouragingLineForTask } from "./llm.js";

const FALLBACK_LINE = "Ты справишься!";

async function reminderText(taskTitle: string): Promise<string> {
  const base = `Эй, не забудь: ${taskTitle}!`;
  try {
    const line = await getEncouragingLineForTask(taskTitle);
    if (line) return `${base}\n\n${line}`;
  } catch {
    // ignore
  }
  return `${base}\n\n${FALLBACK_LINE}`;
}

export async function sendReminder(api: Api, chatId: string, taskTitle: string): Promise<void> {
  const text = await reminderText(taskTitle);
  await api.sendMessage(chatId, text);
}

/** Send reminder to multiple chats (e.g. both partners for unassigned tasks). */
export async function sendReminderToMany(
  api: Api,
  chatIds: string[],
  taskTitle: string
): Promise<void> {
  const text = await reminderText(taskTitle);
  for (const chatId of chatIds) {
    try {
      await api.sendMessage(chatId, text);
    } catch (err) {
      console.error("Reminder to", chatId, "failed:", err);
    }
  }
}
