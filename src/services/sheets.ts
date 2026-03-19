import { google } from "googleapis";
import { config } from "../config.js";
import type { Task, User } from "../types.js";
import { getNextNotificationAt } from "./notifySchedule.js";
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

// Tasks sheet: A=user, B=summary, C=createdAt, D=notify, E=lastNotifiedAt, F=nextNotificationAt, G=status
const TASKS_COL_USER = 0;
const TASKS_COL_SUMMARY = 1;
const TASKS_COL_CREATED_AT = 2;
const TASKS_COL_NOTIFY = 3;
const TASKS_COL_LAST_NOTIFIED_AT = 4;
const TASKS_COL_NEXT_NOTIFICATION_AT = 5;
const TASKS_COL_STATUS = 6;
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

/** Display name for UI only (not stored in Task). */
export function sheetUserToDisplayName(sheetUser: string): string {
  if (!sheetUser || sheetUser === "both" || sheetUser.toLowerCase() === "оба") return "Оба";
  if (sheetUser === config.husbandSheetUser) return "Лёша";
  if (sheetUser === config.wifeSheetUser) return "Таня";
  return sheetUser;
}

/** Row from sheet: [user, summary, createdAt, notify, lastNotifiedAt, nextNotificationAt, status] */
function rowToTask(row: string[], rowIndex: number): Task {
  const id = `row_${rowIndex}`;
  const user = row[TASKS_COL_USER]?.trim() ?? "";
  const summary = row[TASKS_COL_SUMMARY]?.trim() ?? "";
  const createdAt = row[TASKS_COL_CREATED_AT]?.trim() ?? "";
  const notify = row[TASKS_COL_NOTIFY]?.trim() ?? "";
  const lastNotifiedAt = row[TASKS_COL_LAST_NOTIFIED_AT]?.trim() ?? "";
  const nextNotificationAt = row[TASKS_COL_NEXT_NOTIFICATION_AT]?.trim() ?? "";
  const status = (row[TASKS_COL_STATUS]?.trim() || "active") as Task["status"];
  return {
    id,
    user,
    summary,
    createdAt: createdAt || new Date().toISOString(),
    notify,
    lastNotifiedAt,
    nextNotificationAt: nextNotificationAt || "9999-12-31T23:59:59.000Z",
    status: status === "done" ? "done" : "active",
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

/** Resolve task user to chat ID(s) for sending reminders. */
export async function getChatIdsForTaskUser(user: string): Promise<string[]> {
  const u = (user || "").trim().toLowerCase();
  if (!u || u === "both" || u === "оба") return getAllFamilyChatIds();
  const map = await getSheetUserToChatId();
  const chatId = map.get(user.trim());
  return chatId ? [chatId] : [];
}

export async function getTasks(_sheetId?: string): Promise<Task[]> {
  const sheets = getClient();
  const range = sheetRange(config.tasksSheetName, `A${TASKS_DATA_START}:G`);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range,
  });
  const rows = (res.data.values ?? []) as string[][];
  const tasks: Task[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;
    const summary = row[TASKS_COL_SUMMARY]?.trim();
    if (!summary) continue;
    const rowNum = TASKS_DATA_START + i;
    tasks.push(rowToTask(row, rowNum));
  }
  return tasks;
}

export async function getActiveTasks(): Promise<Task[]> {
  const all = await getTasks();
  return all.filter((t) => t.status === "active");
}

const FAR_FUTURE = "9999-12-31T23:59:59.000Z";

export async function getTasksDueForReminder(now: Date): Promise<Task[]> {
  const active = await getActiveTasks();
  const nowIso = now.toISOString();
  return active.filter((t) => {
    const hasScheduled = t.nextNotificationAt && t.nextNotificationAt < FAR_FUTURE;
    if (hasScheduled) return t.nextNotificationAt! <= nowIso;
    // nextNotificationAt empty or far future: if task has notify, compute first run and treat as due if it's in the past
    if (!t.notify) return false;
    const { next } = getNextNotificationAt(
      t.notify,
      now,
      t.lastNotifiedAt ?? "",
      t.createdAt
    );
    return next <= nowIso && next < FAR_FUTURE;
  });
}

/** Build row: [user, summary, createdAt, notify, lastNotifiedAt, nextNotificationAt, status] */
function taskToRow(t: Task): string[] {
  return [
    t.user,
    t.summary,
    t.createdAt,
    t.notify,
    t.lastNotifiedAt ?? "",
    t.nextNotificationAt ?? "",
    t.status,
  ];
}

/** Max rows to scan when looking for first empty row (to avoid huge reads). */
const TASKS_MAX_SCAN_ROWS = 2000;

export async function addTask(task: Task): Promise<void> {
  const row = taskToRow(task);
  const sheets = getClient();
  const readRange = sheetRange(config.tasksSheetName, `A${TASKS_DATA_START}:G${TASKS_DATA_START + TASKS_MAX_SCAN_ROWS - 1}`);
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
  const updateRange = sheetRange(config.tasksSheetName, `A${rowNum}:G${rowNum}`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.google.sheetId,
    range: updateRange,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

export async function updateTask(
  taskId: string,
  updates: Partial<Pick<Task, "status" | "user" | "notify" | "lastNotifiedAt" | "nextNotificationAt">>
): Promise<void> {
  const rowNum = parseInt(taskId.replace("row_", ""), 10);
  if (Number.isNaN(rowNum) || rowNum < TASKS_DATA_START) return;
  const tasks = await getTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const merged = { ...task, ...updates };
  const range = sheetRange(config.tasksSheetName, `A${rowNum}:G${rowNum}`);
  const sheets = getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.google.sheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [taskToRow(merged)] },
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

export function createTask(params: { user: string; summary: string; notify?: string }): Task {
  const now = new Date().toISOString();
  const ref = new Date();
  const notify = (params.notify || "").trim();
  const { next: nextNotificationAt } = getNextNotificationAt(notify, ref, "", now);
  return {
    id: "new",
    user: params.user,
    summary: params.summary,
    createdAt: now,
    notify,
    lastNotifiedAt: "",
    nextNotificationAt,
    status: "active",
  };
}
