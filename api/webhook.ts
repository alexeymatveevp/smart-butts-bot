import { webhookCallback } from "grammy";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { bot } from "../src/bot.js";

export const config = { maxDuration: 30 };

const vercelAdapter = (req: VercelRequest, res: VercelResponse) => ({
  update: Promise.resolve(req.body),
  header: req.headers["x-telegram-bot-api-secret-token"] as string | undefined,
  end: () => res.end(),
  respond: (json: string) => {
    res.status(200).setHeader("Content-Type", "application/json").send(json);
  },
  unauthorized: () => res.status(401).end(),
});

const handle = webhookCallback(bot, vercelAdapter);

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === "POST") {
    try {
      await handle(req, res);
    } catch (err) {
      console.error("Webhook error:", err);
      res.status(500).json({ error: "Internal error" });
    }
  } else {
    res.status(405).end();
  }
}
