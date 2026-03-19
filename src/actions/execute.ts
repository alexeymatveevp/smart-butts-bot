import type { Context } from "grammy";
import type { LLMAction } from "../types.js";
import {
  getActiveTasks,
  getTasks,
  addTask,
  updateTask,
  createTask,
  getChatIdByRole,
  getUserByChatId,
  getChatIdsForTaskUser,
  sheetUserToDisplayName,
} from "../services/sheets.js";
import { getNextNotificationAt, FAR_FUTURE } from "../services/notifySchedule.js";
import { sendReminder, sendReminderToMany } from "../services/notify.js";
import { config } from "../config.js";
import { log } from "../logger.js";

function findTaskBySummary(tasks: Awaited<ReturnType<typeof getTasks>>, title: string) {
  const lower = title.toLowerCase().trim();
  return tasks.find((t) => t.summary.toLowerCase().includes(lower) || lower.includes(t.summary.toLowerCase()));
}

export async function executeAction(ctx: Context, action: LLMAction): Promise<void> {
  const chatId = String(ctx.chat?.id);
  const user = await getUserByChatId(chatId);

  if (action.action === "unknown") {
    log("action: unknown", { reply: action.reply?.slice(0, 50) });
    await ctx.reply(action.reply);
    return;
  }

  if (action.action === "create_task") {
    let sheetUser: string;
    if (action.assignTo === "me") {
      if (!user) {
        await ctx.reply("Сначала нажми /start и выбери, кто ты.");
        return;
      }
      sheetUser = user.sheetUser ?? (user.role === "husband" ? config.husbandSheetUser : config.wifeSheetUser);
    } else if (action.assignTo === "both") {
      sheetUser = "";
    } else {
      const id = await getChatIdByRole(action.assignTo);
      if (!id) {
        await ctx.reply("Партнёр ещё не нажал /start. Пусть зайдёт в бота и выберет роль.");
        return;
      }
      sheetUser = action.assignTo === "husband" ? config.husbandSheetUser : config.wifeSheetUser;
    }
    const notify = (action.notify && String(action.notify).trim()) || "";
    const task = createTask({ user: sheetUser, summary: action.title, notify });
    await addTask(task);
    const displayName = sheetUserToDisplayName(sheetUser);
    log("new task created", { summary: action.title, user: displayName, notify: !!notify });
    const notifyNote = !notify
      ? " Без напоминаний — увидишь в списке по кнопке «Задачи»."
      : "";
    const forWhom = displayName === "Лёша" ? "Лёши" : displayName === "Таня" ? "Тани" : displayName;
    await ctx.reply(`Добавила задачу «${action.title}» для ${forWhom}.${notifyNote}`);
    return;
  }

  if (action.action === "list_tasks") {
    const tasks = await getActiveTasks();
    log("list_tasks", { count: tasks.length });
    if (tasks.length === 0) {
      await ctx.reply("Нет подходящих задач. Можешь сказать /tasks для кнопок.");
      return;
    }
    const lines = tasks.map((t) => `• ${sheetUserToDisplayName(t.user)}: ${t.summary}`);
    await ctx.reply("Задачи:\n" + lines.join("\n"));
    return;
  }

  if (action.action === "complete_task" || action.action === "delete_task") {
    const tasks = await getTasks();
    const task = findTaskBySummary(tasks, action.taskTitle);
    if (!task) {
      await ctx.reply("Такую задачу не нашла.");
      return;
    }
    await updateTask(task.id, { status: "done" });
    log("task completed", { summary: task.summary });
    const msg = action.action === "delete_task" ? "удалена из списка" : "отмечена выполненной";
    await ctx.reply(`Задача «${task.summary}» ${msg}.`);
    return;
  }

  if (action.action === "reassign_task") {
    const tasks = await getTasks();
    const task = findTaskBySummary(tasks, action.taskTitle);
    if (!task) {
      await ctx.reply("Такую задачу не нашла.");
      return;
    }
    const _newChatId = await getChatIdByRole(action.assignTo);
    if (!_newChatId) {
      await ctx.reply("Партнёр ещё не нажал /start. Пусть зайдёт в бота и выберет роль.");
      return;
    }
    const newSheetUser = action.assignTo === "husband" ? config.husbandSheetUser : config.wifeSheetUser;
    await updateTask(task.id, { user: newSheetUser });
    log("task reassigned", { summary: task.summary, assignTo: action.assignTo });
    const toWhom = action.assignTo === "husband" ? "Лёше" : "Тане";
    await ctx.reply(`Задача «${task.summary}» переназначена на ${toWhom}.`);
    return;
  }

  if (action.action === "remind_partner") {
    const tasks = await getActiveTasks();
    const task = findTaskBySummary(tasks, action.taskTitle);
    if (!task) {
      await ctx.reply("Такую задачу не нашла.");
      return;
    }
    const chatIds = await getChatIdsForTaskUser(task.user);
    if (chatIds.length === 0) {
      await ctx.reply("Не удалось определить, кому напомнить.");
      return;
    }
    if (chatIds.length > 1) {
      await sendReminderToMany(ctx.api, chatIds, task.summary);
      log("remind partner", { taskSummary: task.summary, to: "both", chatCount: chatIds.length });
      await ctx.reply("Напоминание отправлено обоим.");
    } else {
      await sendReminder(ctx.api, chatIds[0], task.summary);
      log("remind partner", { taskSummary: task.summary, to: task.user });
      const toWhom = sheetUserToDisplayName(task.user) === "Лёша" ? "Лёше" : sheetUserToDisplayName(task.user) === "Таня" ? "Тане" : sheetUserToDisplayName(task.user);
      await ctx.reply(`Напоминание отправлено ${toWhom}.`);
    }
    return;
  }

  if (action.action === "set_reminder") {
    const tasks = await getTasks();
    const task = findTaskBySummary(tasks, action.taskTitle);
    if (!task) {
      await ctx.reply("Такую задачу не нашла.");
      return;
    }
    const ref = new Date();
    const { next } = getNextNotificationAt(
      action.notify,
      ref,
      task.lastNotifiedAt || undefined,
      task.createdAt
    );
    await updateTask(task.id, { notify: action.notify, nextNotificationAt: next });
    log("reminder set", { taskSummary: task.summary, notify: action.notify });
    await ctx.reply(`Напоминание по задаче «${task.summary}» установлено.`);
    return;
  }

  if (action.action === "remove_reminders") {
    const tasks = await getTasks();
    const task = findTaskBySummary(tasks, action.taskTitle);
    if (!task) {
      await ctx.reply("Такую задачу не нашла.");
      return;
    }
    await updateTask(task.id, {
      notify: "",
      nextNotificationAt: FAR_FUTURE,
    });
    log("reminders removed", { taskSummary: task.summary });
    await ctx.reply(`Напоминания по задаче «${task.summary}» отключены. Задача остаётся в списке.`);
    return;
  }

  await ctx.reply("Не удалось выполнить. Попробуй ещё раз или /help.");
}
