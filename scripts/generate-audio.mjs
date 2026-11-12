/**
 * One-time audio generation with ElevenLabs.
 *
 * Reads ELEVENLABS_API_KEY from .env.local (never committed, never shipped
 * to the browser) and writes one mp3 per word into public/audio/.
 * The app plays these static files when they exist and falls back to the
 * browser voice otherwise — so the API key is only ever used here, on your
 * machine, at build time.
 *
 * Usage:  node scripts/generate-audio.mjs
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- read the key from .env.local ---
const envPath = join(root, '.env.local');
if (!existsSync(envPath)) {
  console.error('Missing .env.local — create it with ELEVENLABS_API_KEY=your-key');
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const API_KEY = env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error('ELEVENLABS_API_KEY is empty in .env.local');
  process.exit(1);
}

// --- single source of truth shared with the app ---
const WORDS = JSON.parse(readFileSync(join(root, 'src', 'data', 'words.json'), 'utf8'));

// Uplifting praise clips played on correct answers (keep in sync with PRAISE in src/data/words.ts)
const PRAISE = [
  { id: 'praise-1', text: 'Correct! Great job!', language: 'en' },
  { id: 'praise-2', text: 'Well done! Keep it going!', language: 'en' },
  { id: 'praise-3', text: 'Perfect! You nailed it!', language: 'en' },
  { id: 'praise-4', text: "Excellent! You're on a roll!", language: 'en' },
  { id: 'praise-5', text: "That's right! Nice work!", language: 'en' },
  { id: 'praise-fr-1', text: 'Correct ! Très bien !', language: 'fr' },
  { id: 'praise-fr-2', text: 'Bravo ! Continue comme ça !', language: 'fr' },
  { id: 'praise-fr-3', text: 'Parfait ! Tu as tout bon !', language: 'fr' },
  { id: 'praise-fr-4', text: 'Excellent ! Quelle série !', language: 'fr' },
  { id: 'praise-fr-5', text: "C'est ça ! Beau travail !", language: 'fr' },
];

// Per-language voice + model. Flash v2 is English-only; French needs Flash
// v2.5 (also 0.5 credits/char, multilingual).
const VOICES = {
  en: { voiceId: 'FVQMzxJGPUBtfz1Azdoy', modelId: 'eleven_flash_v2' }, // Danielle
  fr: { voiceId: 'sANWqF1bCMzR6eyZbCGw', modelId: 'eleven_flash_v2_5' }, // Marie
};

const outDir = join(root, 'public', 'audio');
mkdirSync(outDir, { recursive: true });

// praise clips get a livelier delivery (lower stability = more expressive)
const CLIPS = [
  ...WORDS.map((w) => ({ id: w.id, text: w.text, language: w.language, stability: 0.5 })),
  ...PRAISE.map((p) => ({ id: p.id, text: p.text, language: p.language, stability: 0.3 })),
];

let generated = 0;
for (const clip of CLIPS) {
  const outFile = join(outDir, `${clip.id}.mp3`);
  if (existsSync(outFile)) {
    console.log(`skip  ${clip.id} (already generated)`);
    continue;
  }
  const { voiceId, modelId } = VOICES[clip.language];
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: clip.text,
      model_id: modelId,
      voice_settings: { stability: clip.stability, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    console.error(`FAIL  ${clip.id}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
  generated += 1;
  console.log(`ok    ${clip.id}.mp3  ("${clip.text}")`);
}
console.log(`Done. ${generated} new clips generated.`);
