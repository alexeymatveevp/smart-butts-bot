import { Bot } from "grammy";
import { config } from "./config.js";
import { registerCommandHandlers } from "./handlers/commands.js";
import { registerCallbackHandlers } from "./handlers/callbacks.js";
import { registerVoiceHandler } from "./handlers/voice.js";
import { registerTextHandler } from "./handlers/text.js";

export const bot = new Bot(config.botToken);

registerCommandHandlers(bot);
registerCallbackHandlers(bot);
registerVoiceHandler(bot);
registerTextHandler(bot);

// Fallback for unhandled
bot.catch((err) => {
  console.error("Bot error:", err);
});
