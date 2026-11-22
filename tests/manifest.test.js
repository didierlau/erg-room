// Checks that Chrome can install Erg Room as an app: the manifest has what
// installability needs, its icons exist at the stated sizes, and the page and
// build both include it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BUILD_ENTRIES } from '../scripts/build-entries.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const PNG_WIDTH_OFFSET = 16;
const REQUIRED_SIZES = ['192x192', '512x512'];

const manifest = JSON.parse(await readFile(`${root}manifest.webmanifest`, 'utf8'));

/** Reads width and height from a PNG file header. */
async function pngSize(path) {
  const buf = await readFile(path);
  return `${buf.readUInt32BE(PNG_WIDTH_OFFSET)}x${buf.readUInt32BE(PNG_WIDTH_OFFSET + 4)}`;
}

test('manifest has the fields Chrome needs to install the app', () => {
  assert.equal(manifest.name, 'Erg Room');
  assert.ok(manifest.short_name);
  assert.equal(manifest.display, 'standalone');
  // Relative so it works under /erg-room/ on GitHub Pages and at / locally.
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
});

test('manifest lists 192 and 512 px PNG icons for normal use', () => {
  const sizes = manifest.icons.filter((i) => i.type === 'image/png' && i.purpose.split(' ').includes('any')).map((i) => i.sizes);
  for (const size of REQUIRED_SIZES) assert.ok(sizes.includes(size), `missing ${size} icon`);
});

test('every icon file exists and PNGs match their stated size', async () => {
  for (const icon of manifest.icons) {
    await access(`${root}${icon.src}`);
    if (icon.type === 'image/png') assert.equal(await pngSize(`${root}${icon.src}`), icon.sizes, icon.src);
  }
});

test('index.html links the manifest', async () => {
  const html = await readFile(`${root}index.html`, 'utf8');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
});

test('build copies the manifest and icons to the site', () => {
  assert.ok(BUILD_ENTRIES.includes('manifest.webmanifest'));
  assert.ok(BUILD_ENTRIES.includes('icons'));
});
