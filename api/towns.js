// GET /api/towns?q=sis&lat=16.1&lon=120.5 → up to 8 cities and towns whose name matches q.
// Exact names come first, then names starting with q, then names containing it, then towns in a
// province whose name starts with q ("laguna" lists Laguna's towns). Ties go to closer places
// (when lat/lon is given), then bigger ones. Matching ignores accents and dots ("las pinas" finds
// Las Piñas) and knows the usual short forms ("sta rosa", "gen trias", "qc").
// Answers from api/_towns.js, built by scripts/fetch-stations.mjs.
let TOWNS = [];
try { TOWNS = (await import('./_towns.js')).default; } catch (e) {}

// Short forms, by whole word. Applied to both the query and the names.
const SHORT = { sta: 'santa', sto: 'santo', sn: 'san', gen: 'general', pres: 'presidente', mt: 'mount', ft: 'fort' };
const WHOLE = { qc: 'quezon city', cdo: 'cagayan de oro', gensan: 'general santos', mnl: 'manila' };
const simple = s => {
  const t = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return WHOLE[t] || t.split(' ').map(w => SHORT[w] || w).join(' ');
};
// "Lipa city" should find Lipa, and "Cebu" should find Cebu City.
const noCity = s => s.replace(/\bcity of\b|\bcity\b/g, ' ').replace(/\s+/g, ' ').trim();
const KEYS = TOWNS.map(t => { const n = simple(t.n); return { n, bare: noCity(n), p: simple(t.p || '') }; });

function km(a, b) {
  const R = 6371, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function score(k, q, bare) {
  if (k.n === q) return 5;
  if (bare && k.bare === bare) return 4;
  if (k.n.startsWith(q) || k.n.includes(' ' + q) || (bare && k.bare.startsWith(bare))) return 3;
  if (k.n.includes(q)) return 2;
  if (q.length >= 3 && (k.p.startsWith(q) || k.p.includes(' ' + q))) return 1;
  return 0;
}

export default function handler(req, res) {
  const q = simple(String(req.query.q || ''));
  if (q.length < 2) return res.status(400).json({ error: 'q must be at least 2 letters' });
  const bare = noCity(q);
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  const at = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;

  const hits = [];
  for (let i = 0; i < TOWNS.length; i++) {
    const s = score(KEYS[i], q, bare);
    if (s) hits.push({ t: TOWNS[i], s });
  }
  hits.sort((a, b) => (b.s - a.s) || (at ? km(at, a.t) - km(at, b.t) : 0) || (b.t.c - a.t.c));
  res.setHeader('Cache-Control', at ? 'no-store' : 'public, s-maxage=86400');
  return res.status(200).json({ towns: hits.slice(0, 8).map(h => h.t) });
}
