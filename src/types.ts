export type TaskStatus = "active" | "done";

export type UserRole = "husband" | "wife";

export interface Task {
  /** Row identifier for updates (e.g. row_2); not a sheet column */
  id: string;
  user: string;
  summary: string;
  createdAt: string;
  notify: string;
  lastNotifiedAt: string;
  nextNotificationAt: string;
  status: TaskStatus;
}

export interface User {
  chatId: string;
  name: string;
  role: UserRole;
  /** Value written to sheet "user" column (e.g. tanyu, alexey) */
  sheetUser?: string;
}

// LLM structured actions (Russian-friendly field names in prompts; we use assignTo etc. in code)
export type LLMAction =
  | { action: "create_task"; title: string; assignTo: "husband" | "wife" | "me" | "both"; notify?: string }
  | { action: "list_tasks"; filter?: "my" | "all" }
  | { action: "complete_task"; taskTitle: string }
  | { action: "delete_task"; taskTitle: string }
  | { action: "reassign_task"; taskTitle: string; assignTo: "husband" | "wife" }
  | { action: "remind_partner"; taskTitle: string }
  | { action: "set_reminder"; taskTitle: string; notify: string }
  | { action: "remove_reminders"; taskTitle: string }
  | { action: "unknown"; reply: string };
