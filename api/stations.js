// GET /api/stations?lat=14.60&lon=120.98 → gas stations within RADIUS_M of that point.
// Answers from api/_stations.js (every station in the Philippines, built by scripts/fetch-stations.mjs),
// so only nearby stations reach the phone and the free Overpass servers aren't needed at runtime.
// If that file is missing, it falls back to asking Overpass live.
import { norm } from './_norm.js';

const RADIUS_M = 5000;
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

let ALL = null;
try { ALL = (await import('./_stations.js')).default; } catch (e) {}

function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default async function handler(req, res) {
  // GET /api/stations?ids=w123,n456 → those stations (used by the admin review list).
  if (req.query.ids && ALL) {
    const want = new Set(String(req.query.ids).split(',').slice(0, 100));
    res.setHeader('Cache-Control', 'public, s-maxage=86400');
    return res.status(200).json({ stations: ALL.filter(s => want.has(s.id)) });
  }
  // GET /api/stations?town=n123 → every station that belongs to that city or town (see /api/towns).
  if (req.query.town && ALL) {
    const t = String(req.query.town);
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ stations: ALL.filter(x => x.t === t) });
  }
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }
  const at = { lat: +lat.toFixed(2), lon: +lon.toFixed(2) };

  if (ALL) {
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ stations: ALL.filter(s => km(at, s) <= RADIUS_M / 1000) });
  }

  // Fallback: ask every Overpass server at once and use the first good answer.
  const q = `[out:json][timeout:25];(node["amenity"="fuel"](around:${RADIUS_M},${at.lat},${at.lon});way["amenity"="fuel"](around:${RADIUS_M},${at.lat},${at.lon}););out center tags;`;
  const ctrl = new AbortController();
  const ask = async url => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Karga/1.0 (https://karga-han.vercel.app)' },
      body: 'data=' + encodeURIComponent(q),
      signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(25000)]),
    });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    if (j.remark && /runtime error|timed out/i.test(j.remark)) throw new Error(j.remark);
    return j.elements || [];
  };
  try {
    const elements = await Promise.any(SERVERS.map(ask));
    ctrl.abort();
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ stations: elements.map(norm).filter(Boolean).map(({ _city, ...s }) => s) });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'OpenStreetMap servers are busy. Try again in a minute.' });
  }
}
