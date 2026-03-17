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
  google: {
    clientEmail: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    privateKey: requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    sheetId: requireEnv("GOOGLE_SHEET_ID"),
  },
  cronSecret: optionalEnv("CRON_SECRET"),
  husbandChatId: optionalEnv("HUSBAND_CHAT_ID"),
  wifeChatId: optionalEnv("WIFE_CHAT_ID"),
  /** Sheet tab name for tasks (your existing tab, e.g. "Sheet1") */
  tasksSheetName: optionalEnv("TASKS_SHEET_NAME") ?? "Sheet1",
  /** Sheet tab name for users, or use USERS_SHEET_INDEX to use 2nd tab by position (e.g. 1) */
  usersSheetName: optionalEnv("USERS_SHEET_NAME"),
  /** If set (e.g. 1 = second tab), use this tab for Users instead of usersSheetName; avoids "Unable to parse range" when tab name differs */
  usersSheetIndex: optionalEnv("USERS_SHEET_INDEX") ? Number(optionalEnv("USERS_SHEET_INDEX")) : undefined,
  /** Column B value for husband (must match your sheet's "user" column) */
  husbandSheetUser: optionalEnv("HUSBAND_SHEET_USER") ?? "alexey",
  /** Column B value for wife */
  wifeSheetUser: optionalEnv("WIFE_SHEET_USER") ?? "tanyu",
} as const;

export const DEFAULT_REMINDER_HOURS = 168; // 1 week
