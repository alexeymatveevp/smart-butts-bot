import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  getActiveTasks,
  getTasks,
  updateTask,
  getUserByChatId,
  getChatIdsForTaskUser,
  sheetUserToDisplayName,
} from "../services/sheets.js";
import { sendReminder, sendReminderToMany } from "../services/notify.js";
import { setUserRole, mainKeyboard } from "./commands.js";
import { log } from "../logger.js";

export function registerCallbackHandlers(bot: Bot): void {
  bot.callbackQuery("role:husband", async (ctx) => {
    const chatId = String(ctx.chat?.id);
    const name = ctx.from?.first_name ?? "Лёша";
    log("user registered", { chatId, role: "husband", name });
    try {
      await setUserRole(chatId, "husband", name);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(`Принято, ${name}. Используй /tasks и голосовые команды.`);
      await ctx.reply("Кнопка «Список дел» внизу — жми когда нужно.", { reply_markup: mainKeyboard });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.answerCallbackQuery({ text: "Ошибка записи в таблицу" });
      await ctx.reply(`Не удалось сохранить в Google Таблицу: ${msg}\n\nПроверь, что таблица открыта по ссылке из .env и расшарена на ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} (Editor).`);
    }
  });

  bot.callbackQuery("role:wife", async (ctx) => {
    const chatId = String(ctx.chat?.id);
    const name = ctx.from?.first_name ?? "Таня";
    log("user registered", { chatId, role: "wife", name });
    try {
      await setUserRole(chatId, "wife", name);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(`Принято, ${name}. Используй /tasks и голосовые команды.`);
      await ctx.reply("Кнопка «Список дел» внизу — жми когда нужно.", { reply_markup: mainKeyboard });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.answerCallbackQuery({ text: "Ошибка записи в таблицу" });
      await ctx.reply(`Не удалось сохранить в Google Таблицу: ${msg}\n\nПроверь, что таблица открыта по ссылке из .env и расшарена на ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} (Editor).`);
    }
  });

  bot.callbackQuery(/^task:view:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    log("callback task:view", { taskId: id });
    const tasks = await getTasks();
    const task = tasks.find((t) => t.id === id);
    await ctx.answerCallbackQuery();
    if (!task) {
      await ctx.reply("Задача не найдена.");
      return;
    }
    await ctx.reply(
      `Задача: ${task.summary}\nНазначена: ${sheetUserToDisplayName(task.user)}\nНапоминание: ${task.notify || "нет"}`
    );
  });

  bot.callbackQuery("task:complete_list", async (ctx) => {
    log("callback task:complete_list");
    const tasks = await getActiveTasks();
    if (tasks.length === 0) {
      await ctx.answerCallbackQuery({ text: "Нет активных задач." });
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const t of tasks) {
      keyboard.text(t.summary, `task:complete:${t.id}`).row();
    }
    await ctx.answerCallbackQuery();
    await ctx.reply("Выбери задачу для отметки выполненной:", { reply_markup: keyboard });
  });

  bot.callbackQuery(/^task:complete:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    log("callback task:complete", { taskId: id });
    await updateTask(id, { status: "done" });
    await ctx.answerCallbackQuery({ text: "Отмечено выполненной." });
    await ctx.reply("Задача отмечена выполненной.");
  });

  bot.callbackQuery("task:remind_partner", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      const user = await getUserByChatId(String(ctx.chat?.id));
      const partnerRole = user?.role === "husband" ? "wife" : "husband";
      const partnerLabel = partnerRole === "husband" ? "Лёша" : "Таня";
      const partnerLabelShort = partnerRole === "husband" ? "Лёше" : "Тане";
      const tasks = await getActiveTasks();
      const partnerTasks = tasks.filter(
        (t) => sheetUserToDisplayName(t.user) === partnerLabel || sheetUserToDisplayName(t.user) === "Оба"
      );
      if (partnerTasks.length === 0) {
        await ctx.reply(`Нет задач для напоминания ${partnerLabelShort}.`);
        return;
      }
      const keyboard = new InlineKeyboard();
      for (const t of partnerTasks) {
        const label = sheetUserToDisplayName(t.user) === "Оба" ? `${t.summary} (оба)` : t.summary;
        keyboard.text(label, `task:remind:${t.id}`).row();
      }
      await ctx.reply(`Напомнить ${partnerLabelShort} о задаче (выбери):`, {
        reply_markup: keyboard,
      });
    } catch (err) {
      log("task:remind_partner error", err);
      await ctx.reply("Не удалось загрузить список задач. Попробуй ещё раз.");
    }
  });

  bot.callbackQuery(/^task:remind:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    await ctx.answerCallbackQuery({ text: "Отправляю напоминание..." });
    try {
      const tasks = await getTasks();
      const task = tasks.find((t) => t.id === id);
      if (!task) {
        await ctx.reply("Задача не найдена.");
        return;
      }
      const chatIds = await getChatIdsForTaskUser(task.user);
      if (chatIds.length === 0) {
        await ctx.reply("Не удалось определить, кому напомнить.");
        return;
      }
      if (chatIds.length > 1) {
        await sendReminderToMany(bot.api, chatIds, task.summary);
        await ctx.reply("Напоминание отправлено обоим.");
      } else {
        await sendReminder(bot.api, chatIds[0], task.summary);
        const toWhom = sheetUserToDisplayName(task.user) === "Лёша" ? "Лёше" : sheetUserToDisplayName(task.user) === "Таня" ? "Тане" : sheetUserToDisplayName(task.user);
        await ctx.reply(`Напоминание отправлено ${toWhom}.`);
      }
    } catch (err) {
      log("task:remind error", { taskId: id, err });
      await ctx.reply("Не удалось отправить напоминание. Попробуй ещё раз.");
    }
  });
}
