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
  getAllFamilyChatIds,
} from "../services/sheets.js";
import { sendReminder, sendReminderToMany } from "../services/notify.js";
import { log } from "../logger.js";

function findTaskByTitle(tasks: Awaited<ReturnType<typeof getTasks>>, title: string) {
  const lower = title.toLowerCase().trim();
  return tasks.find((t) => t.title.toLowerCase().includes(lower) || lower.includes(t.title.toLowerCase()));
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
    let assignedTo: string;
    let assignedName: string;
    if (action.assignTo === "me") {
      if (!user) {
        await ctx.reply("Сначала нажми /start и выбери, кто ты.");
        return;
      }
      assignedTo = chatId;
      assignedName = user.role === "husband" ? "Лёша" : "Таня";
    } else if (action.assignTo === "both") {
      assignedTo = "";
      assignedName = "Оба";
    } else {
      const id = await getChatIdByRole(action.assignTo);
      if (!id) {
        await ctx.reply("Партнёр ещё не нажал /start. Пусть зайдёт в бота и выберет роль.");
        return;
      }
      assignedTo = id;
      assignedName = action.assignTo === "husband" ? "Лёша" : "Таня";
    }
    const rawHours = action.notify !== true ? 0 : (action.periodHours ?? undefined);
    const reminderHours =
      rawHours != null && rawHours > 0 && rawHours < 24 ? 24 : rawHours ?? undefined;
    const task = createTask({
      title: action.title,
      assignedTo,
      assignedName,
      createdBy: chatId,
      reminderPeriodHours: reminderHours,
    });
    await addTask(task);
    log("new task created", { title: action.title, assignedName, notify: action.notify === true });
    const notifyNote =
      action.notify !== true
        ? " Без напоминаний — увидишь в списке по кнопке «Задачи»."
        : "";
    const forWhom = assignedName === "Лёша" ? "Лёши" : assignedName === "Таня" ? "Тани" : assignedName;
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
    const lines = tasks.map((t) => `• ${t.assignedName}: ${t.title}`);
    await ctx.reply("Задачи:\n" + lines.join("\n"));
    return;
  }

  if (action.action === "complete_task" || action.action === "delete_task") {
    const tasks = await getTasks();
    const task = findTaskByTitle(tasks, action.taskTitle);
    if (!task) {
      await ctx.reply("Такую задачу не нашла.");
      return;
    }
    await updateTask(task.id, { status: "done" });
    log("task completed", { title: task.title });
    const msg = action.action === "delete_task" ? "удалена из списка" : "отмечена выполненной";
    await ctx.reply(`Задача «${task.title}» ${msg}.`);
    return;
  }

  if (action.action === "reassign_task") {
    const tasks = await getTasks();
    const task = findTaskByTitle(tasks, action.taskTitle);
    if (!task) {
      await ctx.reply("Такую задачу не нашла.");
      return;
    }
    const newChatId = await getChatIdByRole(action.assignTo);
    if (!newChatId) {
      await ctx.reply("Партнёр ещё не нажал /start. Пусть зайдёт в бота и выберет роль.");
      return;
    }
    const assignedName = action.assignTo === "husband" ? "Лёша" : "Таня";
    await updateTask(task.id, { assignedTo: newChatId, assignedName });
    log("task reassigned", { title: task.title, assignTo: action.assignTo });
    const toWhom = assignedName === "Лёша" ? "Лёше" : "Тане";
    await ctx.reply(`Задача «${task.title}» переназначена на ${toWhom}.`);
    return;
  }

  if (action.action === "remind_partner") {
    const tasks = await getActiveTasks();
    const task = findTaskByTitle(tasks, action.taskTitle);
    if (!task) {
      await ctx.reply("Такую задачу не нашла.");
      return;
    }
    if (!task.assignedTo || task.assignedName === "Оба") {
      const chatIds = await getAllFamilyChatIds();
      await sendReminderToMany(ctx.api, chatIds, task.title);
      log("remind partner", { taskTitle: task.title, to: "both", chatCount: chatIds.length });
      await ctx.reply("Напоминание отправлено обоим.");
    } else {
      await sendReminder(ctx.api, task.assignedTo, task.title);
      log("remind partner", { taskTitle: task.title, to: task.assignedName });
      const toWhom = task.assignedName === "Лёша" ? "Лёше" : task.assignedName === "Таня" ? "Тане" : task.assignedName;
      await ctx.reply(`Напоминание отправлено ${toWhom}.`);
    }
    return;
  }

  if (action.action === "set_reminder_period") {
    const tasks = await getTasks();
    const task = findTaskByTitle(tasks, action.taskTitle);
    if (!task) {
      await ctx.reply("Такую задачу не нашла.");
      return;
    }
    const periodHours = Math.max(24, action.periodHours);
    const next = new Date(Date.now() + periodHours * 60 * 60 * 1000).toISOString();
    await updateTask(task.id, {
      reminderPeriodHours: periodHours,
      nextReminderAt: next,
      lastNotified: new Date().toISOString(),
    });
    log("reminder period set", { taskTitle: task.title, periodHours });
    const periodText =
      periodHours >= 168
        ? `каждые ${periodHours / 168} нед.`
        : `каждые ${periodHours / 24} дн.`;
    await ctx.reply(`Напоминания по задаче «${task.title}» теперь ${periodText}`);
    return;
  }

  if (action.action === "set_reminder_once") {
    const tasks = await getTasks();
    const task = findTaskByTitle(tasks, action.taskTitle);
    if (!task) {
      await ctx.reply("Такую задачу не нашла.");
      return;
    }
    let next: string;
    if (action.inHours != null) {
      const hours = Math.max(24, action.inHours);
      next = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    } else if (action.atTime) {
      const t = new Date(action.atTime);
      if (Number.isNaN(t.getTime())) {
        await ctx.reply("Не смогла разобрать дату. Скажи, например: «напомни через 2 дня».");
        return;
      }
      const minTime = Date.now() + 24 * 60 * 60 * 1000;
      if (t.getTime() < minTime) {
        await ctx.reply("Минимальный интервал напоминания — 1 день. Укажи дату не раньше завтра.");
        return;
      }
      next = t.toISOString();
    } else {
      await ctx.reply("Укажи когда напомнить: «через N дней» или точную дату (минимум 1 день).");
      return;
    }
    await updateTask(task.id, {
      reminderPeriodHours: 0,
      nextReminderAt: next,
    });
    log("reminder once set", { taskTitle: task.title, next });
    await ctx.reply(`Напомню о задаче «${task.title}» в указанное время (один раз).`);
    return;
  }

  if (action.action === "remove_reminders") {
    const tasks = await getTasks();
    const task = findTaskByTitle(tasks, action.taskTitle);
    if (!task) {
      await ctx.reply("Такую задачу не нашла.");
      return;
    }
    await updateTask(task.id, {
      reminderPeriodHours: 0,
      nextReminderAt: "9999-12-31T23:59:59.000Z",
    });
    log("reminders removed", { taskTitle: task.title });
    await ctx.reply(`Напоминания по задаче «${task.title}» отключены. Задача остаётся в списке.`);
    return;
  }

  await ctx.reply("Не удалось выполнить. Попробуй ещё раз или /help.");
}
