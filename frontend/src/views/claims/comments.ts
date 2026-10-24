// Reading what came back from a comment screenshot, for the seller to check:
// the comments as rows, and claims whose card name the buyer spelled another
// way. Display only: the claims themselves are read from the raw text.

export interface CommentRow { name: string; text: string }

const TIME = String.raw`\d+\s*(?:s|m|h|d|w|y|j|min|mins|hr|hrs|wk|wks|yr|yrs|minit|jam|hari|minggu|thn)|just now|yesterday|baru sahaja|semalam`;
const CHROME = new RegExp(String.raw`\b(?:like|reply|replies|share|send|edited|author|top fan|most relevant|all comments|newest|view more replies|view more comments|view \d+ more replies|view all \d+ replies|write a comment|write a public comment|suka|balas|kongsi|diedit|penulis|peminat teratas|${TIME})\b`, 'gi');

// Facebook's own words: "Like  Reply  2h", "All comments", a reaction count.
const isChrome = (line: string) => !/[\p{L}\p{N}]/u.test(line.replace(CHROME, '').replace(/\d+/g, ''));

// "Amir Rahman · 1d": a commenter's name with when they wrote.
function timedName(line: string): string | null {
  const m = /^(.+?)\s+·\s+(.+)$/.exec(line);
  return m && isChrome(m[2]) ? m[1] : null;
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

// A comment is its writer's name, then their words, then Facebook's line
// ("Like Reply 2h"). When names carry their time ("Name · 1d"), only those
// lines start a comment, so the post text above the thread is left out.
export function commentRows(text: string): CommentRow[] {
  const lines = text.split('\n').map(tidy).filter(Boolean);
  const timed = lines.some(l => timedName(l) != null);
  const rows: Array<{ name: string; words: string[] }> = [];
  let open: (typeof rows)[number] | null = null;
  for (const line of lines) {
    const name = timedName(line);
    if (name != null) rows.push(open = { name, words: [] });
    else if (isChrome(line)) open = null;
    else if (open) open.words.push(line);
    else if (!timed) rows.push(open = { name: line, words: [] });
  }
  return rows.filter(r => r.words.length).map(r => ({ name: r.name, text: r.words.join(' ') }));
}

const words = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ'’]/g, '').toLowerCase()
  .split(/[^a-z0-9]+/).filter(w => w.length >= 3);

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

// Whether the buyer wrote the card's name another way ("ezuri predation" for
// "Ezuri's Predation"): a word of theirs one or two letters off a word of the
// name. A position or a nickname ("top left", "rhystic") is not a spelling.
export function spelledDifferently(said: string, cardName: string): boolean {
  const name = words(cardName);
  return words(said).some(w => !name.includes(w) && name.some(n => {
    const d = editDistance(w, n);
    return d <= (Math.min(w.length, n.length) >= 6 ? 2 : 1);
  }));
}
