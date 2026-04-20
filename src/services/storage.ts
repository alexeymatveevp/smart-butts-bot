import { config } from "../config.js";
import type { Task, User } from "../types.js";
import { getNextNotificationAt } from "./notifySchedule.js";
import { db } from "./db.js";

const FAR_FUTURE = "9999-12-31T23:59:59.000Z";

type TaskRow = {
  id: number;
  user: string;
  summary: string;
  created_at: string;
  notify: string;
  last_notified_at: string;
  next_notification_at: string;
  status: string;
};

type UserRow = {
  chat_id: string;
  sheet_user: string;
  name: string;
  role: string;
};

function rowToTask(r: TaskRow): Task {
  return {
    id: String(r.id),
    user: r.user ?? "",
    summary: r.summary ?? "",
    createdAt: r.created_at || new Date().toISOString(),
    notify: r.notify ?? "",
    lastNotifiedAt: r.last_notified_at ?? "",
    nextNotificationAt: r.next_notification_at || FAR_FUTURE,
    status: r.status === "done" ? "done" : "active",
  };
}

function rowToUser(r: UserRow): User {
  return {
    chatId: r.chat_id,
    name: r.name,
    role: r.role === "wife" ? "wife" : "husband",
    sheetUser: r.sheet_user,
  };
}

/** Display name for UI only (not stored in Task). */
export function sheetUserToDisplayName(sheetUser: string): string {
  if (!sheetUser || sheetUser === "both" || sheetUser.toLowerCase() === "оба") return "Оба";
  if (sheetUser === config.husbandSheetUser) return "Лёша";
  if (sheetUser === config.wifeSheetUser) return "Таня";
  return sheetUser;
}

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

export async function getTasks(): Promise<Task[]> {
  const rows = db().prepare("SELECT * FROM tasks ORDER BY id ASC").all() as TaskRow[];
  return rows.map(rowToTask);
}

export async function getActiveTasks(): Promise<Task[]> {
  const rows = db()
    .prepare("SELECT * FROM tasks WHERE status = 'active' ORDER BY id ASC")
    .all() as TaskRow[];
  return rows.map(rowToTask);
}

export async function getTasksDueForReminder(now: Date): Promise<Task[]> {
  const active = await getActiveTasks();
  const nowIso = now.toISOString();
  return active.filter((t) => {
    const hasScheduled = t.nextNotificationAt && t.nextNotificationAt < FAR_FUTURE;
    if (hasScheduled) return t.nextNotificationAt <= nowIso;
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

export async function addTask(task: Task): Promise<void> {
  db()
    .prepare(
      `INSERT INTO tasks (user, summary, created_at, notify, last_notified_at, next_notification_at, status)
       VALUES (@user, @summary, @createdAt, @notify, @lastNotifiedAt, @nextNotificationAt, @status)`
    )
    .run({
      user: task.user,
      summary: task.summary,
      createdAt: task.createdAt,
      notify: task.notify,
      lastNotifiedAt: task.lastNotifiedAt ?? "",
      nextNotificationAt: task.nextNotificationAt ?? "",
      status: task.status,
    });
}

export async function updateTask(
  taskId: string,
  updates: Partial<Pick<Task, "status" | "user" | "notify" | "lastNotifiedAt" | "nextNotificationAt">>
): Promise<void> {
  const id = Number(taskId);
  if (!Number.isFinite(id)) return;
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  if (updates.status !== undefined) { fields.push("status = @status"); params.status = updates.status; }
  if (updates.user !== undefined) { fields.push("user = @user"); params.user = updates.user; }
  if (updates.notify !== undefined) { fields.push("notify = @notify"); params.notify = updates.notify; }
  if (updates.lastNotifiedAt !== undefined) { fields.push("last_notified_at = @lastNotifiedAt"); params.lastNotifiedAt = updates.lastNotifiedAt; }
  if (updates.nextNotificationAt !== undefined) { fields.push("next_notification_at = @nextNotificationAt"); params.nextNotificationAt = updates.nextNotificationAt; }
  if (fields.length === 0) return;
  db().prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = @id`).run(params);
}

export async function getUsers(): Promise<User[]> {
  const rows = db().prepare("SELECT * FROM users").all() as UserRow[];
  return rows.map(rowToUser);
}

export async function getUserByChatId(chatId: string): Promise<User | undefined> {
  const row = db().prepare("SELECT * FROM users WHERE chat_id = ?").get(String(chatId)) as UserRow | undefined;
  return row ? rowToUser(row) : undefined;
}

export async function getChatIdByRole(role: "husband" | "wife"): Promise<string | undefined> {
  const pre = role === "husband" ? config.husbandChatId : config.wifeChatId;
  if (pre) return pre;
  const row = db().prepare("SELECT chat_id FROM users WHERE role = ? LIMIT 1").get(role) as { chat_id: string } | undefined;
  return row?.chat_id;
}

/** All family chat IDs (for unassigned task reminders). */
export async function getAllFamilyChatIds(): Promise<string[]> {
  const ids: string[] = [];
  if (config.husbandChatId) ids.push(config.husbandChatId);
  if (config.wifeChatId) ids.push(config.wifeChatId);
  const rows = db().prepare("SELECT chat_id FROM users").all() as { chat_id: string }[];
  for (const r of rows) {
    if (r.chat_id && !ids.includes(r.chat_id)) ids.push(r.chat_id);
  }
  return ids;
}

export async function upsertUser(user: User): Promise<void> {
  const sheetUser = user.sheetUser ?? (user.role === "husband" ? config.husbandSheetUser : config.wifeSheetUser);
  db()
    .prepare(
      `INSERT INTO users (chat_id, sheet_user, name, role)
       VALUES (@chatId, @sheetUser, @name, @role)
       ON CONFLICT(chat_id) DO UPDATE SET
         sheet_user = excluded.sheet_user,
         name = excluded.name,
         role = excluded.role`
    )
    .run({
      chatId: user.chatId,
      sheetUser,
      name: user.name,
      role: user.role,
    });
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
