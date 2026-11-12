/**
 * Orthographic syllable chunking — "brain support" for remembering spellings.
 * Splits a word into pronounceable spelling chunks, e.g.
 *   interpretation -> in-ter-pre-ta-tion
 *   necessary      -> ne-ces-sa-ry
 * Heuristic, not a dictionary: VC-CV / V-CV splitting with common English and
 * French digraphs and onset clusters kept together.
 */

const VOWELS = new Set('aeiouyàâäéèêëîïôöùûüœ');

/** two-letter groups that should start a syllable together */
const ONSETS = new Set([
  'bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gn', 'gr', 'kn',
  'ph', 'pl', 'pr', 'qu', 'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'st',
  'sw', 'th', 'tr', 'tw', 'wh', 'wr',
]);

function isVowel(ch: string): boolean {
  return VOWELS.has(ch);
}

function syllabifyPart(word: string): string[] {
  const n = word.length;
  // find maximal vowel groups
  const groups: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < n) {
    if (isVowel(word[i])) {
      const start = i;
      while (i < n && isVowel(word[i])) i++;
      groups.push({ start, end: i - 1 });
    } else {
      i++;
    }
  }
  if (groups.length < 2) return [word];

  // choose a split point inside each consonant run between vowel groups
  const cuts: number[] = [];
  for (let g = 0; g < groups.length - 1; g++) {
    const consStart = groups[g].end + 1;
    const consEnd = groups[g + 1].start - 1; // inclusive
    const len = consEnd - consStart + 1;
    if (len <= 0) {
      // adjacent vowel groups can't happen (groups are maximal)
      continue;
    }
    if (len === 1) {
      cuts.push(consStart); // V-CV
    } else {
      const lastTwo = word.slice(consEnd - 1, consEnd + 1);
      if (ONSETS.has(lastTwo)) {
        cuts.push(consEnd - 1); // keep the cluster with the next syllable
      } else {
        cuts.push(consEnd); // split before the last consonant (VC-CV)
      }
    }
  }

  const chunks: string[] = [];
  let prev = 0;
  for (const cut of cuts) {
    if (cut > prev) chunks.push(word.slice(prev, cut));
    prev = cut;
  }
  chunks.push(word.slice(prev));

  // merge a trailing silent-e chunk ("be-lie-ve" -> "be-lieve") — but keep a
  // consonant+le syllable ("litt-le") intact
  if (chunks.length > 1) {
    const tail = chunks[chunks.length - 1];
    const beforeTail = chunks[chunks.length - 2];
    if (/^[^aeiouy]*e$/.test(tail) && isVowel(beforeTail[beforeTail.length - 1])) {
      chunks.splice(chunks.length - 2, 2, beforeTail + tail);
    }
  }
  return chunks.filter(Boolean);
}

/** Split a word into spelling chunks; hyphens/apostrophes are natural cuts.
 * Multi-word phrases ("tout de suite") get no breakdown — a dashed tip would
 * misrepresent the spaces. */
export function syllabify(word: string): string[] {
  if (word.includes(' ')) return [word];
  return word
    .toLowerCase()
    .split(/([-'])/)
    .flatMap((part) => (part === '-' || part === "'" ? [] : syllabifyPart(part)));
}
