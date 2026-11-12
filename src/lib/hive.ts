/**
 * The Living Hive — progression layer on top of the SRS engine.
 *
 * Layer 1: comb cells. Every word is a honeycomb cell whose tier is DERIVED
 * from its existing SRS record (never stored) — so the hive is always truthful:
 *   T0 unseen · T1 wax (learning) · T2 honey (young review) · T3 capped (mature)
 *
 * Layer 2: nectar (XP). One localStorage key {xp, bestStreak}. Answers pay
 * XP scaled by a session combo; level is derived from XP, never stored.
 */
import type { Grade, WordProgress } from './srs';

export interface HiveStats {
  xp: number;
  bestStreak: number;
}

const HIVE_KEY = 'spelling.hive.v1';

/** 0 unseen · 1 wax · 2 honey · 3 capped */
export function cellTier(p: WordProgress | undefined): 0 | 1 | 2 | 3 {
  if (!p || p.seenCount === 0) return 0;
  if (p.status !== 'review') return 1;
  return p.intervalDays >= 21 ? 3 : 2;
}

const BASE_XP: Record<Grade, number> = { again: 0, hard: 5, good: 10, easy: 15 };

/** combo is the value AFTER this answer (1 = first correct in a row) */
export function xpForAnswer(grade: Grade, combo: number): number {
  const base = BASE_XP[grade];
  if (base === 0) return 0;
  return base + 2 * Math.min(combo, 5);
}

/** total XP needed to reach level n (L1@100, L2@300, L3@600, L4@1000 …) */
export function levelThreshold(n: number): number {
  return 50 * n * (n + 1);
}

export function levelFromXp(xp: number): number {
  let n = 0;
  while (levelThreshold(n + 1) <= xp) n++;
  return n;
}

/** 0..1 fill of the honey jar toward the next level */
export function levelProgress(xp: number): number {
  const level = levelFromXp(xp);
  const lo = levelThreshold(level);
  const hi = levelThreshold(level + 1);
  return Math.max(0, Math.min(1, (xp - lo) / (hi - lo)));
}

/**
 * Load hive stats; on first run, seed XP from existing SRS progress so a
 * returning user's jar reflects the practice they have already done.
 */
export function loadHive(progress: Record<string, WordProgress> | null | undefined): HiveStats {
  const safeProgress = progress && typeof progress === 'object' ? progress : {};
  try {
    const raw = localStorage.getItem(HIVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.xp === 'number' && typeof parsed.bestStreak === 'number') return parsed;
    }
  } catch {
    /* corrupted — reseed below */
  }
  const SEED_XP = [0, 2, 8, 15];
  const xp = Object.values(safeProgress).reduce((sum, p) => sum + SEED_XP[cellTier(p)], 0);
  return { xp, bestStreak: 0 };
}

export function saveHive(stats: HiveStats): void {
  localStorage.setItem(HIVE_KEY, JSON.stringify(stats));
}
