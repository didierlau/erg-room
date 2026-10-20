// Copies the files the browser needs into _site/ for GitHub Pages.
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}_site`;
await rm(out, { recursive: true, force: true });
await mkdir(out);
for (const entry of ['index.html', 'styles.css', 'src', '.nojekyll']) await cp(`${root}${entry}`, `${out}/${entry}`, { recursive: true });
console.log('Built _site/');
