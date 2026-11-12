/**
 * Text-to-speech via the browser's built-in SpeechSynthesis.
 * Picks the best available voice for the language (natural/neural voices
 * from the OS or Chrome first). Later this can be swapped for a cloud TTS
 * (ElevenLabs / OpenAI / Google) without touching the rest of the app.
 */

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!voicesReady) {
    voicesReady = new Promise((resolve) => {
      const got = speechSynthesis.getVoices();
      if (got.length) return resolve(got);
      speechSynthesis.addEventListener('voiceschanged', () => resolve(speechSynthesis.getVoices()), { once: true });
      // safety timeout — some browsers never fire voiceschanged
      setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
    });
  }
  return voicesReady;
}

const PREFERRED: Record<string, string[]> = {
  en: ['Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Zira', 'Samantha'],
  fr: ['Google français', 'Microsoft Denise', 'Microsoft Julie', 'Thomas', 'Amelie'],
};

async function pickVoice(lang: 'en' | 'fr'): Promise<SpeechSynthesisVoice | null> {
  const voices = await loadVoices();
  const inLang = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  for (const name of PREFERRED[lang]) {
    const hit = inLang.find((v) => v.name.includes(name));
    if (hit) return hit;
  }
  return inLang[0] ?? null;
}

export async function speak(text: string, lang: 'en' | 'fr', rate = 0.85): Promise<void> {
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang === 'en' ? 'en-US' : 'fr-FR';
  utter.rate = rate;
  const voice = await pickVoice(lang);
  if (voice) utter.voice = voice;
  return new Promise((resolve) => {
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    speechSynthesis.speak(utter);
  });
}

/**
 * Speak a word: prefer a pre-generated mp3 in /public/audio (created by
 * scripts/generate-audio.mjs with ElevenLabs), fall back to browser TTS.
 */
const fileCache = new Map<string, string | null>(); // word id -> object URL (or null if no file)

export async function speakWord(
  id: string,
  text: string,
  lang: 'en' | 'fr',
  rate = 0.85,
): Promise<void> {
  let url = fileCache.get(id);
  if (url === undefined) {
    try {
      const res = await fetch(`/audio/${id}.mp3`);
      const type = res.headers.get('content-type') ?? '';
      url = res.ok && type.includes('audio') ? URL.createObjectURL(await res.blob()) : null;
    } catch {
      url = null;
    }
    fileCache.set(id, url);
  }
  if (url) {
    const src = url;
    return new Promise<void>((resolve) => {
      // one shared element: mobile browsers only allow playback on an element
      // that was started inside a user gesture (see unlockAudio)
      const audio = player();
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.src = src;
      audio.playbackRate = rate;
      audio.play().catch(() => resolve());
    });
  }
  return speak(text, lang, rate);
}

let shared: HTMLAudioElement | null = null;
function player(): HTMLAudioElement {
  if (!shared) shared = new Audio();
  return shared;
}

/** Call from the first user gesture: primes the shared element so later
 * programmatic plays are allowed on iOS/Android. Silent, tiny wav. */
export function unlockAudio(): void {
  const audio = player();
  if (audio.src) return;
  audio.src =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  audio.play().catch(() => {});
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}
