import type { Bot } from "grammy";
import { InlineKeyboard, Keyboard } from "grammy";
import type { Context } from "grammy";
import { getActiveTasks, getUserByChatId, upsertUser } from "../services/sheets.js";
import type { UserRole } from "../types.js";
import { log } from "../logger.js";

/** Постоянная кнопка снизу чата — список задач */
export const mainKeyboard = new Keyboard()
  .text("Список дел")
  .resized()
  .persistent();

export async function sendTaskList(ctx: Context): Promise<void> {
  const tasks = await getActiveTasks();
  log("task list shown", { chatId: ctx.chat?.id, taskCount: tasks.length });
  if (tasks.length === 0) {
    await ctx.reply("Нет задач, мы все сделали!");
    return;
  }
  const keyboard = new InlineKeyboard();
  for (const t of tasks) {
    keyboard.text(`${t.assignedName}: ${t.title}`, `task:view:${t.id}`).row();
  }
  keyboard.text("Я сделяль", "task:complete_list").row();
  keyboard.text("Напомнить Лёше о...", "task:remind_partner");
  await ctx.reply("Дела дела:", { reply_markup: keyboard });
}

export function registerCommandHandlers(bot: Bot): void {
  bot.command("start", async (ctx) => {
    const chatId = String(ctx.chat?.id);
    const existing = await getUserByChatId(chatId);
    if (existing) {
      log("command /start", { chatId, existingUser: existing.name });
      await ctx.reply(
        `Снова привет, ${existing.name}! Используй /tasks для списка задач, /help для подсказок.`,
        { reply_markup: mainKeyboard }
      );
      return;
    }
    log("command /start", { chatId, newUser: true });
    await ctx.reply(
      "Таня, нажми кнопку Таня, а то я не знаю что будет если ты другую нажмешь:",
      {
        reply_markup: new InlineKeyboard()
          .text("Лёша", "role:husband")
          .text("Таня", "role:wife"),
      }
    );
  });

  bot.command("tasks", async (ctx) => {
    await sendTaskList(ctx);
  });

  bot.command("help", async (ctx) => {
    log("command /help", { chatId: ctx.chat?.id });
    await ctx.reply(
      "Команды:\n" +
        "/start — регистрация\n" +
        "/tasks — список задач с кнопками\n" +
        "/help — эта справка\n\n" +
        "Голосом или текстом можно сказать:\n" +
        "• «Добавь задачу купить молоко Лёше»\n" +
        "• «Покажи мои задачи»\n" +
        "• «Напомни Тане про оплату счетов»\n" +
        "• «Напоминать про X каждые 3 дня» (period in hours: 72)"
    );
  });
}

export async function setUserRole(chatId: string, role: UserRole, name: string): Promise<void> {
  await upsertUser({ chatId, name, role });
}
