import type { Bot } from "grammy";
import { config } from "../config.js";
import { transcribeVoiceFromTelegram } from "../services/transcribe.js";
import { parseUserIntent } from "../services/llm.js";
import { getUserByChatId } from "../services/sheets.js";
import { executeAction } from "../actions/execute.js";
import { log } from "../logger.js";

export function registerVoiceHandler(bot: Bot): void {
  bot.on("message:voice", async (ctx) => {
    log("voice message received");
    const fileId = ctx.message.voice.file_id;
    const getFile = async (fid: string) => {
      const f = await ctx.api.getFile(fid);
      const path = f.file_path;
      if (!path) throw new Error("No file_path from Telegram");
      return { file_path: path };
    };
    const downloadUrl = (filePath: string) =>
      `https://api.telegram.org/file/bot${config.botToken}/${filePath}`;

    const waitReplies = [
      "Айн момент",
      "Секундочку...",
      "Щас..",
      "Думаю",
      "...",
      "Так так так.. момент",
    ];
    await ctx.reply(waitReplies[Math.floor(Math.random() * waitReplies.length)]);
    let text: string;
    try {
      text = await transcribeVoiceFromTelegram(fileId, getFile, downloadUrl);
    } catch (err) {
      console.error("Transcribe error:", err);
      await ctx.reply("Не удалось распознать голос. Попробуй ещё раз или напиши текстом.");
      return;
    }
    if (!text) {
      await ctx.reply("Текст не распознан. Попробуй ещё раз.");
      return;
    }
    log("voice transcribed", { text: text.slice(0, 60) });
    const user = await getUserByChatId(String(ctx.chat?.id));
    const action = await parseUserIntent(text, user?.role);
    log("voice command parsed", { action: action.action });
    await executeAction(ctx, action);
  });
}
