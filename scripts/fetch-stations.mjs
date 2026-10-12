// Downloads every gas station in the Philippines from OpenStreetMap into api/_stations.js, and every
// city and town (with its province) into api/_towns.js. Each station gets the town it belongs to (`t`).
// The API functions answer from these files (only the stations someone asks for reach the phone),
// so the app doesn't depend on the free Overpass servers, which often refuse requests from Vercel.
// Run with Node 18 or newer:  node scripts/fetch-stations.mjs   then redeploy. Re-run about once a month.
import { writeFile } from 'node:fs/promises';
import { norm } from '../api/_norm.js';

// One query for the whole country times out on the public servers, so ask tile by tile.
// Each tile returns its fuel stations, then each city/town node followed by the province
// (admin_level 4) or, where there is none (Metro Manila), the region (admin_level 3) it is in.
const query = box => `[out:json][timeout:180];
area["ISO3166-1"="PH"][admin_level=2]->.ph;
(node["amenity"="fuel"](area.ph)(${box});way["amenity"="fuel"](area.ph)(${box}););
out center tags;
node["place"~"^(city|town)$"](area.ph)(${box})->.towns;
foreach.towns->.t(
  .t out;
  .t is_in->.a;
  area.a["boundary"="administrative"]["admin_level"~"^(3|4)$"];
  out tags;
);`;
const STEP = 2, TILES = [];
for (let s = 4; s < 22; s += STEP) for (let w = 116; w < 128; w += STEP) TILES.push(`${s},${w},${s + STEP},${w + STEP}`);

// Overpass servers reject anonymous or browser-looking clients, so identify the app.
// Every server is asked at once and the first good answer wins; they are often slow or busy.
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function ask(url, box, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Karga/1.0 (station list builder)' },
    body: 'data=' + encodeURIComponent(query(box)),
    signal: AbortSignal.any([signal, AbortSignal.timeout(200000)]),
  });
  if (!res.ok) throw new Error(res.status);
  const j = await res.json();
  if (j.remark && /runtime error|timed out/i.test(j.remark)) throw new Error(j.remark);
  return j.elements || [];
}
// A server missing the Philippines area data answers instantly with nothing, so an empty answer
// only counts when at least two servers agree (sea tiles really are empty everywhere). In the last
// retry round a single empty answer is accepted, and the tile is reported as unconfirmed.
let lastRound = false;
const unconfirmed = [];
async function fetchTile(box) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ctrl = new AbortController();
    let empties = 0;
    const tries = SERVERS.map(u => ask(u, box, ctrl.signal).then(els => {
      if (!els.length) { empties++; throw new Error('empty'); }
      return els;
    }));
    try { const els = await Promise.any(tries); ctrl.abort(); return els; }
    catch (e) {
      if (empties >= 2) return [];
      if (empties && lastRound) { unconfirmed.push(box); return []; }
      await sleep(5000 * (attempt + 1));
    }
  }
  return null;
}

// Splits a tile's answer into stations and towns.
function takeTile(els) {
  let town = null;
  for (const e of els) {
    if (e.type === 'area') { // province (4) or region (3) of the town just before it
      if (town) town[`lvl${e.tags.admin_level}`] ||= e.tags.name;
    } else if (e.tags && e.tags.place && e.type === 'node' && e.tags.name) {
      town = { id: 'n' + e.id, n: e.tags.name, k: e.tags.place, lat: +e.lat.toFixed(5), lon: +e.lon.toFixed(5) };
      towns.set(town.id, town);
    } else {
      town = null;
      const s = norm(e); if (s) byId.set(s.id, s);
    }
  }
}

console.log('Asking OpenStreetMap for gas stations, cities and towns in the Philippines. This takes a few minutes…');
const byId = new Map(), towns = new Map();
// Tiles that fail are tried again in later rounds, after the servers have had a rest.
let todo = TILES;
for (let round = 1; round <= 4 && todo.length; round++) {
  if (round > 1) { console.log(`\nRetrying ${todo.length} tile(s) in a minute (round ${round})…`); await sleep(60000); }
  lastRound = round === 4;
  const failed = [];
  for (const [i, box] of todo.entries()) {
    const els = await fetchTile(box);
    if (els === null) failed.push(box);
    else takeTile(els);
    process.stdout.write(`\rTiles done: ${i + 1}/${todo.length}, failed: ${failed.length}, stations: ${byId.size}, towns: ${towns.size}   `);
  }
  todo = failed;
}
console.log();
if (todo.length) { console.error(`${todo.length} tile(s) still failed: ${todo.join(' | ')}. Nothing saved. Try again later.`); process.exit(1); }
if (unconfirmed.length) console.warn(`Only one server answered these tiles, saying they're empty (normal for open sea): ${unconfirmed.join(' | ')}`);
const stations = [...byId.values()];

// Which town each station belongs to: the town its address names (if one by that name is within
// 40 km), otherwise the nearest city/town center within 30 km. OSM town boundaries are too
// incomplete in the Philippines to use directly.
function km(a, b) {
  const R = 6371, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const simple = n => n.toLowerCase().replace(/\b(city|municipality) of\b|\bcity\b/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();
const townList = [...towns.values()].map(t => ({ ...t, key: simple(t.n) }));
let byAddress = 0, byNearest = 0;
for (const s of stations) {
  const near = townList.map(t => [km(s, t), t]).filter(([d]) => d <= 40).sort((a, b) => a[0] - b[0]);
  const named = s._city && near.find(([, t]) => t.key === simple(s._city));
  const pick = named || (near[0] && near[0][0] <= 30 ? near[0] : null);
  if (pick) { s.t = pick[1].id; named ? byAddress++ : byNearest++; }
  delete s._city;
}
const perTown = {};
stations.forEach(s => { if (s.t) perTown[s.t] = (perTown[s.t] || 0) + 1; });
const townOut = townList.map(({ id, n, k, lat, lon, lvl4, lvl3 }) => ({ id, n, p: lvl4 || lvl3 || '', k, lat, lon, c: perTown[id] || 0 }))
  .sort((a, b) => a.n.localeCompare(b.n));

// Refuse to replace the saved list with a much smaller one: that means OpenStreetMap or the servers
// had a bad day, not that a tenth of the country's stations closed. Run with --force to save anyway.
let before = 0;
try { before = (await import('../api/_stations.js')).default.length; } catch (e) {}
if (before && stations.length < before * 0.9 && !process.argv.includes('--force')) {
  console.error(`Got ${stations.length} stations but the saved list has ${before}. Nothing saved. Re-run with --force if that's expected.`);
  process.exit(1);
}

const stamp = `// Generated by scripts/fetch-stations.mjs on ${new Date().toISOString().slice(0, 10)}. Do not edit by hand.\n`;
await writeFile(new URL('../api/_stations.js', import.meta.url), `${stamp}export default ${JSON.stringify(stations)};\n`);
await writeFile(new URL('../api/_towns.js', import.meta.url), `${stamp}export default ${JSON.stringify(townOut)};\n`);

const count = {};
stations.forEach(s => (count[s.b] = (count[s.b] || 0) + 1));
console.log(`Saved ${stations.length} stations to api/_stations.js`);
console.log(`Saved ${townOut.length} cities and towns to api/_towns.js (${townOut.filter(t => !t.p).length} without a province)`);
console.log(`Stations matched to a town: ${byAddress} by address, ${byNearest} by nearest town, ${stations.length - byAddress - byNearest} not matched`);
console.table(count);
