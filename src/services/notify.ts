import type { Api } from "grammy";

export async function sendReminder(api: Api, chatId: string, taskTitle: string): Promise<void> {
  await api.sendMessage(chatId, `Эй, не забудь: ${taskTitle}!`);
}

/** Send reminder to multiple chats (e.g. both partners for unassigned tasks). */
export async function sendReminderToMany(
  api: Api,
  chatIds: string[],
  taskTitle: string
): Promise<void> {
  const text = `Эй, не забудь: ${taskTitle}!`;
  for (const chatId of chatIds) {
    try {
      await api.sendMessage(chatId, text);
    } catch (err) {
      console.error("Reminder to", chatId, "failed:", err);
    }
  }
}
