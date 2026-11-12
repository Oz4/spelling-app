# 🐝 SpellBee

Keyboard-first spelling practice with Anki-style spaced repetition — the app hears you out, grades you itself, and schedules each word based on how well you actually know it.

## How it works

1. The app speaks a word (browser text-to-speech).
2. You type it and press **Enter**.
3. The app checks the spelling, shows a letter-by-letter diff, and **decides the grade itself** (Again / Hard / Good / Easy) — you never self-grade:
   - wrong answer → **Again** (the word comes back a few cards later, fail count +1)
   - correct but slow or after many replays → **Hard**
   - correct → **Good**
   - correct, fast, 3+ streak → **Easy** (graduates with a bonus interval)
4. Scheduling is SM-2 inspired (like Anki): learning steps (1 min → 10 min), then 1 day, then interval × ease. Progress persists in `localStorage`.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Enter` | submit answer / next card (empty input: replay the word) |
| `Tab` | hear the word again |
| `Shift+Tab` | hear + show the hint sentence |

## Stack

- Vite + React + TypeScript
- Browser SpeechSynthesis for the voice (swappable for a cloud TTS in `src/lib/speech.ts`)
- No backend — builds to a static site (`npm run build` → `dist/`), hostable on Netlify / Vercel / GitHub Pages

## Development

```
npm install
npm run dev
```

## Decks & voices

- **English** — 200 commonly misspelled + IELTS academic words, voiced by ElevenLabs *Danielle* (Flash v2)
- **French** — 100 dictée-trap words (accents, double consonants, silent letters), voiced by ElevenLabs *Marie* (Flash v2.5)
- Toggle languages with the EN ⇄ FR chip in the header; progress, daily caps, and the hive are tracked per language (XP/level is shared)

## Roadmap

- [ ] More decks & difficulty levels
- [ ] Cross-device sync
