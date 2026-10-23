// Builds public/privacy.html from PRIVACY.md, so the policy has one source.
// Handles only what PRIVACY.md uses: # / ## headings, "- " bullets, **bold**,
// paragraphs, and email addresses (made into mailto links).
import { readFileSync, writeFileSync } from 'node:fs';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, m => `<a href="mailto:${m}">${m}</a>`);

export function toHtml(md) {
  const out = [];
  for (const block of md.trim().split(/\n\s*\n/)) {
    const lines = block.split('\n');
    if (lines.every(l => l.startsWith('- '))) {
      out.push('<ul>', ...lines.map(l => `<li>${inline(l.slice(2))}</li>`), '</ul>');
    } else if (block.startsWith('## ')) out.push(`<h2>${inline(block.slice(3))}</h2>`);
    else if (block.startsWith('# ')) out.push(`<h1>${inline(block.slice(2))}</h1>`);
    else out.push(`<p>${inline(lines.join(' '))}</p>`);
  }
  return out.join('\n');
}

const page = body => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy policy · Pasar Malam MTG</title>
<link rel="icon" href="/favicon.svg">
<style>
  body { margin: 0; background: #f2f2f7; color: #1c1c1e; font: 17px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 30px; margin: 0 0 4px; } h2 { font-size: 20px; margin: 32px 0 8px; }
  ul { padding-left: 22px; } li { margin: 6px 0; } a { color: #0066cc; }
  .back { display: inline-block; margin-bottom: 24px; }
  @media (prefers-color-scheme: dark) { body { background: #000; color: #f2f2f7; } a { color: #409cff; } }
</style></head>
<body><main><a class="back" href="/">← Pasar Malam MTG</a>
${body}
</main></body></html>
`;

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(new URL('../public/privacy.html', import.meta.url), page(toHtml(readFileSync(new URL('../PRIVACY.md', import.meta.url), 'utf8'))));
}
