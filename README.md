# Karga

Find gas stations near you, filter by brand, and see how far each one is.

## Before you deploy

1. **Mapbox token.** Put your public token (starts with `pk.`) in `.env` as `MAPBOX_TOKEN=pk...` and add the same `MAPBOX_TOKEN` variable in your Vercel project settings. `node scripts/build.mjs` writes it into `dist/index.html`; Vercel runs this automatically (see `vercel.json`).
2. **Domain.** Replace `https://karga.vercel.app` with your real domain in the 4 Open Graph and Twitter tags in `index.html`.
3. **Lock the token.** In your Mapbox account, open the token and add URL restrictions for your domain (and `http://localhost` for testing). Turn on billing alerts.

## Station data

The phone only ever gets the stations within 5 km of you (or of the map center if location is off), from `api/stations.js`. It loads once when the app opens and again only when you tap the refresh button on the map; moving the map never loads. Stations stay on the phone, but an area loaded more than 7 days ago loads again, and each load replaces that area's stations, so stations removed from the list also disappear from phones.

`api/stations.js` answers from `api/_stations.js`, a server-side copy of every gas station in the Philippines from OpenStreetMap. It is never sent to phones whole. The free OpenStreetMap (Overpass) servers often refuse requests from Vercel, so they aren't used at runtime. If `api/_stations.js` is missing, the function falls back to asking them live.

The copy updates itself: `.github/workflows/update-stations.yml` runs `scripts/fetch-stations.mjs` on GitHub at 2 AM Philippine time on the 1st of every month and commits the new files, and Vercel redeploys on the push. This needs the project in a GitHub repo connected to Vercel. To update right away, open the repo's **Actions** tab → **Update stations** → **Run workflow**, or run it yourself and redeploy:

```
node scripts/fetch-stations.mjs
```

If the new list has more than 10% fewer stations than the saved one, the script saves nothing (add `--force` to save anyway). A failed monthly run changes nothing; the app keeps last month's list.

It downloads the country in 54 tiles and retries tiles that fail, saving only when all succeed. Check the brand counts it prints: if Centrum or Cleanfuel numbers look low, those stations are missing or named differently in OpenStreetMap.

## Search (cities and towns)

Search only suggests cities and towns, from `api/towns.js` (which reads `api/_towns.js`). It ignores accents and dots (`las pinas` finds Las Piñas), knows the usual short forms (`Sta.`, `Sto.`, `Gen.`, `QC`, `CDO`, `GenSan`), and a province name (`Laguna`) lists that province's towns. `scripts/fetch-stations.mjs` builds that list from OpenStreetMap's `place=city|town` points with their province, and gives every station a town (`t`): the town its address names, or else the nearest town center within 30 km. OpenStreetMap's town boundaries are too incomplete in the Philippines to use directly. Picking a town turns on a town filter, so the map and the Nearby list show only that town's stations (`/api/stations?town=…`) until its chip's ✕ is tapped.

## Map style and 3D

The layers button on the map picks the map style: Simple (the default, follows Day/Night), Streets and Satellite (Mapbox Standard, with their own night lighting), or Terrain (green parks and hills). The 3D view switch tilts the map, raises hills and mountains, and shows 3D buildings when zoomed in; two fingers then turn and tilt the map. Both choices are saved on the phone. Switching styles doesn't count as a new Mapbox map load.

## Desktop layout and tips

The same page adapts to bigger screens: phones keep the one-column layout; from 768px wide the Nearby page splits into two columns, Settings into two balanced columns, and sheets become centered dialogs; from 1024px the bottom nav becomes a left sidebar beside the full-screen map. A guided tour shows the map's main buttons the first time the app opens, and a short one the first time a station card opens. Each shows once per device; Settings → Show tips again replays it.

## Opening hours

Stations carry OpenStreetMap's `opening_hours` when it's listed. The app shows "Open · closes 10 PM" style badges and has an "Open now" filter. Many stations don't list hours, so that filter only shows stations known to be open.

## Google sign-in and fuel prices (Firebase, optional)

Signing in is optional. Without it, everything works except sharing fuel prices. Signed-in people can share prices, and their pinned and added stations are saved to their account (`users/{uid}` in Firestore) so they appear on all their devices.

Prices are Firestore documents in `reports`, one per person per station per fuel. A station's price is the middle value of up to 5 reports from the last 30 days, so one wrong report can't move it much. People can tap "Still correct" to confirm a price. `firestore.rules` enforces who can write what.

Setup:

1. In the [Firebase console](https://console.firebase.google.com), create a project (the free Spark plan is enough).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
3. **Authentication → Settings → Authorized domains → Add domain:** `karga-han.vercel.app`.
4. **Build → Firestore Database → Create database** (production mode, a region near you such as `asia-southeast1`). Then open **Rules**, paste in `firestore.rules`, and **Publish**.
5. **Project settings → Your apps → Web (`</>`)** to register a web app, and copy its config.
6. Put these in `.env` and in the Vercel project's environment variables, then redeploy:

```
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_PROJECT_ID=your-project
FIREBASE_APP_ID=1:...:web:...
```

### Closed stations and admins

Signed-in people can tap "Report closed" on a station, or "New name or brand" when a station closed and reopened as a different one. Those are only reports (stored in `status` and `changes`); the station stays as it is. Only an admin can mark a station closed or open, or rename it (`decisions/<stationId>`, which can carry a new `name` and brand `b`). Admins get a "Reports to review" list in Settings with Rename, Mark closed and Dismiss buttons, and can change a station's name or brand from its card.

To make someone an admin: they sign in to the app once, then in the Firebase console copy their **User UID** from **Authentication → Users**, go to **Firestore Database → Data → Start collection**, name it `admins`, and add a document whose **Document ID** is that UID (any field, e.g. `name: "Fred"`). They become admin the next time they open the app. Delete the document to remove them.

The Firebase web config is public by design (it ends up in the page); `firestore.rules` is what protects the data. Without these variables, sign-in and prices stay hidden.

## Deploy on Vercel

Put all files in a GitHub repo and import it in Vercel, or run `vercel --prod` from this folder. Vercel runs `node scripts/build.mjs` and serves `dist/`. Location only works over HTTPS, which Vercel provides.

After deploying, paste your link into the Facebook Sharing Debugger (developers.facebook.com/tools/debug) and press "Scrape again" if Messenger shows an old preview.
