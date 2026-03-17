import { google } from "googleapis";
import { config } from "../config.js";
import type { Task, User } from "../types.js";
import { DEFAULT_REMINDER_HOURS } from "../config.js";
import { log } from "../logger.js";

// Users sheet: name from config or resolved by index (2nd tab). Row 1 = headers, data from row 2.

/** A1 range for a sheet; quote name only if it contains spaces or special chars (Sheets API is picky). */
function sheetRange(sheetName: string, a1: string): string {
  const needsQuotes = /[\s'"\\]/.test(sheetName);
  return needsQuotes ? `'${sheetName.replace(/'/g, "''")}'!${a1}` : `${sheetName}!${a1}`;
}

let cachedUsersSheetTitle: string | null = null;

/** Resolve the Users sheet title: by name, or by index (e.g. 1 = second tab) from the API. */
async function getUsersSheetTitle(): Promise<string> {
  if (config.usersSheetName) return config.usersSheetName;
  if (config.usersSheetIndex !== undefined) {
    if (cachedUsersSheetTitle) return cachedUsersSheetTitle;
    const sheets = getClient();
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: config.google.sheetId,
      fields: "sheets.properties.title",
    });
    const tab = meta.data.sheets?.[config.usersSheetIndex];
    const title = tab?.properties?.title;
    if (!title) throw new Error(`No sheet at index ${config.usersSheetIndex}. Check USERS_SHEET_INDEX.`);
    cachedUsersSheetTitle = title;
    return title;
  }
  return "Users";
}

// Tasks sheet: A=user, B=summary, C=created, D=lastNotified, E=notify, F=status
// user = sheet user name (alexey, tanyu). notify = schedule template (e.g. "every 1 week"). No id column — we use row index.
const TASKS_COL_USER = 0;
const TASKS_COL_SUMMARY = 1;
const TASKS_COL_CREATED = 2;
const TASKS_COL_NEXT = 3;
const TASKS_COL_NOTIFY = 4;
const TASKS_COL_STATUS = 5;
const TASKS_DATA_START = 2;

function getClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: config.google.clientEmail,
      private_key: config.google.privateKey,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/** Parse "every 1 week", "every 3 days", "every 5 minutes" to hours. Empty = 0. */
function parseNotifyToHours(notify: string): number {
  const s = (notify || "").trim().toLowerCase();
  if (!s || /^(no|none|never|—|нет|без напоминаний?)$/.test(s)) return 0;
  const weekMatch = s.match(/every\s*(\d+)\s*week/i);
  const dayMatch = s.match(/every\s*(\d+)\s*day/i);
  const hourMatch = s.match(/every\s*(\d+)\s*hour/i);
  const minMatch = s.match(/every\s*(\d+)\s*minute/i);
  if (weekMatch) return Number(weekMatch[1]) * 168;
  if (dayMatch) return Number(dayMatch[1]) * 24;
  if (hourMatch) return Number(hourMatch[1]);
  if (minMatch) return Number(minMatch[1]) / 60;
  return DEFAULT_REMINDER_HOURS;
}

/** Format hours to "every N week(s)", "every N day(s)", "every N hour(s)", or "every N minute(s)". */
function formatNotifyFromHours(hours: number): string {
  if (!hours) return "";
  if (hours >= 168 && hours % 168 === 0) {
    const w = hours / 168;
    return w === 1 ? "every 1 week" : `every ${w} weeks`;
  }
  if (hours >= 24 && hours % 24 === 0) {
    const d = hours / 24;
    return d === 1 ? "every 1 day" : `every ${d} days`;
  }
  if (hours >= 1 && Number.isInteger(hours)) {
    return hours === 1 ? "every 1 hour" : `every ${hours} hours`;
  }
  if (hours < 1 && hours > 0) {
    const mins = Math.round(hours * 60);
    return mins === 1 ? "every 1 minute" : `every ${mins} minutes`;
  }
  return `every ${hours} hours`;
}

function sheetUserToAssignedName(sheetUser: string): string {
  if (!sheetUser || sheetUser === "both" || sheetUser.toLowerCase() === "оба") return "Оба";
  if (sheetUser === config.husbandSheetUser) return "Лёша";
  if (sheetUser === config.wifeSheetUser) return "Таня";
  return sheetUser;
}

/** Column E = lastNotified. We compute nextReminderAt = lastNotified + period (or createdAt + period). */
function addHours(isoDate: string, hours: number): string {
  return new Date(new Date(isoDate).getTime() + hours * 60 * 60 * 1000).toISOString();
}

/** Row from sheet: [user, summary, created, lastNotified, notify, status], rowIndex = sheet row number */
function rowToTask(row: string[], rowIndex: number, assignedToChatId: string): Task {
  const id = `row_${rowIndex}`;
  const sheetUser = row[TASKS_COL_USER]?.trim() ?? "";
  const title = row[TASKS_COL_SUMMARY]?.trim() ?? "";
  const createdAt = row[TASKS_COL_CREATED]?.trim() ?? "";
  const lastNotified = row[TASKS_COL_NEXT]?.trim() ?? "";
  const notifyStr = row[TASKS_COL_NOTIFY]?.trim() ?? "";
  const status = (row[TASKS_COL_STATUS]?.trim() || "active") as Task["status"];
  const periodHours = parseNotifyToHours(notifyStr);
  const base = lastNotified || createdAt || new Date().toISOString();
  // No reminder (period 0): use far-future so task is never due for reminder
  const nextReminderAt = periodHours
    ? addHours(base, periodHours)
    : "9999-12-31T23:59:59.000Z";
  return {
    id,
    title,
    assignedTo: assignedToChatId,
    assignedName: sheetUserToAssignedName(sheetUser),
    createdBy: "",
    status: status === "done" ? "done" : "active",
    reminderPeriodHours: periodHours,
    nextReminderAt,
    createdAt: createdAt || new Date().toISOString(),
    lastNotified: lastNotified || undefined,
  };
}

/** Build map sheetUser -> chatId from config + Users sheet */
async function getSheetUserToChatId(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (config.husbandChatId) map.set(config.husbandSheetUser, config.husbandChatId);
  if (config.wifeChatId) map.set(config.wifeSheetUser, config.wifeChatId);
  const users = await getUsers();
  for (const u of users) {
    const su = u.sheetUser ?? (u.role === "husband" ? config.husbandSheetUser : config.wifeSheetUser);
    if (su) map.set(su, u.chatId);
  }
  return map;
}

export async function getTasks(_sheetId?: string): Promise<Task[]> {
  const sheets = getClient();
  const range = sheetRange(config.tasksSheetName, `A${TASKS_DATA_START}:F`);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range,
  });
  const rows = (res.data.values ?? []) as string[][];
  const sheetUserToChatId = await getSheetUserToChatId();
  const tasks: Task[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;
    const rowNum = TASKS_DATA_START + i;
    const summary = row[TASKS_COL_SUMMARY]?.trim();
    if (!summary) continue; // skip empty rows
    const sheetUser = row[TASKS_COL_USER]?.trim() || "";
    const isUnassigned = !sheetUser || sheetUser.toLowerCase() === "both" || sheetUser.toLowerCase() === "оба";
    const chatId = isUnassigned ? "" : sheetUserToChatId.get(sheetUser);
    if (!isUnassigned && !chatId) continue;
    tasks.push(rowToTask(row, rowNum, chatId ?? ""));
  }
  return tasks;
}

export async function getActiveTasks(): Promise<Task[]> {
  const all = await getTasks();
  return all.filter((t) => t.status === "active");
}

export async function getTasksDueForReminder(now: Date): Promise<Task[]> {
  const active = await getActiveTasks();
  const nowIso = now.toISOString();
  const disabledAt = "9999-12-31T23:59:59.000Z";
  return active.filter(
    (t) => t.nextReminderAt && t.nextReminderAt <= nowIso && t.nextReminderAt < disabledAt
  );
}

/** Build row: [user, summary, created, lastNotified, notify, status] — no id column */
function taskToRow(t: Task, sheetUser: string): string[] {
  return [
    sheetUser,
    t.title,
    t.createdAt,
    t.lastNotified ?? "",
    formatNotifyFromHours(t.reminderPeriodHours),
    t.status,
  ];
}

/** Max rows to scan when looking for first empty row (to avoid huge reads). */
const TASKS_MAX_SCAN_ROWS = 2000;

export async function addTask(task: Task): Promise<void> {
  const users = await getUsers();
  const isUnassigned = !task.assignedTo || task.assignedName === "Оба";
  const sheetUser = isUnassigned
    ? ""
    : (users.find((x) => x.chatId === task.assignedTo)?.sheetUser ??
       (task.assignedName === "Лёша" ? config.husbandSheetUser : config.wifeSheetUser));
  const row = taskToRow(task, sheetUser);
  const sheets = getClient();
  const readRange = sheetRange(config.tasksSheetName, `A${TASKS_DATA_START}:F${TASKS_DATA_START + TASKS_MAX_SCAN_ROWS - 1}`);
  const resGet = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range: readRange,
  });
  const rows = (resGet.data.values ?? []) as string[][];
  let insertRowIndex = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 2 || !r[TASKS_COL_SUMMARY]?.trim()) {
      insertRowIndex = i;
      break;
    }
  }
  const rowNum = TASKS_DATA_START + insertRowIndex;
  const updateRange = sheetRange(config.tasksSheetName, `A${rowNum}:F${rowNum}`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.google.sheetId,
    range: updateRange,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

export async function updateTask(
  taskId: string,
  updates: Partial<Pick<Task, "status" | "nextReminderAt" | "reminderPeriodHours" | "lastNotified" | "assignedTo" | "assignedName">>
): Promise<void> {
  const tasks = await getTasks();
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx < 0) return;
  const row = TASKS_DATA_START + idx;
  const task = { ...tasks[idx], ...updates };
  const period = updates.reminderPeriodHours ?? tasks[idx].reminderPeriodHours;
  if (updates.nextReminderAt && !updates.lastNotified && period > 0) {
    task.lastNotified = new Date().toISOString();
  }
  const sheetUser =
    task.assignedName === "Оба"
      ? ""
      : task.assignedName === "Лёша"
        ? config.husbandSheetUser
        : task.assignedName === "Таня"
          ? config.wifeSheetUser
          : tasks[idx].assignedName;
  const range = sheetRange(config.tasksSheetName, `A${row}:F${row}`);
  const sheets = getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.google.sheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [taskToRow(task, sheetUser)] },
  });
}

// --- Users sheet: sheetUser | chatId | name | role (4 columns)
function userToRow(u: User): string[] {
  return [u.sheetUser ?? (u.role === "husband" ? config.husbandSheetUser : config.wifeSheetUser), u.chatId, u.name, u.role];
}

function rowToUser(row: string[]): User {
  return {
    sheetUser: row[0]?.trim(),
    chatId: row[1]?.trim() ?? "",
    name: row[2]?.trim() ?? "",
    role: (row[3]?.trim() as User["role"]) || "husband",
  };
}

export async function getUsers(): Promise<User[]> {
  const sheets = getClient();
  const usersSheet = await getUsersSheetTitle();
  const range = sheetRange(usersSheet, "A2:D");
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.google.sheetId,
      range,
    });
    const rows = (res.data.values ?? []) as string[][];
    return rows
      .filter((r) => r.length >= 4 && r[1])
      .map(rowToUser)
      .map((u) => ({
        ...u,
        sheetUser: u.sheetUser || (u.role === "husband" ? config.husbandSheetUser : config.wifeSheetUser),
      }));
  } catch (err) {
    log("getUsers failed — check sheet name and permissions", {
      sheet: usersSheet,
      sheetId: config.google.sheetId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function getUserByChatId(chatId: string): Promise<User | undefined> {
  const users = await getUsers();
  return users.find((u) => u.chatId === String(chatId));
}

export async function getChatIdByRole(role: "husband" | "wife"): Promise<string | undefined> {
  const pre = role === "husband" ? config.husbandChatId : config.wifeChatId;
  if (pre) return pre;
  const users = await getUsers();
  return users.find((u) => u.role === role)?.chatId;
}

/** All family chat IDs (for unassigned task reminders). */
export async function getAllFamilyChatIds(): Promise<string[]> {
  const ids: string[] = [];
  if (config.husbandChatId) ids.push(config.husbandChatId);
  if (config.wifeChatId) ids.push(config.wifeChatId);
  const users = await getUsers();
  for (const u of users) {
    if (u.chatId && !ids.includes(u.chatId)) ids.push(u.chatId);
  }
  return ids;
}

export async function upsertUser(user: User): Promise<void> {
  const users = await getUsers();
  const sheetUser = user.sheetUser ?? (user.role === "husband" ? config.husbandSheetUser : config.wifeSheetUser);
  const u = { ...user, sheetUser };
  const idx = users.findIndex((x) => x.chatId === user.chatId);
  const sheets = getClient();
  const usersSheet = await getUsersSheetTitle();
  try {
    if (idx >= 0) {
      const row = idx + 2;
      const range = sheetRange(usersSheet, `A${row}:D${row}`);
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.google.sheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [userToRow(u)] },
      });
    } else {
      const range = sheetRange(usersSheet, "A:D");
      await sheets.spreadsheets.values.append({
        spreadsheetId: config.google.sheetId,
        range,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [userToRow(u)] },
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("upsertUser failed", { usersSheet, sheetId: config.google.sheetId, error: msg });
    throw new Error(`Не удалось записать в таблицу (Users): ${msg}`);
  }
}

export function createTask(params: {
  title: string;
  assignedTo: string;
  assignedName: string;
  createdBy: string;
  reminderPeriodHours?: number;
}): Task {
  const now = new Date().toISOString();
  const hours = params.reminderPeriodHours ?? DEFAULT_REMINDER_HOURS;
  const next =
    hours > 0
      ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
      : "9999-12-31T23:59:59.000Z";
  return {
    id: crypto.randomUUID(),
    title: params.title,
    assignedTo: params.assignedTo,
    assignedName: params.assignedName,
    createdBy: params.createdBy,
    status: "active",
    reminderPeriodHours: hours,
    nextReminderAt: next,
    createdAt: now,
  };
}
