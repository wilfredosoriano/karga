// GET /api/towns?q=sis&lat=16.1&lon=120.5 → up to 8 cities and towns whose name matches q.
// Names starting with q come first, then closer ones (when lat/lon is given), then bigger places.
// Answers from api/_towns.js, built by scripts/fetch-stations.mjs.
let TOWNS = [];
try { TOWNS = (await import('./_towns.js')).default; } catch (e) {}
const KEY = TOWNS.map(t => t.n.toLowerCase());

function km(a, b) {
  const R = 6371, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function handler(req, res) {
  const q = String(req.query.q || '').toLowerCase().trim();
  if (q.length < 2) return res.status(400).json({ error: 'q must be at least 2 letters' });
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  const at = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;

  const hits = [];
  for (let i = 0; i < TOWNS.length; i++) {
    const k = KEY[i], start = k.startsWith(q) || k.includes(' ' + q);
    if (start || k.includes(q)) hits.push({ t: TOWNS[i], start });
  }
  hits.sort((a, b) => (b.start - a.start) || (at ? km(at, a.t) - km(at, b.t) : 0) || (b.t.c - a.t.c));
  res.setHeader('Cache-Control', at ? 'no-store' : 'public, s-maxage=86400');
  return res.status(200).json({ towns: hits.slice(0, 8).map(h => h.t) });
}
