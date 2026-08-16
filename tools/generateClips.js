// Batch-generates the game's stitched voice clips into public/audio/<key>.mp3.
//
// Two speakers, two engines:
//   - GCI ("Disco", the support dish / ground-controlled-intercept station):
//     ElevenLabs, voice ID below. Clip keys are prefixed 'gci-'.
//   - Player's ship (own-radar callouts and radio calls): OpenAI TTS. Clip keys
//     are either unprefixed (RadarVoice's existing vocabulary) or 'plr-' (new
//     player radio calls added alongside the GCI comms).
//
// Run with `node tools/generateClips.js`. Existing files are left alone —
// pass --force to regenerate everything (re-billed on every clip).
import fs from "fs";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const envFilePath = path.join(currentDirPath, ".env");
const outputDir = path.resolve(currentDirPath, "..", "public", "audio");

if (typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envFilePath);
} else if (fs.existsSync(envFilePath)) {
  const envRaw = fs.readFileSync(envFilePath, "utf8");
  for (const line of envRaw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

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
if (!process.env.ELEVENLABS_API_KEY) {
  throw new Error(`Missing ELEVENLABS_API_KEY in ${envFilePath}`);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

// Voice used for "Disco" GCI transmissions.
const GCI_VOICE_ID = "pvxGJdhknm00gMyYHtET";
const GCI_MODEL_ID = "eleven_turbo_v2_5";

// Voice used for the player's ship (own-radar callouts + radio calls).
const PLAYER_VOICE = "ash";
const PLAYER_SPEED = 1.3;

// key -> { voice: 'gci' | 'player', text }
const CLIPS = {
  // ── GCI ("Disco") — new bogey-dope vocabulary ──────────────────────────
  "gci-disco": { voice: "gci", text: "Disco" },
  "gci-flatspin": { voice: "gci", text: "Flatspin" },
  "gci-bra": { voice: "gci", text: "bra" },
  "gci-for": { voice: "gci", text: "for" },
  "gci-hot": { voice: "gci", text: "hot" },
  "gci-cold": { voice: "gci", text: "cold" },
  "gci-flanking": { voice: "gci", text: "flanking" },
  "gci-beaming": { voice: "gci", text: "beaming" },
  "gci-clean": { voice: "gci", text: "clean" },
  "gci-hostile": { voice: "gci", text: "hostile" },
  "gci-buster": { voice: "gci", text: "buster" },
  "gci-gate": { voice: "gci", text: "gate" },
  "gci-saunter": { voice: "gci", text: "saunter" },
  "gci-zero": { voice: "gci", text: "zero" },
  "gci-one": { voice: "gci", text: "one" },
  "gci-two": { voice: "gci", text: "two" },
  "gci-three": { voice: "gci", text: "three" },
  "gci-four": { voice: "gci", text: "four" },
  "gci-five": { voice: "gci", text: "five" },
  "gci-six": { voice: "gci", text: "six" },
  "gci-seven": { voice: "gci", text: "seven" },
  "gci-eight": { voice: "gci", text: "eight" },
  "gci-nine": { voice: "gci", text: "nine" },
  "gci-100": { voice: "gci", text: "one hundred" },
  "gci-200": { voice: "gci", text: "two hundred" },
  "gci-300": { voice: "gci", text: "three hundred" },
  "gci-400": { voice: "gci", text: "four hundred" },
  "gci-500": { voice: "gci", text: "five hundred" },
  "gci-600": { voice: "gci", text: "six hundred" },
  "gci-700": { voice: "gci", text: "seven hundred" },
  "gci-800": { voice: "gci", text: "eight hundred" },
  "gci-900": { voice: "gci", text: "nine hundred" },
  "gci-1000": { voice: "gci", text: "one thousand" },

  // ── Player — new radio-call vocabulary ─────────────────────────────────
  "plr-disco": { voice: "player", text: "Disco" },
  "plr-flatspin": { voice: "player", text: "Flatspin" },
  "plr-bogey-dope": { voice: "player", text: "bogey dope" },
  // Missile-launch brevity call ("Flatspin 1-1, fox one/three" — the digit
  // reuses the existing 'one'/'three' RadarVoice clips).
  "plr-fox": { voice: "player", text: "Fox" },
};

async function generateGpt(text) {
  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    speed: PLAYER_SPEED,
    voice: PLAYER_VOICE,
    input: text,
  });
  return Buffer.from(await speech.arrayBuffer());
}

async function generateElevenLabs(text) {
  const audio = await elevenlabs.textToSpeech.convert(GCI_VOICE_ID, {
    text,
    modelId: GCI_MODEL_ID,
  });
  const chunks = [];
  for await (const chunk of audio) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const force = process.argv.includes("--force");
fs.mkdirSync(outputDir, { recursive: true });

for (const [key, { voice, text }] of Object.entries(CLIPS)) {
  const outputFilePath = path.join(outputDir, `${key}.mp3`);
  if (!force && fs.existsSync(outputFilePath)) {
    console.log(`skip  ${key} (already exists)`);
    continue;
  }

  console.log(`gen   ${key} [${voice}] "${text}"`);
  const buffer = voice === "gci" ? await generateElevenLabs(text) : await generateGpt(text);
  fs.writeFileSync(outputFilePath, buffer);
}

console.log("done.");
