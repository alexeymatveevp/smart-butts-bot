import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  notify TEXT NOT NULL DEFAULT '',
  last_notified_at TEXT NOT NULL DEFAULT '',
  next_notification_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','done'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_next
  ON tasks(status, next_notification_at);

CREATE TABLE IF NOT EXISTS users (
  chat_id    TEXT PRIMARY KEY,
  sheet_user TEXT NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK(role IN ('husband','wife'))
);
`;

let instance: Database.Database | null = null;

export function db(): Database.Database {
  if (instance) return instance;
  const dir = path.dirname(config.databasePath);
  if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
  const d = new Database(config.databasePath);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(SCHEMA);
  instance = d;
  return d;
}
