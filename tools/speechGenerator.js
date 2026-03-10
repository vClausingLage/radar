import fs from "fs";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const envFilePath = path.join(currentDirPath, ".env");

if (typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envFilePath);
} else if (fs.existsSync(envFilePath)) {
  const envRaw = fs.readFileSync(envFilePath, "utf8");
  for (const line of envRaw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

if (!process.env.OPENAI_API_KEY) {
  throw new Error(`Missing OPENAI_API_KEY in ${envFilePath}`);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const speech = await openai.audio.speech.create({
  model: "gpt-4o-mini-tts",
  speed: 1.5,
  voice: "ash",
  input: "Zero."
});

const buffer = Buffer.from(await speech.arrayBuffer());
const outputFilePath = path.resolve(currentDirPath, "..", "public", "zero.mp3");
fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
fs.writeFileSync(outputFilePath, buffer);