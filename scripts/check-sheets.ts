/**
 * Diagnostic script: list all sheet tabs in your Google Spreadsheet.
 * Run: npx tsx scripts/check-sheets.ts
 *
 * This helps verify:
 * - Which spreadsheet the bot is using
 * - Tab names (for TASKS_SHEET_NAME and USERS_SHEET_NAME)
 */
import "dotenv/config";
import { google } from "googleapis";

const sheetId = process.env.GOOGLE_SHEET_ID;
const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!sheetId || !clientEmail || !privateKey) {
  console.error("Missing GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, or GOOGLE_PRIVATE_KEY in .env");
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials: { client_email: clientEmail, private_key: privateKey },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

async function main() {
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "properties.title,sheets.properties",
  });

  const title = meta.data.properties?.title ?? "Unknown";
  const tabs = meta.data.sheets ?? [];

  console.log("\n📊 Spreadsheet:", title);
  console.log("   ID:", sheetId);
  console.log("   URL: https://docs.google.com/spreadsheets/d/" + sheetId + "/edit\n");
  console.log("   Tabs (index = position, 0 = first):\n");

  for (let i = 0; i < tabs.length; i++) {
    const name = tabs[i].properties?.title ?? "?";
    const gid = tabs[i].properties?.sheetId ?? "?";
    const isTasks = name === (process.env.TASKS_SHEET_NAME ?? "Sheet1");
    const isUsers = name === (process.env.USERS_SHEET_NAME ?? "Users");
    const markers: string[] = [];
    if (isTasks) markers.push("← TASKS (bot writes here)");
    if (isUsers) markers.push("← USERS (bot writes here on /start)");
    console.log(`   [${i}] "${name}" (gid=${gid}) ${markers.join(" ")}`);
  }

  console.log("\n   Expected by bot:");
  console.log("   - Tasks tab:", process.env.TASKS_SHEET_NAME ?? "Sheet1", "(default)");
  console.log("   - Users tab:", process.env.USERS_SHEET_NAME ?? "Users", "(default)");
  console.log("\n   If your tab names differ, add to .env:");
  console.log("   TASKS_SHEET_NAME=YourTasksTabName");
  console.log("   USERS_SHEET_NAME=YourUsersTabName");
  console.log("   # Or use index (1 = second tab): USERS_SHEET_INDEX=1\n");

  // Sample data
  const tasksRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Sheet1!A1:F5",
  });
  const tasksRows = (tasksRes.data.values ?? []) as string[][];
  console.log("   Sheet1 (Tasks) sample - rows:", tasksRows.length);
  if (tasksRows.length > 0) {
    tasksRows.forEach((r, i) => console.log(`     Row ${i + 1}:`, r.slice(0, 4).join(" | ")));
  }

  const usersRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Users!A1:D5",
  });
  const usersRows = (usersRes.data.values ?? []) as string[][];
  console.log("\n   Users sample - rows:", usersRows.length);
  if (usersRows.length > 0) {
    usersRows.forEach((r, i) => console.log(`     Row ${i + 1}:`, r.join(" | ")));
  }
  console.log("");
}

main().catch((e) => {
  console.error("Error:", e.message);
  if (e.code === 403) {
    console.error("\n→ Share the spreadsheet with your service account:", clientEmail);
  }
  process.exit(1);
});
