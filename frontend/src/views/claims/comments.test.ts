import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commentRows, spelledDifferently } from './comments.ts';

// A seller's post on a PC, as OCR hands it over: the post text, then each
// comment as "Name · 1d", the words, and Facebook's own line.
const DESKTOP = `NF - x2.5
F - 2.8
Drop off CnH next week Tuesday earliest
All comments
30
Nurul Huda · 1d
Reply
Nurul Huda · 1d
beledros witherbloom JP x2.2
Reply
Amir Rahman · Top fan · 1d
Nurul Huda claim abrupt decay
Reply 👍1
Daniel Tan · 2h
Nurul Huda claim Rakdos Charm
and the foil one
Like   Reply
Write a comment...`;

test('timed names start the comments; the post text and Facebook lines are left out', () => {
  assert.deepEqual(commentRows(DESKTOP), [
    { name: 'Nurul Huda', text: 'beledros witherbloom JP x2.2' },
    { name: 'Amir Rahman', text: 'Nurul Huda claim abrupt decay' },
    { name: 'Daniel Tan', text: 'Nurul Huda claim Rakdos Charm and the foil one' },
  ]);
});

test('without times, a name follows each Facebook line', () => {
  const phone = '  Siti   Aisyah \nNak Sol Ring 2, PM boss 🙏\nLike   Reply   1h\nK\ndibs\n2h Like Reply\nHafiz Rahman\n\nLike Reply 4h\n陈伟杰\n要 Kenrith\nSuka  Balas  3j';
  assert.deepEqual(commentRows(phone), [
    { name: 'Siti Aisyah', text: 'Nak Sol Ring 2, PM boss 🙏' },
    { name: 'K', text: 'dibs' },
    { name: '陈伟杰', text: '要 Kenrith' },
  ]);
  assert.deepEqual(commentRows(''), []);
});

test('a card name the buyer spelled another way is flagged; positions and short names are not', () => {
  assert.equal(spelledDifferently('ezuri predation', "Ezuri's Predation"), true);
  assert.equal(spelledDifferently('sol rng', 'Sol Ring'), true);
  assert.equal(spelledDifferently('lightnig bolt', 'Lightning Bolt'), true);
  assert.equal(spelledDifferently('Mechanized Production', 'Mechanized Production'), false);
  assert.equal(spelledDifferently('Lord Skitter x1', 'Lord Skitter, Sewer King'), false);
  assert.equal(spelledDifferently('rhystic', 'Rhystic Study'), false);
  assert.equal(spelledDifferently('top left', "Ezuri's Predation"), false);
  assert.equal(spelledDifferently('the RM58 one', 'Smothering Tithe'), false);
  assert.equal(spelledDifferently('', 'Opt'), false);
  assert.equal(spelledDifferently('aether vial', 'Æther Vial'), false);
});
