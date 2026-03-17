import OpenAI from "openai";
import { config } from "../config.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

/**
 * Download voice file from Telegram and transcribe to text using OpenAI.
 * Telegram sends voice as OGG/Opus; Whisper accepts it.
 */
export async function transcribeVoiceFromTelegram(
  fileId: string,
  getFile: (fileId: string) => Promise<{ file_path: string }>,
  downloadUrl: (filePath: string) => string
): Promise<string> {
  const { file_path } = await getFile(fileId);
  const url = downloadUrl(file_path);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download voice: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());

  const file = new File([buffer], "voice.ogg", { type: "audio/ogg" });
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "gpt-4o-mini-transcribe",
    language: "ru",
  });
  return transcription.text?.trim() ?? "";
}
