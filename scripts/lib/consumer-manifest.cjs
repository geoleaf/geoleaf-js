/*!
 * GeoLeaf — lecture des manifestes de consommation (contrat inverse).
 * © 2026 Mattieu Pottier — MIT
 *
 * ## Ce que ce module lit, et pourquoi il ne vit pas dans ce dépôt
 *
 * Un « manifeste de consommation » énumère ce qu'un intégrateur AVAL appelle sur
 * `window.GeoLeaf`. C'est le **contrat inverse** : les gates du dépôt tiennent que ce qui est
 * déclaré existe ; celle-ci tient que ce dont quelqu'un dépend n'a pas disparu. Neuf clés du
 * namespace sont parties parce qu'aucun lecteur du monorepo ne les lisait — le lecteur était
 * dehors.
 *
 * Le fichier lui-même **ne peut pas vivre ici** : il nomme un client, un contact et des chemins
 * de fichiers Odoo (décision ④ de `roadmap_contrat-inverse-api-publique.md`). Il vit chez le
 * consommateur, et ce module le trouve par le crochet `GEOLEAF_CONSUMERS`.
 *
 * ## Les trois issues, et pourquoi il n'y en a pas deux
 *
 *   ① `GEOLEAF_CONSUMERS` pointe un répertoire contenant ≥ 1 `*.consumer.json` lisible
 *      → `status: "read"`, la gate appelante conclut (exit 0 ou 1).
 *   ② le crochet est absent, ou le répertoire est absent/vide
 *      → `status: "skip"`, **exit 0**, avec le chemin essayé IMPRIMÉ et le motif nommé.
 *      C'est le cas du clone public, et c'est aussi le cas par défaut sur toute machine —
 *      voir « pourquoi aucun chemin par défaut » ci-dessous. Précédent du dépôt :
 *      `e2e/30-sync-cycle.spec.js` saute avec un motif nommé plutôt que de se taire.
 *   ③ un manifeste est présent mais **illisible**, porte une **clé inconnue**, ou déclare une
 *      **version antérieure au plancher** → **exit 2**, refus de conclure.
 *
 * ⚠️ **La troisième issue n'est pas du zèle, elle répond à un risque mesuré.** Le manifeste
 * v1.4.0 vit sur une branche NON FUSIONNÉE du dépôt `geoleaf-maintenance`. Son contenu sur le
 * disque suit donc la branche courante DE CE DÉPÔT-LÀ : quiconque y fait `git checkout main`
 * remet la v1.3.0 sous les pieds de cette gate, **qui sortirait verte en lisant un autre
 * fichier que celui contre lequel elle a été écrite**. C'est exactement la classe d'angle mort
 * que `probe-gate-visibility.cjs` traque — sauf qu'ici la cécité vient d'un dépôt tiers, où
 * aucune sonde d'ici ne peut aller. D'où deux dispositifs, et non un :
 *
 *   • `MIN_MANIFEST_VERSION` — un plancher de version. Une v1.3.0 lue par une gate écrite pour
 *     la v1.4.0 sort en **exit 2**, jamais en vert.
 *   • **la gate DIT ce qu'elle a lu** — chemin absolu, `consumer`, `manifest_version`, et les
 *     12 premiers caractères du sha256 du fichier. Un opérateur qui voit passer une empreinte
 *     inattendue le sait au lieu de le supposer.
 *
 * ## Pourquoi AUCUN chemin par défaut
 *
 * Un défaut du genre `../geoleaf-maintenance/ci` écrirait le nom d'un dépôt privé dans
 * `scripts/`, qui part **intégralement** dans le clone public au Sprint 9 de
 * `roadmap_passage-public-npm.md` — et il faudrait alors le retirer là, c'est-à-dire ajouter
 * une pièce à une bascule non réversible. Le crochet est donc l'**unique** entrée : sans lui,
 * on saute. Conséquence assumée et non un défaut : sur une machine de développement, cette
 * gate ne mord que si l'opérateur nomme le répertoire. Ce qui l'empêche de tout avaler est la
 * sonde (`probe-gate-visibility.cjs`), qui plante un manifeste de FIXTURE et exige de voir la
 * gate rougir dessus — elle ne prouve pas que le vrai manifeste est lu, elle prouve que la
 * gate **mord encore**.
 *
 * ## Ce que ce module REFUSE — c'est son cœur, comme pour `ts-decl-read.cjs`
 *
 * Aucune fonction ne rend jamais un résultat vide « par défaut ». Une gate qui compare deux
 * ensembles vides s'accorde parfaitement avec elle-même et ne prouve rien. Chaque cause
 * d'échec de LECTURE sort en **exit 2** (erreur d'outillage), jamais en 0 ni en 1 — la même
 * partition que `lib/ts-decl-read.cjs`, et pour la même raison.
 *
 * ⚠️ **Les clés préfixées `$` sont tolérées NOMMÉMENT, et cette ligne est load-bearing.** Le
 * manifeste porte `$comment` au premier niveau ET dans quatre sous-objets, plus `$changelog`
 * depuis la v1.4.0 (l'archive des formes d'avant, dont la tâche 1.2 tire ses fixtures). Un
 * lecteur qui refuse toute clé inconnue sortirait en **exit 2 sur son propre manifeste au
 * premier lancement** — le mode exact que la décision ⑥ de la roadmap veut éviter, à savoir
 * une gate rouge à la pose, dont on ajuste la liste au lieu de réparer le défaut.
 *
 * Usage : const cm = require("./lib/consumer-manifest.cjs");
 */
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const TAG = "CONSUMER-CONTRACT";

/** Le crochet, et le seul. Calqué sur `GEOLEAF_CI_WORKFLOW_DIR` (cf. `verify-ci-parity`). */
const ENV_HOOK = "GEOLEAF_CONSUMERS";

/** Suffixe reconnu dans le répertoire pointé. Un autre nom n'est pas lu — et n'est pas une erreur. */
const MANIFEST_SUFFIX = ".consumer.json";

/**
 * Plancher de version du manifeste.
 *
 * ⚠️ **Ce n'est pas un numéro décoratif.** Il vaut la version contre laquelle les codes CC-00
 * à CC-09 ont été écrits et éprouvés. Le relever fait partie du travail de qui change la forme
 * du manifeste ; l'abaisser est un geste qui appartient à Mattieu, jamais à un run autonome.
 *
 * Historique du besoin, pour que personne ne le prenne pour de la rigidité : la v1.3.0 portait
 * `dom_contract` en **chaînes nues**, sur lesquelles CC-08 ne peut pas s'exécuter — il lui faut
 * `{selector, owner, readBy}`. Sans plancher, lire une v1.3.0 aurait fait sortir CC-08 vert en
 * n'ayant rien vérifié.
 */
const MIN_MANIFEST_VERSION = "1.4.0";

/**
 * Clés de premier niveau connues du lecteur. Toute autre → exit 2.
 *
 * La liste est FERMÉE à dessein : c'est ce qui empêche un schéma de dériver en silence chez le
 * consommateur. Ajouter une clé au manifeste sans l'ajouter ici fait rougir la gate — ce qui
 * est le bon endroit pour s'en apercevoir, et non six mois plus tard sur une entrée que
 * personne n'a jamais vérifiée.
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
    "out_of_scope",
    "oracles",
    "sequence",
    "policy",
]);

/** Sous-clés connues de `required`. Même partition, même motif. */
const KNOWN_REQUIRED = new Set(["public", "private_tolerated", "events", "dom_contract"]);

/**
 * Les trois listes NÉGATIVES, au sens du cliquet CC-04/CC-05.
 *
 * Elles décrivent ce que l'aval NE peut PAS avoir, ou n'a plus. Elles ne peuvent que
 * **rétrécir** : une entrée n'en sort que quand le défaut qu'elle nomme est réparé.
 */
const NEGATIVE_LISTS = ["private_tolerated", "requested", "broken_since_v3"];

/** Une clé `$…` est de la MÉTADONNÉE, jamais de la donnée. Voir l'en-tête. */
const isMeta = (k) => k.charAt(0) === "$";

/**
 * Sortie d'outillage — jamais 0, jamais 1 : lire est un préalable, pas un verdict.
 *
 * ⚠️ **Le CODE est obligatoire, et c'est la sonde qui l'a exigé.** La première version
 * imprimait `ERROR [CONSUMER-CONTRACT]: …` sans code. L'assertion de `probe-gate-visibility.cjs`
 * qui éprouve le refus « clé de premier niveau inconnue » cherche `CC-00` — elle a donc
 * rapporté *« exit 2, mais CC-00 jamais nommé (rougit pour une autre raison) »*, ce qui était
 * littéralement vrai : rien ne permettait de distinguer CE refus d'un autre. Une aiguille
 * générique se fait satisfaire par une autre catégorie ; c'est écrit deux fois dans la sonde,
 * et ça s'est vérifié ici sur la gate qu'elle venait éprouver.
 */
function refuse(message, code = "CC-00") {
    console.error(`ERROR [${TAG}/${code}]: ${message}`);
    console.error("  La gate REFUSE de conclure — elle serait verte en n'ayant pas lu.");
    process.exit(2);
}

/** Compare deux versions `x.y.z`. Rend < 0, 0 ou > 0. Refuse une forme non conforme. */
function cmpVersion(a, b, whence) {
    const parse = (v) => {
        const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? ""));
        if (!m) refuse(`\`manifest_version\` illisible (\`${v}\`) dans ${whence} — attendu \`x.y.z\``);
        return [Number(m[1]), Number(m[2]), Number(m[3])];
    };
    const [a1, a2, a3] = parse(a);
    const [b1, b2, b3] = parse(b);
    return a1 - b1 || a2 - b2 || a3 - b3;
}

/**
 * Résout le répertoire de manifestes, ou dit pourquoi il saute.
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
 * Lit tous les manifestes du répertoire pointé.
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

        // ── Clés de premier niveau ─────────────────────────────────────────────────────
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
            refuse(`sous-clé(s) inconnue(s) de \`required\` dans ${name} : ${unknownReq.join(", ")}`);
        }

        // ── Plancher de version ────────────────────────────────────────────────────────
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
 * Imprime CE QUI A ÉTÉ LU. Appelée par la gate avant tout verdict.
 *
 * Une gate qui lit un fichier hors de son dépôt doit dire lequel : c'est la seule chose qui
 * distingue « vert parce que le contrat tient » de « vert parce que j'ai lu autre chose ».
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
 * Normalise une entrée de liste en `{ path, provider, source }`.
 *
 * Le manifeste porte des OBJETS depuis la v1.3.0 (`{path, provider, usedBy}`), mais
 * `requested` reste un tableau de chaînes nues et `broken_since_v3` un objet
 * `{chemin: motif}` : trois formes, une seule normalisation, pour que les codes CC ne
 * réimplémentent pas chacun la leur.
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
};
