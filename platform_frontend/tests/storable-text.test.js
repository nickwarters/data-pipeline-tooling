// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toStorableText } from '../src/lib/storable-text.js';

test('storable text: a Word or Outlook soft line break becomes a newline', () => {
  assert.equal(toStorableText('one\u000Btwo\u000Cthree'), 'one\ntwo\nthree');
});

test('storable text: every other control character is removed, and tab and line breaks stay', () => {
  for (let code = 0; code <= 0x1f; code++) {
    const char = String.fromCharCode(code);
    const kept = ['\t', '\n', '\r'].includes(char);
    const softBreak = code === 0x0b || code === 0x0c;
    const expected = softBreak ? 'a\nb' : kept ? `a${char}b` : 'ab';
    assert.equal(toStorableText(`a${char}b`), expected, `U+${code}`);
  }
});

test('storable text: the non-characters and a lone surrogate are removed', () => {
  assert.equal(toStorableText('a\uFFFEb\uFFFFc'), 'abc');
  assert.equal(toStorableText('a\uD83Db'), 'ab');
  assert.equal(toStorableText('a\uDE00b'), 'ab');
  assert.equal(toStorableText('a\uDE00\uD83D'), 'a');
});

test('storable text: valid text is left exactly as typed', () => {
  const text =
    'Emoji \u{1F600}\u{1F468}‍\u{1F469} “smart” ’ dash — nbsp here\tand\r\nnewline café';
  assert.equal(toStorableText(text), text);
});
