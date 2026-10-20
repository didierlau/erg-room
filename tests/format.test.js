import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, formatDuration, escapeHtml, safeFileName, localIsoDate } from '../src/core/format.js';

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(59.6), '1:00');
  assert.equal(formatDuration(605), '10:05');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(-10), '0:00');
});

test('clamp, escapeHtml, safeFileName, localIsoDate', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(safeFileName('VO₂ 5×3 / hard'), 'VO 53  hard');
  assert.equal(safeFileName('***', 'Ride'), 'Ride');
  assert.equal(localIsoDate(new Date(2026, 0, 5)), '2026-01-05');
});
