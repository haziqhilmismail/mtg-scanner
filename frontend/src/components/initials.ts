// The letters that stand in for a missing avatar: the first letter of the
// first and last words, as a person writes them, one letter for one word.
// Segmenter keeps an emoji or an accented letter whole.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (w: string) => ('Segmenter' in Intl
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(w)][0]?.segment
    : [...w][0]) ?? '';
  const picks = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return picks.map(w => first(w).toLocaleUpperCase()).join('');
}
