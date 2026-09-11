// Batch-generates the game's stitched voice clips into public/audio/<key>.mp3.
//
// Two speakers, two engines:
//   - GCI ("Disco", the support dish / ground-controlled-intercept station):
//     ElevenLabs, voice ID below. Clip keys are prefixed 'gci-'.
//   - Player's ship (own-radar callouts and radio calls): OpenAI TTS. Clip keys
//     are either unprefixed (RadarVoice's existing vocabulary) or 'plr-' (new
//     player radio calls added alongside the GCI comms).
//
// Plus the campaign's story traffic (src/audio/radioScript.json): whole
// transmissions, one clip per line, into public/audio/story/<key>.mp3. The
// cast is below (STORY_VOICES) — each speaker in the script is one voice.
//
// Run with `node tools/generateClips.js`. Existing files are left alone —
// pass --force to regenerate everything (re-billed on every clip), or
// --only=<prefix> to limit a run to matching keys (e.g. --only=l2-).
// A clip that fails is reported and skipped; the run carries on and exits
// non-zero with a summary of what is missing.
/* global Buffer */
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
const storyOutputDir = path.join(outputDir, "story");
const radioScriptPath = path.resolve(currentDirPath, "..", "src", "audio", "radioScript.json");

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

// The story cast. Every speaker in radioScript.json maps to a voice here.
// ElevenLabs voice IDs are from the default voice library — swap any of them
// for one from your own library to recast a part. Disco keeps the GCI voice
// above so his story lines and his stitched BRA calls are the same man; the
// player keeps the OpenAI voice for the same reason.
const STORY_MODEL_ID = "eleven_multilingual_v2";
const STORY_VOICES = {
  disco:    { engine: "elevenlabs", id: GCI_VOICE_ID },
  anvil:    { engine: "elevenlabs", id: "pqHfZKP75CyOlkJxvsaD" }, // Bill — older, gravelly: the colonel
  mule21:   { engine: "elevenlabs", id: "nPczCjzI2devNBz1zQrb" }, // Brian — deep, wry: the flight lead
  mule22:   { engine: "elevenlabs", id: "cjVigY5qzO86Huf0OWal" }, // Eric — the nervous one
  mule24:   { engine: "elevenlabs", id: "iP95p4xoKVk53GoZ742B" }, // Chris — the gossip
  mule23:   { engine: "elevenlabs", id: "IKne3meq5aSn9XLyUdCD" }, // Charlie — the straggler
  lantern:  { engine: "elevenlabs", id: "Xb7hH8MSUJpSbSDYk0k2" }, // Alice — the survey ship's engineer
  flatspin: { engine: "openai", instructions: "A calm, terse fighter pilot on the radio. Clipped, professional, no drama." },
};

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

async function generateGptLine(text, instructions) {
  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    speed: PLAYER_SPEED,
    voice: PLAYER_VOICE,
    input: text,
    instructions,
  });
  return Buffer.from(await speech.arrayBuffer());
}

async function generateElevenLabs(text, voiceId = GCI_VOICE_ID, modelId = GCI_MODEL_ID) {
  const audio = await elevenlabs.textToSpeech.convert(voiceId, {
    text,
    modelId,
  });
  const chunks = [];
  for await (const chunk of audio) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// One job per clip: where it goes, what is said, and how it is made.
const jobs = Object.entries(CLIPS).map(([key, { voice, text }]) => ({
  key,
  file: path.join(outputDir, `${key}.mp3`),
  label: voice,
  text,
  make: () => (voice === "gci" ? generateElevenLabs(text) : generateGpt(text)),
}));

const radioScript = JSON.parse(fs.readFileSync(radioScriptPath, "utf8"));
for (const [key, line] of Object.entries(radioScript.lines)) {
  const cast = STORY_VOICES[line.speaker];
  // What the voice speaks can differ from the subtitle ("one-one" for "1-1").
  const text = line.say ?? line.text;
  jobs.push({
    key,
    file: path.join(storyOutputDir, `${key}.mp3`),
    label: line.speaker,
    text,
    make: () => {
      if (!cast) throw new Error(`no voice cast for speaker "${line.speaker}" (add it to STORY_VOICES)`);
      return cast.engine === "openai"
        ? generateGptLine(text, cast.instructions)
        : generateElevenLabs(text, cast.id, STORY_MODEL_ID);
    },
  });
}

const force = process.argv.includes("--force");
const only = process.argv.find(arg => arg.startsWith("--only="))?.slice("--only=".length);
fs.mkdirSync(storyOutputDir, { recursive: true });

const failures = [];
let generated = 0;
for (const job of jobs) {
  if (only && !job.key.startsWith(only)) continue;
  if (!force && fs.existsSync(job.file)) {
    console.log(`skip  ${job.key} (already exists)`);
    continue;
  }

  console.log(`gen   ${job.key} [${job.label}] "${job.text}"`);
  try {
    fs.writeFileSync(job.file, await job.make());
    generated++;
  } catch (error) {
    // Keep going: one bad voice ID or a rate limit should not cost the rest
    // of the batch. What failed is summarised at the end.
    const status = error?.statusCode ?? error?.status ?? "";
    const detail = error?.body?.detail?.message ?? error?.message ?? String(error);
    console.error(`FAIL  ${job.key} [${job.label}] ${status} ${detail}`);
    failures.push({ key: job.key, label: job.label, reason: `${status} ${detail}`.trim() });
  }
}

console.log(`done. ${generated} generated, ${failures.length} failed.`);
if (failures.length > 0) {
  console.error("\nFailed clips (the game shows these as subtitles only):");
  for (const f of failures) console.error(`  ${f.key} [${f.label}] — ${f.reason}`);
  process.exitCode = 1;
}
