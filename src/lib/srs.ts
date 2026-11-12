/**
 * Spaced-repetition engine, SM-2 inspired (like Anki) — but the app grades
 * the answer itself instead of asking the user for Again/Hard/Good/Easy.
 *
 * Grade derivation:
 *  - wrong answer                                  -> AGAIN
 *  - correct but slow / many replays / after fails -> HARD
 *  - correct                                       -> GOOD
 *  - correct, fast, 3+ streak                      -> EASY
 */

export type Grade = 'again' | 'hard' | 'good' | 'easy';

export interface WordProgress {
  wordId: string;
  status: 'new' | 'learning' | 'review';
  /** index into LEARNING_STEPS while status === 'learning' */
  stepIndex: number;
  /** current review interval in days (once graduated) */
  intervalDays: number;
  /** SM-2 ease factor */
  ease: number;
  /** epoch ms when the word is next due */
  due: number;
  /** consecutive correct answers */
  correctStreak: number;
  /** lifetime number of failed attempts (shown in the UI) */
  failCount: number;
  /** total attempts */
  seenCount: number;
}

/** Learning steps in minutes (like Anki's default 1m / 10m) */
const LEARNING_STEPS_MIN = [1, 10];
const MIN_EASE = 1.3;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

export function newProgress(wordId: string): WordProgress {
  return {
    wordId,
    status: 'new',
    stepIndex: 0,
    intervalDays: 0,
    ease: 2.5,
    due: 0, // due immediately
    correctStreak: 0,
    failCount: 0,
    seenCount: 0,
  };
}

export interface AnswerContext {
  correct: boolean;
  /** ms between first audio play and submit */
  timeMs: number;
  /** how many times the audio was replayed before answering */
  replays: number;
}

/** The app decides the grade — the user never does. */
export function deriveGrade(p: WordProgress, ctx: AnswerContext): Grade {
  if (!ctx.correct) return 'again';
  const fast = ctx.timeMs < 12_000 && ctx.replays <= 1;
  const slow = ctx.timeMs > 25_000 || ctx.replays >= 3;
  if (p.correctStreak + 1 >= 3 && fast) return 'easy';
  if (slow) return 'hard';
  return 'good';
}

export function applyGrade(p: WordProgress, grade: Grade, now: number): WordProgress {
  const next = { ...p, seenCount: p.seenCount + 1 };

  if (grade === 'again') {
    next.failCount += 1;
    next.correctStreak = 0;
    next.ease = Math.max(MIN_EASE, p.ease - 0.2);
    next.status = 'learning';
    next.stepIndex = 0;
    next.intervalDays = 0;
    // due almost immediately -> it comes back later in the same session
    next.due = now + 30 * 1000;
    return next;
  }

  next.correctStreak = p.correctStreak + 1;

  if (grade === 'easy') {
    // graduate right away with a bonus interval
    next.status = 'review';
    next.stepIndex = LEARNING_STEPS_MIN.length;
    next.intervalDays = Math.max(4, Math.round(p.intervalDays * p.ease * 1.3));
    next.ease = p.ease + 0.15;
    next.due = now + next.intervalDays * DAY_MS;
    return next;
  }

  if (p.status === 'new' || p.status === 'learning') {
    const step = grade === 'hard' ? p.stepIndex : p.stepIndex + 1;
    if (step >= LEARNING_STEPS_MIN.length) {
      // graduated
      next.status = 'review';
      next.intervalDays = 1;
      next.due = now + DAY_MS;
    } else {
      next.status = 'learning';
      next.stepIndex = step;
      next.due = now + LEARNING_STEPS_MIN[step] * MIN_MS;
    }
    return next;
  }

  // review state
  if (grade === 'hard') {
    next.ease = Math.max(MIN_EASE, p.ease - 0.15);
    next.intervalDays = Math.max(1, Math.round(p.intervalDays * 1.2));
  } else {
    next.intervalDays = Math.max(1, Math.round(p.intervalDays * p.ease));
  }
  next.due = now + next.intervalDays * DAY_MS;
  return next;
}

/** Human label for the next due time, e.g. "in 10 min" / "in 4 days" */
export function dueLabel(p: WordProgress, now: number): string {
  const ms = p.due - now;
  if (ms <= 0) return 'now';
  if (ms < 90 * MIN_MS) return `in ${Math.max(1, Math.round(ms / MIN_MS))} min`;
  if (ms < DAY_MS) return `in ${Math.round(ms / (60 * MIN_MS))} h`;
  const days = Math.round(ms / DAY_MS);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}
