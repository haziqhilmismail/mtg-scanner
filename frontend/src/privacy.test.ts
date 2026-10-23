import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error plain .mjs build script, no types
import { toHtml } from '../scripts/privacy.mjs';

test('the privacy page renders the markdown the policy uses', () => {
  const html = toHtml('# Title\n\nAsk me at a.b@gmail.com.\n\n## Data\n\n- **Account.** Your email.\n- Photos & <scans>');
  assert.equal(html, [
    '<h1>Title</h1>',
    '<p>Ask me at <a href="mailto:a.b@gmail.com">a.b@gmail.com</a>.</p>',
    '<h2>Data</h2>',
    '<ul>', '<li><strong>Account.</strong> Your email.</li>', '<li>Photos &amp; &lt;scans&gt;</li>', '</ul>',
  ].join('\n'));
});
