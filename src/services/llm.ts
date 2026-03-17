import OpenAI from "openai";
import { config } from "../config.js";
import type { LLMAction } from "../types.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const SYSTEM_PROMPT = `Ты — помощник семейного бота для списка задач. Пользователь пишет или диктует команды на русском.
Определи намерение и верни ОДИН JSON-объект без markdown и без лишнего текста.

Доступные действия (всегда отвечай только одним объектом):

1. create_task — создать задачу (по умолчанию, если из фразы непонятно другое действие):
   { "action": "create_task", "title": "текст задачи", "assignTo": "husband" | "wife" | "me" | "both", "notify": true | false, "periodMinutes": число или "periodHours": число }
   assignTo: "me" = кто пишет, "husband" = Лёша, "wife" = Таня, "both" = обоим. notify: true если просят напоминания. Если указан период — обязательно верни periodMinutes или periodHours: "каждую минуту" -> periodMinutes: 1, "каждые 5 минут" -> periodMinutes: 5, "каждый час" -> periodHours: 1, "каждую неделю" -> periodHours: 168, "каждые 3 дня" -> periodHours: 72. Если напоминания просят, но период не ясен — не указывай periodMinutes/periodHours (будет по умолчанию неделя).

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

6. set_reminder_period — напоминать о задаче регулярно (каждые N часов/дней/недель):
   { "action": "set_reminder_period", "taskTitle": "заголовок", "periodHours": число }
   periodHours: 24=день, 72=3 дня, 168=неделя. Примеры: "напоминай про X каждую неделю", "напоминать про Y каждые 3 дня".

7. set_reminder_once — одно напоминание тогда-то или через столько-то:
   { "action": "set_reminder_once", "taskTitle": "заголовок", "inHours": число } — через N часов
   или { "action": "set_reminder_once", "taskTitle": "заголовок", "atTime": "ISO дата-время" } — в конкретный момент
   Примеры: "напомни через 2 часа про X", "напомни завтра в 10 про Y". inHours — число часов от сейчас.

8. remove_reminders — убрать все напоминания по задаче (задача остаётся в списке):
   { "action": "remove_reminders", "taskTitle": "заголовок" }
   Примеры: "больше не напоминай про X", "убери напоминания по задаче Y", "не напоминать про прививку".

9. unknown — если не понял или приветствие: { "action": "unknown", "reply": "короткий ответ на русском" }

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
