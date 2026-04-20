function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name];
}

export const config = {
  botToken: requireEnv("BOT_TOKEN"),
  openaiApiKey: requireEnv("OPENAI_API_KEY"),
  /** Path to SQLite database file. Created (with parents) on first run. */
  databasePath: optionalEnv("DATABASE_PATH") ?? "./data/bot.db",
  husbandChatId: optionalEnv("HUSBAND_CHAT_ID"),
  wifeChatId: optionalEnv("WIFE_CHAT_ID"),
  /** Value stored in tasks.user for husband (free-form label, e.g. "alexey") */
  husbandSheetUser: optionalEnv("HUSBAND_SHEET_USER") ?? "alexey",
  /** Value stored in tasks.user for wife */
  wifeSheetUser: optionalEnv("WIFE_SHEET_USER") ?? "tanyu",
} as const;
