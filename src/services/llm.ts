import OpenAI from "openai";
import { config } from "../config.js";
import type { LLMAction } from "../types.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const SYSTEM_PROMPT = `Ты — помощник семейного бота для списка задач. Пользователь пишет или диктует команды на русском.
Определи намерение и верни ОДИН JSON-объект без markdown и без лишнего текста.

Доступные действия (всегда отвечай только одним объектом):

1. create_task — создать задачу (по умолчанию, если из фразы непонятно другое действие):
   { "action": "create_task", "title": "текст задачи", "assignTo": "husband" | "wife" | "me" | "both", "notify": "строка или опусти" }
   assignTo: "me" = кто пишет, "husband" = Лёша, "wife" = Таня, "both" = обоим.
   notify: строка на АНГЛИЙСКОМ в формате, который понимает парсер дат. Если напоминаний не просят — не указывай notify или передай пустую строку.
   Примеры notify: "tomorrow at 6pm", "every 1 week", "every 2 days starting tomorrow", "next Monday at 9:00 AM", "2 weeks from now", "every 1 day". Для одного раза: "tomorrow at 18:00", "next Tuesday at 10am".

2. list_tasks — показать список задач:
   { "action": "list_tasks", "filter": "my" | "all" }
   Примеры: "покажи задачи", "что по делам", "мои задачи", "список дел".

3. complete_task — завершить или удалить задачу (отметить выполненной):
   { "action": "complete_task", "taskTitle": "частичный или точный заголовок" }
   Примеры: "удали задачу про молоко", "заверши прививку", "сделала окно", "отметь выполненной задачу X".

4. reassign_task — переназначить задачу на Лёшу или Таню:
   { "action": "reassign_task", "taskTitle": "заголовок задачи", "assignTo": "husband" | "wife" }
   Примеры: "переназначь задачу X на Лёшу", "передай Тане задачу про счёт", "пусть Таня делает задачу Y".

5. remind_partner — напомнить партнёру о задаче прямо сейчас:
   { "action": "remind_partner", "taskTitle": "заголовок" }
   Примеры: "напомни Лёше про задачу", "напомни о прививке".

6. set_reminder — установить или изменить напоминание по задаче (один раз или повторяющееся):
   { "action": "set_reminder", "taskTitle": "заголовок", "notify": "строка на английском" }
   notify: та же схема что и в create_task. Примеры: "tomorrow at 18:00", "every 1 week", "every 2 days starting tomorrow", "next Friday at 9am".

7. remove_reminders — убрать все напоминания по задаче (задача остаётся в списке):
   { "action": "remove_reminders", "taskTitle": "заголовок" }
   Примеры: "больше не напоминай про X", "убери напоминания по задаче Y", "не напоминать про прививку".

8. unknown — если не понял или приветствие: { "action": "unknown", "reply": "короткий ответ на русском" }

Важно: отвечай ТОЛЬКО валидным JSON, без \`\`\` и без пояснений. По умолчанию (неясный контекст) — create_task.`;

export async function parseUserIntent(
  userText: string,
  currentUserRole: "husband" | "wife" | undefined
): Promise<LLMAction> {
  const roleContext = currentUserRole
    ? `Текущий пользователь: ${currentUserRole} (Лёша/Таня).`
    : "Роль пользователя неизвестна.";
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT + " " + roleContext },
      { role: "user", content: userText },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });
  const raw = response.choices[0]?.message?.content?.trim();
  if (!raw) return { action: "unknown", reply: "Не понял, попробуй ещё раз." };
  try {
    const parsed = JSON.parse(raw) as LLMAction;
    if (parsed.action) return parsed;
  } catch {
    // ignore
  }
  return { action: "unknown", reply: raw };
}

/** Одно короткое ободряющее предложение, релевантное задаче, чтобы помочь начать. */
export async function getEncouragingLineForTask(taskTitle: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "Ты помогаешь человеку начать задачу. Напиши ОДНО короткое ободряющее предложение на русском, релевантное задаче (например: «Пять минут — и дело сдвинется» или «Пара звонков — и готово»). Без кавычек, без пояснений, только одно предложение.",
      },
      { role: "user", content: `Задача: ${taskTitle}` },
    ],
    max_tokens: 60,
    temperature: 0.5,
  });
  const line = response.choices[0]?.message?.content?.trim();
  return line ? line.replace(/^["']|["']$/g, "") : "";
}
