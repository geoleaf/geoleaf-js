/**
 * GeoLeaf — Connector bootstrap (DEV template, committed WITHOUT any token).
 *
 * Copy this file to `connector.local.js` (git-ignored) and fill in your dev JWT to
 * test authenticated reads (private features) and `editor` writes against a backend
 * that requires a Bearer token — the dev PostGIS/PostgREST stack of
 * `docker-compose.dev.yml`.
 * ⚠️ Said "addpoi / editor" until 09/08/2026; `addpoi` was merged into `editor` on 05/08/2026.
 *
 * `init.js` dynamically imports `connector.local.js` (if present) BEFORE GeoLeaf.boot()
 * and calls `GeoLeaf.Connector.configure(window.GEOLEAF_DEV_CONNECTOR)`. The Connector
 * plugin then injects `Authorization: Bearer <token>` on every request to `baseUrl`
 * (reads via the GeoJSON loader and writes via the editor alike).
 *
 * ## Where the filled-in file may be served from — and where it may NOT
 *
 * ONE variant carries it: `deploy-local`, built on demand by `npm run build:deploy:local`
 * and never shipped. The deliverable variants (`deploy-core`, `deploy-full`) always get an
 * inert stub instead, whether or not you have this file on your machine.
 *
 * 🛑 That is a BUILD guarantee, not a matter of discipline, and it was added on 09/08/2026
 * because discipline had not been enough: `build-deploy.cjs` used to copy the real file into
 * every variant, so a live `geoleaf_editor` JWT sat at the root of what ships to a client —
 * plus in its `.gz`/`.br`. The `localhost` guard in `init.js` did not prevent that: it stops
 * the bootstrap from RUNNING on a deployed origin, and a secret is READ, not run.
 * `scripts/verify-deploy-no-secrets.cjs` now holds the invariant.
 *
 * ⚠️ DEV ONLY — never commit a real token. In production, use a real login flow
 *    (Connector `auth.endpoint`) that issues the token to the authenticated user:
 *    nothing a browser downloads can hold a secret, whatever the filename.
 */
window.GEOLEAF_DEV_CONNECTOR = {
    // Placeholder host. Point it at YOUR backend — the one `docker-compose.dev.yml`
    // routes for you, named by `GEOLEAF_DEV_BACKEND_HOST` (see docker/backend/README.md).
    // Left as-is, requests go to a reserved documentation domain and resolve nowhere.
    baseUrl: "https://ogc.example.org",
    // Called on every intercepted request to `baseUrl`. Return null to skip injection.
    getToken: async () => "PASTE_YOUR_DEV_JWT_HERE",
};
