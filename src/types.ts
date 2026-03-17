export type TaskStatus = "active" | "done";

export type UserRole = "husband" | "wife";

export interface Task {
  id: string;
  title: string;
  assignedTo: string; // telegram chat ID
  assignedName: string;
  createdBy: string;
  status: TaskStatus;
  reminderPeriodHours: number;
  nextReminderAt: string; // ISO (computed: lastNotified + period, or stored)
  createdAt: string; // ISO
  /** When we last sent a reminder (your sheet column E); used for your schema */
  lastNotified?: string; // ISO
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
  | { action: "create_task"; title: string; assignTo: "husband" | "wife" | "me" | "both"; notify?: boolean; periodHours?: number }
  | { action: "list_tasks"; filter?: "my" | "all" }
  | { action: "complete_task"; taskTitle: string }
  | { action: "delete_task"; taskTitle: string }
  | { action: "reassign_task"; taskTitle: string; assignTo: "husband" | "wife" }
  | { action: "remind_partner"; taskTitle: string }
  | { action: "set_reminder_period"; taskTitle: string; periodHours: number }
  | { action: "set_reminder_once"; taskTitle: string; inHours?: number; atTime?: string }
  | { action: "remove_reminders"; taskTitle: string }
  | { action: "unknown"; reply: string };
