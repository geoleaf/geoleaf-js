/*!
 * GeoLeaf — consumer manifest reader (the reverse contract).
 * © 2026 Mattieu Pottier — MIT
 *
 * ## What this module reads, and why it does not live in this repo
 *
 * A "consumer manifest" enumerates what a DOWNSTREAM integrator calls on
 * `window.GeoLeaf`. It is the **reverse contract**: the repo's gates hold that what is
 * declared exists; this one holds that what someone depends on has not disappeared. Nine
 * namespace keys left because no reader in the monorepo read them — the reader was outside.
 *
 * The file itself **cannot live here**: it names a client, a contact and file paths that
 * belong to the downstream side (arbitrated decision). It lives with the consumer, and this
 * module finds it through the `GEOLEAF_CONSUMERS` hook.
 *
 * ## The three outcomes, and why there are not two
 *
 *   ① `GEOLEAF_CONSUMERS` points at a directory holding ≥ 1 readable `*.consumer.json`
 *      → `status: "read"`, the calling gate concludes (exit 0 or 1).
 *   ② the hook is absent, or the directory is absent/empty
 *      → `status: "skip"`, **exit 0**, with the attempted path PRINTED and the reason named.
 *      That is the public clone's case, and also the default on any machine — see "why NO
 *      default path" below. Repo precedent: `e2e/30-sync-cycle.spec.js` skips with a named
 *      reason rather than staying silent.
 *   ③ a manifest is present but **unreadable**, carries an **unknown key**, or declares a
 *      **version below the floor** → **exit 2**, refusal to conclude.
 *
 * ⚠️ **The third outcome is not zeal, it answers a measured risk.** The v1.4.0 manifest
 * lives on an UNMERGED branch of the `geoleaf-maintenance` repo. Its on-disk content thus
 * follows THAT repo's current branch: anyone running `git checkout main` there puts v1.3.0
 * back under this gate's feet, **which would go green reading a different file than the one
 * it was written against**. That is exactly the blind-spot class `probe-gate-visibility.cjs`
 * hunts — except here the blindness comes from a third-party repo, where no probe of ours
 * can go. Hence two devices, not one:
 *
 *   • `MIN_MANIFEST_VERSION` — a version floor. A v1.3.0 read by a gate written for v1.4.0
 *     exits **2**, never green.
 *   • **the gate SAYS what it read** — absolute path, `consumer`, `manifest_version`, and
 *     the first 12 characters of the file's sha256. An operator who sees an unexpected
 *     fingerprint go by knows it instead of assuming it.
 *
 * ## Why NO default path
 *
 * A default like `../geoleaf-maintenance/ci` would write the name of a private repo into
 * `scripts/`, which ships **in full** to the public clone with the public split — and it
 * would then have to be stripped there, i.e. one more moving part on a non-reversible
 * switch. The hook is therefore the **only** entrance: without it, we skip. An accepted
 * consequence, not a defect: on a development machine this gate only bites if the operator
 * names the directory. What keeps it from swallowing everything is the probe
 * (`probe-gate-visibility.cjs`), which plants a FIXTURE manifest and demands to see the
 * gate go red on it — it does not prove the real manifest is read, it proves the gate
 * **still bites**.
 *
 * ## What this module REFUSES — its core, as for `ts-decl-read.cjs`
 *
 * No function ever returns an empty result "by default". A gate comparing two empty sets
 * agrees perfectly with itself and proves nothing. Every READ failure cause exits **2**
 * (tooling error), never 0 nor 1 — the same partition as `lib/ts-decl-read.cjs`, and for
 * the same reason.
 *
 * ⚠️ **`$`-prefixed keys are tolerated BY NAME, and this line is load-bearing.** The
 * manifest carries `$comment` at top level AND in four sub-objects, plus `$changelog` since
 * v1.4.0 (the archive of past shapes, which feeds the reader's own test fixtures). A reader
 * refusing every unknown key would exit **2 on its own manifest at first launch** — the
 * exact failure mode this gate's design set out to avoid: a gate born red, whose list gets
 * adjusted instead of the defect getting fixed.
 *
 * Usage : const cm = require("./lib/consumer-manifest.cjs");
 */
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const TAG = "CONSUMER-CONTRACT";

/** The hook, and the only one. Modelled on `GEOLEAF_CI_WORKFLOW_DIR` (cf. `verify-ci-parity`). */
const ENV_HOOK = "GEOLEAF_CONSUMERS";

/** Suffix recognized in the pointed directory. Another name is not read — and is not an error. */
const MANIFEST_SUFFIX = ".consumer.json";

/**
 * Version floor of the manifest.
 *
 * ⚠️ **This is not a decorative number.** It equals the version the CC-00 to CC-09 codes
 * were written and proven against. Raising it is part of the work of whoever changes the
 * manifest's shape; lowering it is a move that belongs to Mattieu, never to an autonomous
 * run.
 *
 * History of the need, so nobody mistakes it for rigidity: v1.3.0 carried `dom_contract` as
 * **bare strings**, on which CC-08 cannot run — it needs `{selector, owner, readBy}`.
 * Without a floor, reading a v1.3.0 would have let CC-08 go green having verified nothing.
 */
const MIN_MANIFEST_VERSION = "1.4.0";

/**
 * Top-level keys known to the reader. Any other → exit 2.
 *
 * The list is CLOSED on purpose: that is what keeps a schema from drifting silently on the
 * consumer's side. Adding a key to the manifest without adding it here makes the gate go
 * red — which is the right place to notice, not six months later on an entry nobody ever
 * verified.
 */
const KNOWN_TOP_LEVEL = new Set([
    "consumer",
    "manifest_version",
    "repos",
    "contact",
    "upstream",
    "required",
    "not_required",
    "requested",
    "requested_events",
    "withdrawn",
    "broken_since_v3",
    // What the host WRITES onto the namespace, as opposed to everything else, which it
    // READS. Entered in v1.7.0 of the downstream manifest. Guarded by CC-11: a path the
    // downstream writes must NOT resolve here, otherwise two writers fight over one key
    // and the winner depends on boot order. Declaring it without giving it a code would
    // have satisfied the letter of the CC-00 refusal while missing its reason.
    "installed_by_host",
    "out_of_scope",
    "oracles",
    "sequence",
    "policy",
]);

/** Known sub-keys of `required`. Same partition, same rationale. */
const KNOWN_REQUIRED = new Set(["public", "private_tolerated", "events", "dom_contract"]);

/**
 * The three NEGATIVE lists, in the CC-04/CC-05 ratchet sense.
 *
 * They describe what the downstream CANNOT have, or no longer has. They can only
 * **shrink**: an entry only leaves when the defect it names is fixed.
 */
const NEGATIVE_LISTS = ["private_tolerated", "requested", "broken_since_v3"];

/** A `$…` key is METADATA, never data. See the header. */
const isMeta = (k) => k.charAt(0) === "$";

/**
 * Tooling exit — never 0, never 1: reading is a precondition, not a verdict.
 *
 * ⚠️ **The CODE is mandatory, and the probe is what demanded it.** The first version
 * printed `ERROR [CONSUMER-CONTRACT]: …` with no code. The `probe-gate-visibility.cjs`
 * assertion that exercises the "unknown top-level key" refusal looks for `CC-00` — so it
 * reported *"exit 2, but CC-00 never named (reddens for another reason)"*, which was
 * literally true: nothing distinguished THIS refusal from any other. A generic needle gets
 * satisfied by another category; that is written twice in the probe, and it proved itself
 * here on the very gate it came to exercise.
 */
function refuse(message, code = "CC-00") {
    console.error(`ERROR [${TAG}/${code}]: ${message}`);
    console.error("  La gate REFUSE de conclure — elle serait verte en n'ayant pas lu.");
    process.exit(2);
}

/** Compares two `x.y.z` versions. Returns < 0, 0 or > 0. Refuses a non-conforming shape. */
function cmpVersion(a, b, whence) {
    const parse = (v) => {
        const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? ""));
        if (!m)
            refuse(`\`manifest_version\` illisible (\`${v}\`) dans ${whence} — attendu \`x.y.z\``);
        return [Number(m[1]), Number(m[2]), Number(m[3])];
    };
    const [a1, a2, a3] = parse(a);
    const [b1, b2, b3] = parse(b);
    return a1 - b1 || a2 - b2 || a3 - b3;
}

/**
 * Resolves the manifest directory, or says why it skips.
 *
 * @returns {{ ok: true, dir: string } | { ok: false, tried: string|null, why: string }}
 */
function resolveDir() {
    const raw = process.env[ENV_HOOK];
    if (!raw || raw.trim() === "") {
        return {
            ok: false,
            tried: null,
            why: `le crochet \`${ENV_HOOK}\` n'est pas défini — aucun consommateur déclaré`,
        };
    }
    const dir = path.resolve(raw);
    if (!fs.existsSync(dir)) {
        return { ok: false, tried: dir, why: "le répertoire n'existe pas" };
    }
    if (!fs.statSync(dir).isDirectory()) {
        return { ok: false, tried: dir, why: "le chemin existe mais n'est pas un répertoire" };
    }
    return { ok: true, dir };
}

/**
 * Reads every manifest in the pointed directory.
 *
 * @returns {{ status: "skip", tried: string|null, why: string }
 *          |{ status: "read", dir: string, manifests: Array<{
 *               file: string, rel: string, sha: string, version: string,
 *               consumer: string, data: object }> }}
 */
function readConsumers() {
    const r = resolveDir();
    if (!r.ok) return { status: "skip", tried: r.tried, why: r.why };

    const names = fs
        .readdirSync(r.dir)
        .filter((n) => n.endsWith(MANIFEST_SUFFIX))
        .sort();

    if (names.length === 0) {
        return {
            status: "skip",
            tried: r.dir,
            why: `le répertoire ne contient aucun \`*${MANIFEST_SUFFIX}\``,
        };
    }

    const manifests = names.map((name) => {
        const file = path.join(r.dir, name);
        let text;
        try {
            text = fs.readFileSync(file, "utf8");
        } catch (err) {
            refuse(`manifeste illisible — ${file} (${err.message})`);
        }
        let data;
        try {
            data = JSON.parse(text);
        } catch (err) {
            refuse(`manifeste au JSON invalide — ${file} : ${err.message}`);
        }
        if (data === null || typeof data !== "object" || Array.isArray(data)) {
            refuse(`manifeste dont la racine n'est pas un objet — ${file}`);
        }

        // ── Top-level keys ─────────────────────────────────────────────────────────────
        const unknown = Object.keys(data).filter((k) => !isMeta(k) && !KNOWN_TOP_LEVEL.has(k));
        if (unknown.length > 0) {
            refuse(
                `clé(s) de premier niveau inconnue(s) dans ${name} : ${unknown.join(", ")}. ` +
                    "Une clé que ce lecteur ne connaît pas est une clé qu'aucun code CC ne " +
                    "vérifie — la laisser passer rendrait la gate verte sur une partie du " +
                    "contrat qu'elle n'a jamais lue. Déclarez-la dans `KNOWN_TOP_LEVEL` et " +
                    "donnez-lui un code, ou renommez-la `$…` si c'est de la métadonnée."
            );
        }
        const req = data.required;
        if (req === undefined || req === null || typeof req !== "object" || Array.isArray(req)) {
            refuse(`\`required\` absent ou non-objet dans ${name}`);
        }
        const unknownReq = Object.keys(req).filter((k) => !isMeta(k) && !KNOWN_REQUIRED.has(k));
        if (unknownReq.length > 0) {
            refuse(
                `sous-clé(s) inconnue(s) de \`required\` dans ${name} : ${unknownReq.join(", ")}`
            );
        }

        // ── Version floor ──────────────────────────────────────────────────────────────
        const version = String(data.manifest_version ?? "");
        if (cmpVersion(version, MIN_MANIFEST_VERSION, name) < 0) {
            refuse(
                `${name} déclare \`manifest_version\` ${version}, sous le plancher ` +
                    `${MIN_MANIFEST_VERSION}. **Le fichier lu n'est pas celui contre lequel ` +
                    "cette gate a été écrite.** Ce n'est presque jamais une régression du " +
                    "manifeste : c'est le dépôt du consommateur qui a changé de branche sous " +
                    "les pieds de la gate. Vérifiez-y `git branch --show-current` avant toute " +
                    "autre hypothèse."
            );
        }

        return {
            file,
            rel: name,
            sha: crypto.createHash("sha256").update(text).digest("hex").slice(0, 12),
            version,
            consumer: String(data.consumer ?? "(sans nom)"),
            data,
        };
    });

    return { status: "read", dir: r.dir, manifests };
}

/**
 * Prints WHAT WAS READ. Called by the gate before any verdict.
 *
 * A gate that reads a file outside its repo must say which one: that is the only thing that
 * separates "green because the contract holds" from "green because I read something else".
 */
function describe(read) {
    if (read.status === "skip") {
        console.log(`⏭️  [${TAG}/CC-00] SAUTÉ — ${read.why}.`);
        console.log(`    chemin essayé : ${read.tried ?? `(aucun — \`${ENV_HOOK}\` non défini)`}`);
        console.log(
            `    Ce n'est pas un vert du contrat : aucun consommateur n'a été lu. Sur un clone\n` +
                `    public c'est le comportement attendu (décision ④). Ailleurs, exportez\n` +
                `    ${ENV_HOOK}=<répertoire contenant *${MANIFEST_SUFFIX}>.`
        );
        return;
    }
    console.log(`📄 [${TAG}] ${read.manifests.length} manifeste(s) lu(s) dans ${read.dir} :`);
    for (const m of read.manifests) {
        console.log(`    ${m.rel} — consumer=${m.consumer} v${m.version} sha256:${m.sha}`);
    }
}

/**
 * Opaque, stable identity for a consumer, for use as a KEY inside the baseline.
 *
 * ## Why the name does not enter the repo (26/08/2026)
 *
 * The manifest's `consumer` field is the downstream project's own name, and a project name
 * routinely carries the name of the business backend it runs on. This repo's golden rule is
 * that **no backend and no integrator is named anywhere**, and `public-partition.cjs` classes
 * `scripts/.baselines/` as NON-internal: whatever lands there is published.
 *
 * The digest keeps every property the baseline actually needs — it is stable, it distinguishes
 * two consumers, and it survives a regeneration — while carrying no name at all. It is not a
 * secret and does not pretend to be one: it is an identity that happens not to spell anything.
 *
 * ⚠️ The console still prints the real name (`describe()`): an operator must know which file
 * was read. Runtime output is not the corpus; the baseline is.
 *
 * @param {string} name Consumer name as declared by the manifest.
 * @returns {string} `consumer-<12 hex>` — stable across runs and machines.
 *
 * @example
 * consumerKey("acme-widgets"); // → "consumer-1f0c…"
 */
function consumerKey(name) {
    const text = String(name);
    // IDEMPOTENT, and this is load-bearing rather than tidy. `probe-gate-visibility.cjs` builds
    // its CC-10 fixture with `consumer: baseline._consumer` — an already-opaque identity, since
    // that is all the baseline carries. Hashing it a second time yields a key matching no
    // `positives` entry, so CC-10 stopped biting and the gate came out GREEN ON A MUTATED
    // FIXTURE. Measured the day this function was written: the probe caught it, and nothing
    // else in the repo would have.
    if (/^consumer-[0-9a-f]{12}$/.test(text)) return text;
    return "consumer-" + crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/**
 * Identity of a ratchet entry, safe to write into the baseline.
 *
 * ## The class this closes, and why it is not "redact the forbidden word"
 *
 * `requested` is an array of FREE PROSE written upstream, and the ratchet stores each entry
 * verbatim so it can tell a new entry from a known one. That copied whatever the prose
 * happened to contain — which is how a backend name reached a published file.
 *
 * Matching a list of forbidden words would only close the instance: the next import brings the
 * next word. What closes the CLASS is refusing to copy free prose at all. A short entry that
 * looks like an API path is kept verbatim — it IS the identity, and a reader needs to see it.
 * Anything longer is reduced to its leading token plus a digest of the whole: the ratchet keeps
 * exact identity (any edit upstream changes the digest, so the entry reads as new, which is the
 * intended behaviour), and the repo keeps no sentence it did not write.
 *
 * @param {string} entry Raw list entry as read from the manifest.
 * @returns {string} The entry itself when it is a bare identifier, else `<lead> …#<12 hex>`.
 *
 * @example
 * ratchetKey("POI.Config.init");            // → "POI.Config.init"  (unchanged)
 * ratchetKey("boot(): accept a config …");  // → "boot() …#9a1c…"
 */
function ratchetKey(entry) {
    const text = String(entry);
    // A bare identifier: no whitespace and short enough to be a member path, never a sentence.
    if (!/\s/.test(text) && text.length <= 80) return text;
    const digest = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
    const lead = (text.split(/[:(\n]/, 1)[0] || text).trim().slice(0, 48);
    return `${lead} …#${digest}`;
}

/**
 * Normalizes a list entry into `{ path, provider, source }`.
 *
 * The manifest carries OBJECTS since v1.3.0 (`{path, provider, usedBy}`), but `requested`
 * remains an array of bare strings and `broken_since_v3` an object of `{path: reason}`:
 * three shapes, one normalization, so the CC codes do not each reimplement their own.
 */
function entriesOf(value, listName) {
    if (Array.isArray(value)) {
        return value.map((e) => {
            if (typeof e === "string") return { path: e, provider: "core", source: listName };
            if (e && typeof e === "object" && typeof e.path === "string") {
                return { path: e.path, provider: e.provider ?? "core", source: listName, raw: e };
            }
            if (e && typeof e === "object" && typeof e.name === "string") {
                return { path: e.name, provider: e.provider ?? "core", source: listName, raw: e };
            }
            refuse(`entrée non normalisable dans \`${listName}\` : ${JSON.stringify(e)}`);
            return null;
        });
    }
    if (value && typeof value === "object") {
        return Object.keys(value)
            .filter((k) => !isMeta(k))
            .map((k) => ({ path: k, provider: "core", source: listName, motif: value[k] }));
    }
    return [];
}

module.exports = {
    TAG,
    ENV_HOOK,
    MANIFEST_SUFFIX,
    MIN_MANIFEST_VERSION,
    KNOWN_TOP_LEVEL,
    KNOWN_REQUIRED,
    NEGATIVE_LISTS,
    isMeta,
    refuse,
    cmpVersion,
    readConsumers,
    describe,
    entriesOf,
    consumerKey,
    ratchetKey,
};
