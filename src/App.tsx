import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRAISE, WORDS, type Word } from './data/words';
import { ALL_GRAMMAR, FR_CATEGORIES, GRAMMAR_CATEGORIES } from './data/categories';
import {
  cellTier,
  levelFromXp,
  levelProgress,
  loadHive,
  saveHive,
  xpForAnswer,
  type HiveStats,
} from './lib/hive';
import {
  applyGrade,
  deriveGrade,
  dueLabel,
  newProgress,
  type Grade,
  type WordProgress,
} from './lib/srs';
import { isSpeechSupported, speakWord, unlockAudio } from './lib/speech';
import { syllabify } from './lib/syllables';

const PROGRESS_KEY = 'spelling.progress.v1';
const THEME_KEY = 'spelling.theme';
const DAILY_KEY = 'spelling.daily.v2';
const LANG_KEY = 'spelling.lang';
const PRAISE_KEY = 'spelling.praise';

type Lang = 'en' | 'fr';
/** words due again within this window stay in the current session */
const SESSION_HORIZON_MS = 15 * 60 * 1000;
/** Anki-style daily allowance of brand-new words */
const DAILY_NEW_CAP = 20;
/** new words per session chunk (also the size of a bonus "keep going" chunk) */
const CHUNK_SIZE = 20;
/** accented letters offered as tap-to-insert keys in French mode */
const ACCENTS = ['é', 'è', 'ê', 'ë', 'à', 'â', 'ç', 'î', 'ï', 'ô', 'ù', 'û', 'ü', 'œ'];

type Phase = 'question' | 'feedback' | 'done';

interface LastResult {
  word: Word;
  typed: string;
  correct: boolean;
  grade: Grade;
  progress: WordProgress;
  xpGained: number;
  capped: boolean;
  leveledTo?: number;
}

function loadProgress(): Record<string, WordProgress> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* corrupted storage — start fresh */
  }
  return {};
}

interface DailyStats {
  date: string;
  /** new words introduced today, per language */
  introduced: Record<Lang, number>;
}

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
}

function freshDaily(): DailyStats {
  return { date: todayStr(), introduced: { en: 0, fr: 0 } };
}

function loadDaily(): DailyStats {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (
        d &&
        d.date === todayStr() &&
        d.introduced &&
        typeof d.introduced.en === 'number' &&
        typeof d.introduced.fr === 'number'
      ) {
        return d;
      }
    }
    // migrate the v1 single-count shape (was English-only)
    const v1 = localStorage.getItem('spelling.daily.v1');
    if (v1) {
      const d = JSON.parse(v1);
      if (d && d.date === todayStr() && typeof d.introduced === 'number') {
        return { date: d.date, introduced: { en: d.introduced, fr: 0 } };
      }
    }
  } catch {
    /* corrupted or from another day — reset */
  }
  return freshDaily();
}

function loadLang(): Lang {
  const saved = localStorage.getItem(LANG_KEY);
  return saved === 'fr' ? 'fr' : 'en';
}

function loadTheme(): 'light' | 'dark' {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function normalize(s: string): string {
  // typographic apostrophe counts as the straight one (aujourd'hui)
  return s.trim().toLowerCase().replace(/’/g, "'");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Color each letter of the correct word: green if the user typed it (in
 * order), red if they missed it. Uses LCS alignment so one missing letter
 * doesn't flag the whole rest of the word.
 */
function lcsMatchedIndices(correct: string, typed: string): boolean[] {
  const n = correct.length;
  const m = typed.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        correct[i] === typed[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Array<boolean>(n).fill(false);
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (correct[i] === typed[j]) {
      matched[i] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return matched;
}

function LetterDiff({ correct, typed }: { correct: string; typed: string }) {
  const matched = lcsMatchedIndices(correct, normalize(typed));
  return (
    <div className="word-reveal" aria-label={`Correct spelling: ${correct}`}>
      {correct.split('').map((ch, i) => (
        <span
          key={i}
          className={matched[i] ? 'ok' : 'bad'}
          style={{ animationDelay: `${i * 40}ms` }}
        >
          {ch}
        </span>
      ))}
    </div>
  );
}

interface Fleck {
  dx: string;
  dy: string;
  rot: string;
  color: string;
  delay: string;
}

function makeFlecks(gold: boolean): Fleck[] {
  const colors = gold
    ? ['var(--honey)', 'var(--honey-deep)', 'var(--honey)']
    : ['var(--honey)', 'var(--accent)', 'var(--success)'];
  return Array.from({ length: 12 }, (_, i) => ({
    dx: `${Math.round((Math.random() - 0.5) * 180)}px`,
    dy: `${Math.round(-30 - Math.random() * 90)}px`,
    rot: `${Math.round((Math.random() - 0.5) * 540)}deg`,
    color: colors[i % colors.length],
    delay: `${Math.round(Math.random() * 60)}ms`,
  }));
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme);
  const [lang, setLang] = useState<Lang>(loadLang);
  // French deck category ('all' or a category id); null = show the picker
  const [frDeck, setFrDeck] = useState<string | null>(() => localStorage.getItem('spelling.frdeck'));
  // cheering voice after a correct answer — on unless explicitly turned off
  const [praiseOn, setPraiseOn] = useState(() => localStorage.getItem(PRAISE_KEY) !== 'off');
  const [progress, setProgress] = useState<Record<string, WordProgress>>(loadProgress);
  const [hive, setHive] = useState<HiveStats>(() => loadHive(loadProgress()));
  const [daily, setDaily] = useState<DailyStats>(loadDaily);
  const [combo, setCombo] = useState(0);
  const [comboBroke, setComboBroke] = useState(false);
  const [brokenCombo, setBrokenCombo] = useState(0);
  const [sessionXp, setSessionXp] = useState(0);
  const [queue, setQueue] = useState<string[]>([]);
  const [completed, setCompleted] = useState(0);
  const [phase, setPhase] = useState<Phase>('question');
  const [input, setInput] = useState('');
  const [last, setLast] = useState<LastResult | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [copied, setCopied] = useState(false);
  // URL routing: "/" is the intro (main page), "/game" is the spelling game
  const [route, setRoute] = useState<'home' | 'game'>(() =>
    window.location.pathname === '/game' ? 'game' : 'home',
  );
  const showIntro = route === 'home';

  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname === '/game' ? 'game' : 'home');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: 'home' | 'game') => {
    const path = to === 'game' ? '/game' : '/';
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    setRoute(to);
  }, []);
  const replaysRef = useRef(0);
  const startTimeRef = useRef(Date.now());
  const levelSeenRef = useRef(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaretRef = useRef<number | null>(null);

  if (levelSeenRef.current === -1) levelSeenRef.current = levelFromXp(hive.xp);

  const wordById = useMemo(() => new Map(WORDS.map((w) => [w.id, w])), []);
  const deckWords = useMemo(
    () =>
      WORDS.filter((w) => {
        if (w.language !== lang) return false;
        if (lang === 'en') return true;
        if (frDeck === ALL_GRAMMAR) return w.kind === 'grammar';
        if (frDeck === 'all' || frDeck === null) return w.category?.startsWith('tcf-') === true;
        return w.category === frDeck;
      }),
    [lang, frDeck],
  );

  const pickerOpen = lang === 'fr' && frDeck === null;

  useEffect(() => {
    if (frDeck) localStorage.setItem('spelling.frdeck', frDeck);
    else localStorage.removeItem('spelling.frdeck');
  }, [frDeck]);

  // mobile browsers only allow audio after a user gesture — unlock on the first one
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  const currentWord = queue.length ? wordById.get(queue[0]) ?? null : null;

  const getProgress = useCallback(
    (id: string): WordProgress => progress[id] ?? newProgress(id),
    [progress],
  );

  /* ---------- theme ---------- */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  /* ---------- persistence ---------- */
  useEffect(() => {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  }, [progress]);

  useEffect(() => {
    saveHive(hive);
  }, [hive]);

  useEffect(() => {
    localStorage.setItem(DAILY_KEY, JSON.stringify(daily));
  }, [daily]);

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
  }, [lang]);

  useEffect(() => {
    localStorage.setItem(PRAISE_KEY, praiseOn ? 'on' : 'off');
  }, [praiseOn]);

  /* ---------- session setup ----------
   * Reviews always come first; brand-new words are rationed:
   *  - 'auto'  (app start): today's remaining allowance, at most one chunk
   *  - 'chunk' (keep going): one full bonus chunk beyond the daily cap
   *  - 'force' (nothing due at all): practice the whole deck anyway
   */
  const buildQueue = useCallback(
    (mode: 'auto' | 'chunk' | 'force' | 'failed', minFails = 1) => {
      const now = Date.now();
      let ids: string[];
      if (mode === 'failed') {
        // drill only words failed at least `minFails` times, worst first —
        // ignores the schedule and the daily cap (they're all seen words)
        ids = deckWords
          .map((w) => ({ id: w.id, fails: getProgress(w.id).failCount }))
          .filter((x) => x.fails >= minFails)
          .sort((a, b) => b.fails - a.fails)
          .map((x) => x.id);
      } else {
        const dueReviews: string[] = [];
        const dueNew: string[] = [];
        for (const w of deckWords) {
          const p = getProgress(w.id);
          if (p.due > now) continue;
          (p.seenCount > 0 ? dueReviews : dueNew).push(w.id);
        }
        const allowance =
          mode === 'chunk' ? CHUNK_SIZE : Math.max(0, DAILY_NEW_CAP - daily.introduced[lang]);
        const take = Math.min(allowance, CHUNK_SIZE);
        ids = [...dueReviews, ...dueNew.slice(0, take)];
        if (!ids.length && mode === 'force') ids = deckWords.map((w) => w.id);
      }
      setQueue(ids);
      setCompleted(0);
      setPhase(ids.length ? 'question' : 'done');
      setInput('');
      setLast(null);
      setShowHint(false);
      setCombo(0);
      setComboBroke(false);
      setSessionXp(0);
    },
    [getProgress, daily.introduced, lang, deckWords],
  );

  // fresh session on load and whenever the language is switched
  useEffect(() => {
    if (!pickerOpen) buildQueue('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, frDeck]);

  /* ---------- audio ---------- */
  const playWord = useCallback(async (word: Word, countReplay: boolean) => {
    if (word.kind === 'grammar') return; // exercises are read, not heard
    if (!isSpeechSupported()) return;
    if (countReplay) replaysRef.current += 1;
    setPlaying(true);
    await speakWord(word.id, word.text, word.language);
    setPlaying(false);
  }, []);

  // auto-play whenever a new question starts (not while the intro is up)
  useEffect(() => {
    if (phase === 'question' && currentWord && !showIntro && !pickerOpen) {
      replaysRef.current = 0;
      startTimeRef.current = Date.now();
      setShowHint(false);
      playWord(currentWord, false);
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, queue[0], showIntro, pickerOpen]);

  /* ---------- answer flow ---------- */
  const submit = useCallback(() => {
    if (!currentWord) return;
    if (!normalize(input)) {
      // empty Enter = hear the word again
      playWord(currentWord, true);
      return;
    }
    const now = Date.now();
    const p = getProgress(currentWord.id);
    const answers = [currentWord.text, ...(currentWord.alt ?? [])].map(normalize);
    const correct = answers.includes(normalize(input));
    const grade = deriveGrade(p, {
      correct,
      timeMs: now - startTimeRef.current,
      replays: replaysRef.current,
    });
    const next = applyGrade(p, grade, now);

    // --- nectar / combo ---
    const newCombo = correct ? combo + 1 : 0;
    const xpGained = correct ? xpForAnswer(grade, newCombo) : 0;
    const newXp = hive.xp + xpGained;
    const capped = correct && cellTier(p) < 3 && cellTier(next) === 3;
    let leveledTo: number | undefined;
    if (levelFromXp(newXp) > levelSeenRef.current) {
      leveledTo = levelFromXp(newXp);
      levelSeenRef.current = leveledTo;
    }
    setCombo(newCombo);
    if (correct) setComboBroke(false);
    else if (combo >= 2) {
      setComboBroke(true);
      setBrokenCombo(combo);
    }
    setSessionXp((s) => s + xpGained);
    setHive((h) => ({ xp: h.xp + xpGained, bestStreak: Math.max(h.bestStreak, newCombo) }));

    // a brand-new word counts toward today's introductions on its first answer
    if (p.seenCount === 0) {
      const wl = currentWord.language;
      setDaily((d) => {
        const base = d.date === todayStr() ? d : freshDaily();
        return { ...base, introduced: { ...base.introduced, [wl]: base.introduced[wl] + 1 } };
      });
    }
    setProgress((prev) => ({ ...prev, [currentWord.id]: next }));
    setLast({ word: currentWord, typed: input, correct, grade, progress: next, xpGained, capped, leveledTo });
    setPhase('feedback');
    if (correct) {
      if (praiseOn) {
        const pool = PRAISE[currentWord.language];
        const praise = pool[Math.floor(Math.random() * pool.length)];
        speakWord(praise.id, praise.text, currentWord.language, 1);
      }
    } else {
      if (currentWord.kind !== 'grammar') {
        speakWord(currentWord.id, currentWord.text, currentWord.language, 0.7);
      }
    }
  }, [currentWord, input, getProgress, playWord, combo, hive.xp, praiseOn]);

  const advance = useCallback(() => {
    if (!last) return;
    const now = Date.now();
    setQueue((q) => {
      const rest = q.slice(1);
      const dueSoon = last.progress.due - now < SESSION_HORIZON_MS;
      if (!dueSoon) return rest;
      if (last.grade === 'again') {
        // failed word comes back quickly — a few cards later
        const at = Math.min(2, rest.length);
        return [...rest.slice(0, at), last.word.id, ...rest.slice(at)];
      }
      return [...rest, last.word.id];
    });
    setCompleted((c) => c + 1);
    setInput('');
    setLast(null);
    setPhase('question');
  }, [last]);

  /** leave the current session early — progress already answered is kept */
  /** insert a character at the input caret, keeping focus and caret position */
  const insertAtCursor = useCallback((ch: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    const next = input.slice(0, start) + ch + input.slice(end);
    pendingCaretRef.current = start + ch.length;
    setInput(next);
  }, [input]);

  // restore the caret after React has committed the inserted character
  useEffect(() => {
    const pos = pendingCaretRef.current;
    if (pos === null) return;
    pendingCaretRef.current = null;
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(pos, pos);
    }
  }, [input]);

  /** copy the revealed word (the letter-by-letter diff is hard to select) */
  const copyWord = useCallback(() => {
    if (!last) return;
    const text = last.word.text;
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }, [last]);

  const endSession = useCallback(() => {
    setQueue([]);
    setInput('');
    setLast(null);
    setShowHint(false);
    setPhase('done');
  }, []);

  // when the queue empties after advancing, finish the session
  useEffect(() => {
    if (phase === 'question' && queue.length === 0 && completed > 0) {
      setPhase('done');
    }
  }, [phase, queue.length, completed]);

  const startFromIntro = useCallback(() => {
    navigate('game');
  }, [navigate]);

  /* ---------- keyboard shortcuts ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showIntro || pickerOpen) {
        // the intro only reacts to Enter (start); everything else is native
        if (e.key === 'Enter') {
          e.preventDefault();
          startFromIntro();
        }
        return;
      }
      if (e.key === 'Tab') {
        // only claim Tab where the shortcut applies — the done screen keeps
        // native focus traversal so its buttons stay keyboard-reachable
        if (phase === 'question' && currentWord) {
          e.preventDefault();
          if (e.shiftKey) {
            setShowHint(true);
          } else {
            playWord(currentWord, true);
          }
        } else if (phase === 'feedback' && last) {
          e.preventDefault();
          playWord(last.word, false);
        }
        return;
      }
      if (e.key === 'Enter' && phase === 'feedback') {
        // ignore the same keydown that just submitted the answer (it bubbles
        // up from the input after React re-registers this listener)
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        e.preventDefault();
        advance();
        return;
      }
      if ((e.key === 'c' || e.key === 'C') && phase === 'feedback' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        copyWord();
        return;
      }
      if (e.key === 'Escape' && (phase === 'question' || phase === 'feedback')) {
        e.preventDefault();
        endSession();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, currentWord, last, playWord, advance, endSession, showIntro, pickerOpen, startFromIntro, copyWord]);

  /* ---------- derived ---------- */
  const totalCards = completed + queue.length;
  const pct = totalCards ? Math.round((completed / totalCards) * 100) : 0;
  const now = Date.now();
  const level = levelFromXp(hive.xp);
  const jarFill = levelProgress(hive.xp);
  const flecks = useMemo(
    () => (last?.correct ? makeFlecks(last.capped) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [last?.word.id, last?.correct],
  );
  const tiers = useMemo(
    () => deckWords.map((w) => cellTier(progress[w.id])),
    [progress, deckWords],
  );
  const remainingNew = phase === 'done' ? tiers.filter((t) => t === 0).length : 0;
  /** drill thresholds: how many words have been failed at least N times */
  const FAIL_THRESHOLDS = [1, 2, 3, 5, 8];
  const failedAtLeast = (min: number) =>
    deckWords.filter((w) => getProgress(w.id).failCount >= min).length;
  const failedCount = phase === 'done' ? failedAtLeast(1) : 0;
  const dueReviewCount =
    phase === 'done'
      ? deckWords.filter((w) => {
          const p = getProgress(w.id);
          return p.seenCount > 0 && p.due <= now;
        }).length
      : 0;

  const gradeInfo: Record<Grade, { label: string; title: string }> = {
    easy: { label: 'Sweet!', title: 'Easy' },
    good: { label: 'Nectar', title: 'Good' },
    hard: { label: 'Sticky one', title: 'Hard' },
    again: { label: 'Buzz back soon', title: 'Again' },
  };

  if (showIntro) {
    const enCount = WORDS.filter((w) => w.language === 'en').length;
    const frCount = WORDS.filter((w) => w.language === 'fr').length;
    return (
      <div className="app">
        <main className="card intro-card">
          <div className="intro-logo">🐝</div>
          <h1 className="intro-title">SpellBee</h1>
          <p className="intro-tag">Hear it. Type it. Never misspell it again.</p>
          <ul className="intro-points">
            <li>
              <span className="intro-icon">🔊</span> A natural voice speaks a word — you type
              what you hear
            </li>
            <li>
              <span className="intro-icon">🧠</span> Missed words come back at just the right
              moment — Anki-style spaced repetition that grades itself
            </li>
            <li>
              <span className="intro-icon">🍯</span> Every word is a honeycomb cell — fill your
              hive, chain combos, earn XP and levels
            </li>
            <li>
              <span className="intro-icon">✍️</span> French grammar drills too — fill the blank
              with the right tense, agreement, preposition or connector
            </li>
            <li>
              <span className="intro-icon">⌨️</span> Built for the keyboard — <kbd>Enter</kbd>{' '}
              to answer, <kbd>Tab</kbd> to hear again
            </li>
          </ul>
          <div className="intro-langs">
            <button
              className={`intro-lang ${lang === 'en' ? 'picked' : ''}`}
              onClick={() => setLang('en')}
            >
              <UkFlag />
              <span className="intro-lang-name">English</span>
              <span className="intro-lang-count">{enCount} words</span>
            </button>
            <button
              className={`intro-lang ${lang === 'fr' ? 'picked' : ''}`}
              onClick={() => {
                setLang('fr');
                setFrDeck(null);
              }}
            >
              <FrFlag />
              <span className="intro-lang-name">Français</span>
              <span className="intro-lang-count">{frCount} mots</span>
            </button>
          </div>
          <button className="primary-btn" onClick={startFromIntro}>
            {lang === 'fr' ? 'Commencer' : 'Start'} →
          </button>
          <div className="continue-hint">
            press <kbd>Enter</kbd> to start
          </div>
        </main>
        <footer className="copyright">
          © {new Date().getFullYear()} Hashlabs. All rights reserved.
        </footer>
      </div>
    );
  }

  if (pickerOpen) {
    const frWords = WORDS.filter((w) => w.language === 'fr');
    const stats = (ids: string[]) => {
      const learned = ids.filter((id) => (progress[id]?.seenCount ?? 0) > 0).length;
      const mastered = ids.filter((id) => cellTier(progress[id]) >= 2).length;
      return { total: ids.length, learned, mastered };
    };
    const tcfIds = frWords.filter((w) => w.category?.startsWith('tcf-')).map((w) => w.id);
    const grIds = frWords.filter((w) => w.kind === 'grammar').map((w) => w.id);
    const grStats = stats(grIds);
    const allStats = stats(tcfIds);
    return (
      <div className="app">
        <header className="header">
          <div className="logo">
            <div className="logo-mark">🐝</div>
            SpellBee
          </div>
          <span className="lang-chip">FR</span>
          <div className="header-spacer" />
          <button className="icon-btn" onClick={() => navigate('home')} title="Home" aria-label="Home">
            ?
          </button>
          <button
            className="icon-btn"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title="Toggle dark / light"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </header>
        <main className="card picker-card">
          <div className="summary-title">📚 Choisis ton deck</div>
          <div className="summary-sub">
            500 mots utiles pour le TCF, en 20 séries — plus deux decks bonus.
          </div>
          <button className="deck-card deck-all" onClick={() => setFrDeck('all')}>
            <span className="deck-emoji">🎯</span>
            <span className="deck-name">All TCF sets</span>
            <span className="deck-meta">
              {allStats.total} words · {allStats.learned} seen · {allStats.mastered} mastered
            </span>
          </button>
          <div className="deck-grid">
            {FR_CATEGORIES.map((c) => {
              const ids = frWords.filter((w) => w.category === c.id).map((w) => w.id);
              const st = stats(ids);
              const pct = st.total ? Math.round((st.learned / st.total) * 100) : 0;
              return (
                <button
                  key={c.id}
                  className={`deck-card ${c.group === 'extra' ? 'deck-extra' : ''}`}
                  onClick={() => setFrDeck(c.id)}
                  title={`${st.learned}/${st.total} seen · ${st.mastered} mastered`}
                >
                  <span className="deck-emoji">{c.emoji}</span>
                  <span className="deck-name">
                    {c.group === 'tcf' ? `${c.id.slice(4)} · ` : ''}
                    {c.name}
                  </span>
                  <span className="deck-meta">{st.total} words</span>
                  <span className="deck-bar">
                    <span className="deck-bar-fill" style={{ width: `${pct}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="summary-title picker-section">✍️ Grammaire</div>
          <div className="summary-sub">
            Phrases à trous pour la production écrite : conjugaison, accords, prépositions, connecteurs.
          </div>
          <button className="deck-card deck-all" onClick={() => setFrDeck(ALL_GRAMMAR)}>
            <span className="deck-emoji">✍️</span>
            <span className="deck-name">Toute la grammaire</span>
            <span className="deck-meta">
              {grStats.total} phrases · {grStats.learned} seen · {grStats.mastered} mastered
            </span>
          </button>
          <div className="deck-grid">
            {GRAMMAR_CATEGORIES.map((c) => {
              const ids = frWords.filter((w) => w.category === c.id).map((w) => w.id);
              const st = stats(ids);
              const pct = st.total ? Math.round((st.learned / st.total) * 100) : 0;
              return (
                <button
                  key={c.id}
                  className="deck-card"
                  onClick={() => setFrDeck(c.id)}
                  title={`${st.learned}/${st.total} seen · ${st.mastered} mastered`}
                >
                  <span className="deck-emoji">{c.emoji}</span>
                  <span className="deck-name">{c.name}</span>
                  <span className="deck-meta">{st.total} phrases</span>
                  <span className="deck-bar">
                    <span className="deck-bar-fill" style={{ width: `${pct}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
        </main>
        <div className="copyright">© {new Date().getFullYear()} Hashlabs. All rights reserved.</div>
      </div>
    );
  }

  const deckName =
    lang === 'fr' && frDeck && frDeck !== 'all'
      ? ([...FR_CATEGORIES, ...GRAMMAR_CATEGORIES].find((c) => c.id === frDeck)?.name ??
        (frDeck === ALL_GRAMMAR ? 'Toute la grammaire' : ''))
      : lang === 'fr'
        ? 'All TCF sets'
        : '';

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <div className="logo-mark">🐝</div>
          SpellBee
        </div>
        <button
          className="lang-chip lang-toggle"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const next = lang === 'en' ? 'fr' : 'en';
            if (next === 'fr') setFrDeck(null);
            setLang(next);
          }}
          title={lang === 'en' ? 'Passer au français' : 'Switch to English'}
          aria-label={lang === 'en' ? 'Switch to French' : 'Switch to English'}
        >
          {lang === 'en' ? 'EN' : 'FR'} ⇄
        </button>
        {lang === 'fr' && (
          <button
            className="deck-chip"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFrDeck(null)}
            title="Change deck"
          >
            📚 {deckName}
          </button>
        )}
        <div className="header-spacer" />
        <div
          className={`honey-jar-wrap ${last?.leveledTo ? 'glow' : ''}`}
          role="img"
          aria-label={`Level ${level}, ${hive.xp} XP, ${Math.round(jarFill * 100)}% to level ${level + 1}`}
          title={`${hive.xp} XP — ${Math.round(jarFill * 100)}% to level ${level + 1}`}
        >
          <svg className="honey-jar" viewBox="0 0 24 28" aria-hidden="true">
            <rect x="6" y="0.8" width="12" height="3.4" rx="1.2" className="jar-lid" />
            <clipPath id="jar-body-clip">
              <rect x="3.8" y="5.6" width="16.4" height="20.6" rx="4.2" />
            </clipPath>
            <g clipPath="url(#jar-body-clip)">
              <rect
                x="3.8"
                y="5.6"
                width="16.4"
                height="20.6"
                className="jar-fill"
                style={{ transform: `scaleY(${jarFill})` }}
              />
            </g>
            <rect x="3.8" y="5.6" width="16.4" height="20.6" rx="4.2" className="jar-body" />
          </svg>
          <span className="level-pill">LV {level}</span>
        </div>
        <button
          className="icon-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => navigate('home')}
          title="About SpellBee"
          aria-label="About SpellBee"
        >
          ?
        </button>
        <button
          className={`icon-btn ${praiseOn ? '' : 'off'}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPraiseOn((v) => !v)}
          title={praiseOn ? 'Cheering voice: on' : 'Cheering voice: off'}
          aria-label="Toggle cheering voice"
          aria-pressed={praiseOn}
        >
          {praiseOn ? '🎉' : '🔕'}
        </button>
        <button
          className="icon-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          title="Toggle dark / light"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </header>

      {phase !== 'done' && (
        <>
          <div className="session-progress">
            <span>
              {completed} / {totalCards}
            </span>
            <button
              className="end-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={endSession}
              title="End this session now (Esc) — answers so far are saved"
              aria-label="End session"
            >
              ✕ end
            </button>
            <div className="progress-wrap">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="progress-bee" style={{ left: `${pct}%` }} aria-hidden="true">
                <span className="bee-inner">🐝</span>
              </span>
            </div>
          </div>
          <div className="combo-strip" aria-hidden="true">
            <span
              className={`combo-pill ${combo >= 2 ? 'show' : ''} ${comboBroke ? 'broke' : ''}`}
            >
              COMBO ×{comboBroke ? brokenCombo : combo}
            </span>
            <span className={`session-xp ${sessionXp > 0 ? 'show' : ''}`}>
              +{sessionXp} XP this session
            </span>
          </div>
        </>
      )}

      {/* ---------- question ---------- */}
      {phase === 'question' && currentWord && (
        <main className="card">
          <span className="status-chip">{getProgress(currentWord.id).status}</span>
          <FailBadge fails={getProgress(currentWord.id).failCount} />
          {currentWord.kind === 'grammar' ? (
            <>
              <BlankSentence sentence={currentWord.sentence} />
              <div className="gr-cue">{currentWord.cue}</div>
            </>
          ) : (
            <>
              <button
                className={`play-btn ${playing ? 'playing' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => playWord(currentWord, true)}
                aria-label="Play word"
              >
                <SpeakerIcon />
              </button>
              <div className="listen-label">Listen and type what you hear</div>
            </>
          )}
          <form
            style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              ref={inputRef}
              className="spell-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // ignore Enter that commits an IME composition (CJK keyboards)
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={currentWord.kind === 'grammar' ? 'complète la phrase…' : 'type the word…'}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </form>
          {lang === 'fr' && (
            <div className="accent-bar" aria-label="Insert accented letter">
              {ACCENTS.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  className="accent-key"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertAtCursor(ch)}
                >
                  {ch}
                </button>
              ))}
            </div>
          )}
          {showHint && currentWord.kind === 'grammar' && (
            <div className="hint-sentence">💡 {currentWord.rule}</div>
          )}
          {showHint && currentWord.kind !== 'grammar' && (
            <div className="hint-sentence">
              “
              {currentWord.sentence
                .split(new RegExp(escapeRegExp(currentWord.text), 'i'))
                .flatMap((part, i, arr) =>
                  i < arr.length - 1 ? [part, <b key={i}>____</b>] : [part],
                )}
              ”
            </div>
          )}
        </main>
      )}

      {/* ---------- feedback ---------- */}
      {phase === 'feedback' && last && (
        <main className={`card ${last.correct ? '' : 'fb-wrong'}`}>
          <span className="status-chip">{last.progress.status}</span>
          <FailBadge fails={last.progress.failCount} />
          {last.leveledTo !== undefined && (
            <div className="level-stamp" aria-hidden="true">
              LEVEL {last.leveledTo}
            </div>
          )}
          <div className="verdict-wrap">
            {flecks.map((f, i) => (
              <i
                key={i}
                className="fleck"
                style={
                  {
                    '--dx': f.dx,
                    '--dy': f.dy,
                    '--rot': f.rot,
                    background: f.color,
                    animationDelay: f.delay,
                  } as React.CSSProperties
                }
              />
            ))}
            <div className={`verdict ${last.correct ? 'ok' : 'bad'}`}>
              {last.correct ? '✓ Correct' : '✗ Not quite'}
              {last.xpGained > 0 && <span className="xp-inline">+{last.xpGained} XP</span>}
            </div>
            {last.xpGained > 0 && (
              <span className="xp-flyup" aria-hidden="true">
                +{last.xpGained} XP
              </span>
            )}
          </div>
          {last.word.kind === 'grammar' ? (
            <BlankSentence sentence={last.word.sentence} fill={last.word.text} />
          ) : (
            <SyllableTip word={last.word} />
          )}
          <button
            type="button"
            className={`copy-btn ${copied ? 'copied' : ''}`}
            onClick={copyWord}
            title="Copy the word (C)"
            aria-label="Copy the word"
          >
            {copied ? '✓ Copied' : '⧉ Copy'}
          </button>
          <LetterDiff correct={last.word.text} typed={last.typed} />
          {last.word.kind === 'grammar' && last.word.rule && (
            <div className="gr-rule">💡 {last.word.rule}</div>
          )}
          {last.word.kind === 'grammar' && last.word.alt && last.word.alt.length > 0 && (
            <div className="gr-alt">also correct: {last.word.alt.join(', ')}</div>
          )}
          {last.capped && <span className="capped-chip">Capped 🍯 — this word is mastered</span>}
          {!last.correct && (
            <div className="typed-line">
              you typed <s>{last.typed}</s>
            </div>
          )}
          <div className="grade-row">
            <span>App rated it</span>
            <span className={`grade-pill ${last.grade}`} title={gradeInfo[last.grade].title}>
              {gradeInfo[last.grade].label}
            </span>
            <span>· next review {dueLabel(last.progress, now)}</span>
          </div>
          <div className="continue-hint">
            press <kbd>Enter</kbd> to continue
          </div>
        </main>
      )}

      {/* ---------- done: the hive ---------- */}
      {phase === 'done' && (
        <main className="card">
          <div className="summary-title">
            {completed > 0 ? '🎉 Session complete' : '🍯 Your Hive'}
          </div>
          <div className="summary-sub">
            {completed > 0
              ? `Chunk complete — ${completed} cards. The hive grows.`
              : remainingNew > 0
                ? `${remainingNew} words are still waiting in the deck.`
                : 'Nothing due right now — every cell below is a word.'}
          </div>
          <HivePanorama tiers={tiers} words={deckWords} />
          <div className="hive-legend" aria-hidden="true">
            <span className="leg leg-t3">{tiers.filter((t) => t === 3).length} capped</span>
            <span className="leg leg-t2">{tiers.filter((t) => t === 2).length} honey</span>
            <span className="leg leg-t1">{tiers.filter((t) => t === 1).length} wax</span>
            <span className="leg leg-t0">{tiers.filter((t) => t === 0).length} unseen</span>
          </div>
          <div className="hive-stats">
            LV {level} · {hive.xp} XP · best combo ×{hive.bestStreak}
          </div>
          <div className="daily-line">
            {daily.introduced[lang] >= DAILY_NEW_CAP
              ? `🎯 Daily goal reached — ${daily.introduced[lang]} new ${lang === 'fr' ? 'French' : 'English'} words today! Extra chunks are bonus.`
              : `Today: ${daily.introduced[lang]} / ${DAILY_NEW_CAP} new ${lang === 'fr' ? 'French' : 'English'} words`}
          </div>
          <details className="word-details">
            <summary>Word details</summary>
            <div className="summary-list">
              {deckWords.map((w) => {
                const p = getProgress(w.id);
                return (
                  <div className="summary-row" key={w.id}>
                    <span className="summary-word">{p.seenCount > 0 ? w.text : '•••••'}</span>
                    <span className={`summary-fails ${p.failCount === 0 ? 'clean' : ''}`}>
                      {p.failCount === 0
                        ? 'no fails'
                        : `${p.failCount} fail${p.failCount > 1 ? 's' : ''}`}
                    </span>
                    <span className="summary-meta">
                      {p.seenCount === 0 ? 'not seen yet' : `due ${dueLabel(p, now)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </details>
          <div className="done-actions">
            {remainingNew > 0 ? (
              <button className="primary-btn" onClick={() => buildQueue('chunk')}>
                Next chunk — {Math.min(CHUNK_SIZE, remainingNew)} new words 🐝
              </button>
            ) : dueReviewCount > 0 ? (
              <button className="primary-btn" onClick={() => buildQueue('auto')}>
                Review {dueReviewCount} due word{dueReviewCount > 1 ? 's' : ''}
              </button>
            ) : (
              <button className="primary-btn" onClick={() => buildQueue('force')}>
                Practice again
              </button>
            )}
          </div>
          {failedCount > 0 && (
            <div className="drill-row">
              <span className="drill-label">🔁 Drill words failed at least</span>
              {FAIL_THRESHOLDS.map((min) => {
                const n = failedAtLeast(min);
                return n > 0 ? (
                  <button
                    key={min}
                    className="drill-chip"
                    onClick={() => buildQueue('failed', min)}
                    title={`${n} word${n > 1 ? 's' : ''} failed ${min}+ times — most-failed first`}
                  >
                    {min}× <span className="drill-count">({n})</span>
                  </button>
                ) : null;
              })}
            </div>
          )}
        </main>
      )}

      <footer className="shortcuts">
        <span className="shortcut">
          <kbd>Enter</kbd> submit / next
        </span>
        <span className="shortcut">
          <kbd>Tab</kbd> hear again
        </span>
        <span className="shortcut">
          <kbd>Shift</kbd>+<kbd>Tab</kbd> hint sentence
        </span>
        <span className="shortcut">
          <kbd>Esc</kbd> end session
        </span>
        <span className="shortcut">
          <kbd>C</kbd> copy word
        </span>
      </footer>
      <div className="copyright">© {new Date().getFullYear()} Hashlabs. All rights reserved.</div>
    </div>
  );
}

/** memory hook: the word broken into sound chunks, e.g. ad-ver-tise-ment.
 * Uses the hand-authored chunks from the word data; the algorithmic splitter
 * is only a safety net for words that don't have them yet. */
function SyllableTip({ word }: { word: Word }) {
  const chunks = word.chunks ?? syllabify(word.text);
  if (chunks.length < 2) return null;
  return (
    <div className="syllable-tip" title="Remember it in chunks">
      🧩{' '}
      {chunks.map((c, i) => (
        <span key={i}>
          {i > 0 && <span className="syl-dash">-</span>}
          {c}
        </span>
      ))}
    </div>
  );
}

/** execCommand fallback for browsers without the async clipboard API */
function fallbackCopy(text: string, done: () => void) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    done();
  } finally {
    document.body.removeChild(ta);
  }
}


/** a sentence with its ___ blank rendered as a slot, or filled with the answer */
function BlankSentence({ sentence, fill }: { sentence: string; fill?: string }) {
  const [before, after] = sentence.split('___');
  return (
    <p className="gr-sentence">
      {before}
      {fill ? <mark className="gr-fill">{fill}</mark> : <span className="gr-blank">____</span>}
      {after}
    </p>
  );
}

function FailBadge({ fails }: { fails: number }) {
  return (
    <span className={`fail-badge ${fails === 0 ? 'clean' : ''}`}>
      {fails === 0 ? 'no fails yet' : `failed ×${fails}`}
    </span>
  );
}

/** 200 hex cells, 20 per row, odd rows offset — the persistent hive */
function HivePanorama({ tiers, words }: { tiers: number[]; words: Word[] }) {
  const COLS = 20;
  const W = 29; // horizontal step
  const H = 32; // hex height
  const STEP = 25; // vertical step
  const rows = Math.ceil(words.length / COLS);
  const width = COLS * W + W / 2 + 1;
  const height = (rows - 1) * STEP + H;
  const counts = `${tiers.filter((t) => t === 3).length} capped, ${tiers.filter((t) => t === 2).length} honey, ${tiers.filter((t) => t === 1).length} wax, ${tiers.filter((t) => t === 0).length} unseen`;
  return (
    <svg
      className="hive-panorama"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Hive: ${counts}`}
    >
      {words.map((w, i) => {
        const row = Math.floor(i / COLS);
        const col = i % COLS;
        const x = col * W + (row % 2 ? W / 2 : 0);
        const y = row * STEP;
        return (
          <g key={w.id} transform={`translate(${x} ${y})`}>
            <polygon
              className={`hex hex-t${tiers[i]}`}
              points="14,0 28,8 28,24 14,32 0,24 0,8"
              style={{ animationDelay: `${i * 5}ms` }}
            />
            <title>{tiers[i] > 0 ? w.text : '•••••'}</title>
          </g>
        );
      })}
    </svg>
  );
}

/* Flag emoji render as plain letters on Windows, so the intro uses SVGs */
function UkFlag() {
  return (
    <svg className="intro-flag" viewBox="0 0 60 40" aria-hidden="true">
      <clipPath id="uk-clip">
        <rect width="60" height="40" rx="6" />
      </clipPath>
      <g clipPath="url(#uk-clip)">
        <rect width="60" height="40" fill="#012169" />
        <path d="M0,0 60,40 M60,0 0,40" stroke="#fff" strokeWidth="8" />
        <path d="M0,0 60,40 M60,0 0,40" stroke="#C8102E" strokeWidth="4" />
        <path d="M30,0 V40 M0,20 H60" stroke="#fff" strokeWidth="13" />
        <path d="M30,0 V40 M0,20 H60" stroke="#C8102E" strokeWidth="7" />
      </g>
    </svg>
  );
}

function FrFlag() {
  return (
    <svg className="intro-flag" viewBox="0 0 60 40" aria-hidden="true">
      <clipPath id="fr-clip">
        <rect width="60" height="40" rx="6" />
      </clipPath>
      <g clipPath="url(#fr-clip)">
        <rect width="20" height="40" fill="#002395" />
        <rect x="20" width="20" height="40" fill="#fff" />
        <rect x="40" width="20" height="40" fill="#ED2939" />
      </g>
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}
