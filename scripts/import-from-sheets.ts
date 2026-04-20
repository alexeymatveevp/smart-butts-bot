/**
 * One-time import: copy rows from Google Sheets into the local SQLite DB.
 *
 * Usage:
 *   1. Put the old GOOGLE_* vars back into .env (see .env.example).
 *   2. Make sure DATABASE_PATH points at the target SQLite file.
 *   3. npm run import-sheets
 *
 * Idempotent:
 *   - Tasks are deduped by (summary, created_at).
 *   - Users are upserted by chat_id.
 */
import "dotenv/config";
import { google } from "googleapis";
import { db } from "../src/services/db.js";
import { upsertUser } from "../src/services/storage.js";
import type { Task, User } from "../src/types.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const sheetId = requireEnv("GOOGLE_SHEET_ID");
const clientEmail = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
const privateKey = requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
const tasksSheet = process.env.TASKS_SHEET_NAME ?? "Sheet1";
const usersSheetName = process.env.USERS_SHEET_NAME;
const usersSheetIndex = process.env.USERS_SHEET_INDEX ? Number(process.env.USERS_SHEET_INDEX) : undefined;

function sheetRange(sheetName: string, a1: string): string {
  const needsQuotes = /[\s'"\\]/.test(sheetName);
  return needsQuotes ? `'${sheetName.replace(/'/g, "''")}'!${a1}` : `${sheetName}!${a1}`;
}

function getClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

async function resolveUsersSheetTitle(): Promise<string> {
  if (usersSheetName) return usersSheetName;
  if (usersSheetIndex !== undefined) {
    const sheets = getClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets.properties.title" });
    const tab = meta.data.sheets?.[usersSheetIndex];
    const title = tab?.properties?.title;
    if (!title) throw new Error(`No sheet at index ${usersSheetIndex}`);
    return title;
  }
  return "Users";
}

async function readTasks(): Promise<Task[]> {
  const sheets = getClient();
  const range = sheetRange(tasksSheet, "A2:G");
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  const rows = (res.data.values ?? []) as string[][];
  const tasks: Task[] = [];
  for (const row of rows) {
    if (!row || row.length < 2) continue;
    const summary = row[1]?.trim();
    if (!summary) continue;
    tasks.push({
      id: "new",
      user: row[0]?.trim() ?? "",
      summary,
      createdAt: row[2]?.trim() || new Date().toISOString(),
      notify: row[3]?.trim() ?? "",
      lastNotifiedAt: row[4]?.trim() ?? "",
      nextNotificationAt: row[5]?.trim() ?? "",
      status: row[6]?.trim() === "done" ? "done" : "active",
    });
  }
  return tasks;
}

async function readUsers(): Promise<User[]> {
  const sheets = getClient();
  const title = await resolveUsersSheetTitle();
  const range = sheetRange(title, "A2:D");
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  const rows = (res.data.values ?? []) as string[][];
  return rows
    .filter((r) => r.length >= 4 && r[1])
    .map((r) => ({
      sheetUser: r[0]?.trim(),
      chatId: r[1]?.trim() ?? "",
      name: r[2]?.trim() ?? "",
      role: (r[3]?.trim() === "wife" ? "wife" : "husband") as User["role"],
    }));
}

async function main() {
  const conn = db();

  console.log("Reading users from sheet...");
  const users = await readUsers();
  for (const u of users) await upsertUser(u);
  console.log(`  ${users.length} users upserted`);

  console.log("Reading tasks from sheet...");
  const tasks = await readTasks();
  const existsStmt = conn.prepare(
    "SELECT 1 AS hit FROM tasks WHERE summary = ? AND created_at = ? LIMIT 1"
  );
  const insertStmt = conn.prepare(
    `INSERT INTO tasks (user, summary, created_at, notify, last_notified_at, next_notification_at, status)
     VALUES (@user, @summary, @createdAt, @notify, @lastNotifiedAt, @nextNotificationAt, @status)`
  );
  let inserted = 0;
  let skipped = 0;
  const tx = conn.transaction((items: Task[]) => {
    for (const t of items) {
      const hit = existsStmt.get(t.summary, t.createdAt) as { hit: number } | undefined;
      if (hit) { skipped++; continue; }
      insertStmt.run({
        user: t.user,
        summary: t.summary,
        createdAt: t.createdAt,
        notify: t.notify,
        lastNotifiedAt: t.lastNotifiedAt,
        nextNotificationAt: t.nextNotificationAt,
        status: t.status,
      });
      inserted++;
    }
  });
  tx(tasks);

  console.log(`  ${inserted} tasks inserted, ${skipped} already present`);
  console.log("Import done.");
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
