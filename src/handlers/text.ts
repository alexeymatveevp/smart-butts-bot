import type { Bot } from "grammy";
import { parseUserIntent } from "../services/llm.js";
import { getUserByChatId } from "../services/sheets.js";
import { executeAction } from "../actions/execute.js";
import { sendTaskList } from "./commands.js";
import { log } from "../logger.js";

export function registerTextHandler(bot: Bot): void {
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text?.trim();
    if (!text) return;
    // Skip commands (handled by command handlers)
    if (text.startsWith("/")) return;

    // Кнопка «Список дел» — тот же список, что и /tasks
    if (text === "Список дел") {
      await sendTaskList(ctx);
      return;
    }

    log("text command received", { text: text.slice(0, 50) });
    const user = await getUserByChatId(String(ctx.chat?.id));
    const action = await parseUserIntent(text, user?.role);
    log("text command parsed", { action: action.action });
    await executeAction(ctx, action);
  });
}
