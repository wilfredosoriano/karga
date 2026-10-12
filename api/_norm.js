// Turns an OpenStreetMap fuel station into Karga's station shape. Shared by
// scripts/fetch-stations.mjs and api/stations.js. Brand keys must match BRANDS in index.html.
// Order matters: the first brand whose pattern matches the station's brand, name or operator wins.
export const BRANDS = [
  ['petron', 'Petron', /petron/], ['shell', 'Shell', /\bshell\b/], ['caltex', 'Caltex', /caltex/],
  ['seaoil', 'Seaoil', /sea\s*oil/], ['phoenix', 'Phoenix', /phoenix/], ['flyingv', 'Flying V', /flying\s*v\b/],
  ['total', 'TotalEnergies', /\btotal(\s*energies)?\b/], ['jetti', 'Jetti', /jetti/], ['ptt', 'PTT', /\bptt\b/],
  ['unioil', 'Unioil', /unioil/], ['centrum', 'Centrum', /centrum/], ['cleanfuel', 'Cleanfuel', /clean\s*fuel/],
];

export function norm(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  // The brand tag wins; the name and operator are only used when it doesn't name a known brand.
  const tag = `${t.brand || ''} ${t['brand:en'] || ''}`.toLowerCase();
  const txt = `${tag} ${t.name || ''} ${t.operator || ''}`.toLowerCase();
  const hit = BRANDS.find(([, , re]) => re.test(tag)) || BRANDS.find(([, , re]) => re.test(txt));
  const b = hit ? hit[0] : 'other';
  const bn = hit ? hit[1] : (t.brand || t.operator || 'Gas station');
  const addr = [[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:city'] || t['addr:municipality']].filter(Boolean).join(', ');
  const s = { id: el.type[0] + el.id, lat: +lat.toFixed(6), lon: +lon.toFixed(6), b, bn, name: t.name || bn, addr };
  if (t.opening_hours) s.h = t.opening_hours; // raw OSM opening_hours, read by the app
  const city = t['addr:city'] || t['addr:municipality'] || t['addr:town'];
  if (city) s._city = city; // only used by scripts/fetch-stations.mjs to pick the station's town, then removed
  return s;
}
