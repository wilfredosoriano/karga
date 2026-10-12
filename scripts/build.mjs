// Copies the app into dist/ and fills in the Mapbox token from MAPBOX_TOKEN.
// Locally the token comes from .env; on Vercel it comes from the project's Environment Variables.
// Run with Node 18 or newer:  node scripts/build.mjs
import { cp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const PLACEHOLDER = 'pk.REPLACE_WITH_YOUR_MAPBOX_PUBLIC_TOKEN';
const SKIP = new Set(['dist', 'scripts', 'api', 'node_modules', 'README.md', 'vercel.json', 'package.json', 'firestore.rules']);

if (existsSync('.env')) {
  for (const line of (await readFile('.env', 'utf8')).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const token = (process.env.MAPBOX_TOKEN || '').replace(/^﻿/, '').trim();
if (!/^pk\./.test(token) || token.includes('paste_your_token')) {
  console.error('MAPBOX_TOKEN is missing or is not a public token (it must start with pk.). Set it in .env or in Vercel.');
  process.exit(1);
}

await rm('dist', { recursive: true, force: true });
for (const name of await readdir('.')) {
  if (SKIP.has(name) || name.startsWith('.')) continue;
  await cp(name, `dist/${name}`, { recursive: true });
}

const html = await readFile('dist/index.html', 'utf8');
if (!html.includes(PLACEHOLDER)) { console.error('Token placeholder not found in index.html.'); process.exit(1); }

// Firebase is optional: without these, the app hides sign-in and shared prices.
const fb = {
  apiKey: process.env.FIREBASE_API_KEY, authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID, appId: process.env.FIREBASE_APP_ID,
};
const hasFb = Object.values(fb).every(v => v && v.trim());
const fbJson = hasFb ? JSON.stringify(Object.fromEntries(Object.entries(fb).map(([k, v]) => [k, v.replace(/^﻿/, '').trim()]))) : 'null';

await writeFile('dist/index.html', html.replace(PLACEHOLDER, token).replace('/*FIREBASE_CONFIG*/null', fbJson));
console.log(`Built dist/ with the Mapbox token${hasFb ? ' and Firebase config' : ' (no Firebase config: sign-in and prices are off)'}.`);
