// @ts-check
// E2E target resolution — WHICH server serves each deploy variant.
//
// WHY THIS FILE EXISTS. Every spec used to hardcode `http://localhost:876X` (40 literals
// over 30 files). That pinned the whole suite to the http-servers `playwright.config.js`
// starts, and starting a server is forbidden in a Claude Code session — so the suite could
// only ever be run by Mattieu, and it stayed red for four days because nobody could look at
// it. The URLs were the blocker, NOT the infrastructure: the dev nginx of
// `docker-compose.dev.yml` already serves the very same `deploy/` folders, permanently, over
// https, on four vhosts. `E2E_TARGET=nginx` points the suite at them and starts NOTHING.
//
// THE DEFAULT IS UNCHANGED. `.github/workflows/ci.yml` runs `npm run test:e2e` with no env
// var, and must keep starting its own servers on the same ports as before. `ports` is the
// reference target: it is the one whose headers, CORS and perf figures the assertions were
// written against (see the `nginx` caveat below).
//
// ⚠️ THE TWO TARGETS ARE NOT ISOMORPHIC. Under nginx: no `Access-Control-Allow-Origin: *`
// (http-server runs with `--cors`), `X-Frame-Options: DENY` + `Content-Security-Policy:
// frame-ancestors 'self'` are added, `Cache-Control: no-store`, HTTP/2, and an https origin.
// A test that asserts on headers, framing or timing may legitimately differ. A red seen only
// under nginx is a lead, not a verdict — re-check it on `ports` before calling it a bug.

/**
 * variant → URL, per target. The variant names are the vocabulary the specs use; the ports
 * are the ones `playwright.config.js` starts, the hosts the ones `docker/nginx.dev.conf`
 * serves. Both columns must stay in sync with those two files.
 *
 * ⚠️ `deploy-local` est SERVIE PAR NGINX ET DÉLIBÉRÉMENT ABSENTE D'ICI — ne pas « corriger »
 * l'asymétrie. C'est la variante de poste (`npm run build:deploy:local`), la seule à embarquer
 * le bootstrap dev porteur d'un jeton ; aucun spec ne la vise, et l'ajouter obligerait
 * `playwright.config.js` à démarrer un quatrième http-server pour une cible que personne
 * n'éprouve. Les specs qui ont besoin du jeton le lisent côté Node dans la source et appellent
 * `configure()` eux-mêmes (cf. `readDevConnector()` dans `30-sync-cycle.spec.js`) — c'est ce
 * qui les rend indépendantes de ce qui traîne sur le poste.
 */
const TARGETS = {
    ports: {
        core: "http://localhost:8766",
        full: "http://localhost:8768",
        coverage: "http://localhost:8769",
    },
    nginx: {
        core: "https://demo.geoleaf.local.test",
        full: "https://demo.full.geoleaf.local.test",
        coverage: "https://demo.coverage.geoleaf.local.test",
    },
};

const TARGET = process.env.E2E_TARGET || "ports";

// Fail loud on a typo. A silent fallback to `ports` would be the worst outcome available:
// `E2E_TARGET=ngnix` would quietly re-enable the webServer block and START FOUR SERVERS,
// which is the one thing this file exists to prevent.
if (!TARGETS[TARGET]) {
    throw new Error(
        `E2E_TARGET="${TARGET}" is not a known target — expected one of: ${Object.keys(TARGETS).join(", ")}`
    );
}

/** True when the suite runs against the persistent nginx vhosts (⇒ no server to start). */
const isNginxTarget = TARGET === "nginx";

/**
 * Resolves a deploy variant to its base URL for the active target.
 * @param {'core'|'full'|'coverage'} variant
 * @returns {string}
 */
function baseURL(variant) {
    const url = TARGETS[TARGET][variant];
    if (!url) {
        throw new Error(
            `Unknown deploy variant "${variant}" — expected one of: ${Object.keys(TARGETS[TARGET]).join(", ")}`
        );
    }
    return url;
}

/**
 * Chromium args for the active target. The `*.geoleaf.local.test` names resolve through the
 * Windows hosts file, which carries `demo.` and `demo.full.` but NOT
 * `demo.coverage.`. Mapping the whole wildcard to 127.0.0.1 removes the need to edit it —
 * a Windows-side action nobody can take from inside WSL.
 * Empty on the `ports` target: spread it unconditionally.
 */
const hostResolverArgs = isNginxTarget
    ? [
          "--host-resolver-rules=MAP *.geoleaf.local.test 127.0.0.1",
          // 🛑 REQUIRED TO REGISTER A SERVICE WORKER on these vhosts, and NOT interchangeable
          // with the context-level `ignoreHTTPSErrors: true`.
          //
          // That option covers navigation and page `fetch` — a `HEAD /sw-core.js` returns 200
          // with it — but NOT the fetch of the SERVICE WORKER SCRIPT. Chromium refuses the
          // registration outright: «An SSL certificate error occurred when fetching the
          // script». The dev certificate is locally issued, so the browser-level flag is the
          // only thing that gets a worker registered under `E2E_TARGET=nginx`.
          //
          // ⚠️ AND THE SYMPTOM LIES. `window.isSecureContext` returns `true` either way, so a
          // guard that predicts `register()` success from origin trustworthiness goes GREEN
          // while registration silently fails. Measured, both directions, by
          // `scripts/probe-sw-observability.mjs`: without this flag its Q1/Q3/Q4/Q5 all fail
          // and Q2 stays green.
          //
          // Empty on `ports`, which is plain http on localhost — a trustworthy origin with no
          // certificate to distrust. That asymmetry is exactly why the gap went unnoticed:
          // the reference target never needed it.
          "--ignore-certificate-errors",
      ]
    : [];

export { TARGETS, TARGET, isNginxTarget, baseURL, hostResolverArgs };
