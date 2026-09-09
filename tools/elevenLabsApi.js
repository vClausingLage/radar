import { ElevenLabsClient } from "elevenlabs";

const voiceID = "pvxGJdhknm00gMyYHtET";

const text = "Flatspin 1-1, Disco, Return to Base";

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});
await client.textToSpeech.convert(voiceID, {
  text: text,
  modelId: "eleven_v2",
});