/**
 * Guard TLA — les 11 méthodes de haut niveau ont UN SEUL écrivain, et elles sont DÉTACHABLES.
 *
 * ## Le défaut que cette garde ferme (socle-init 7.7, « doublon B11 »)
 *
 * `globalThis.GeoLeaf` n'est pas construit d'un coup : plusieurs modules y accrochent leurs
 * morceaux à l'import. Les onze méthodes de `GeoLeafTopLevelApi` l'étaient par **deux** modules à
 * la fois — `globals/globals.api.ts` via `defineApiMethods()`, et `kernel/api/geoleaf-api.ts` via
 * un `Object.assign`. Le dernier évalué gagnait, et les deux formes n'étaient **pas équivalentes**.
 * Le prix a déjà été payé deux fois, en production :
 *
 *   - `get BaseLayers()` posé dans le littéral d'`Object.assign` écrasait par `undefined` l'alias
 *     que `globals.api.ts` venait de poser — `Object.assign` INVOQUE le getter de la source ;
 *   - `getMetrics() { return this.getHealth(); }` marchait attaché et jetait détaché.
 *
 * ⚠️ **Aucune gate ne pouvait les voir : elles comparent des NOMS, et le nom existait bien.**
 * D'où les deux assertions ci-dessous, qui ne portent ni sur des noms ni sur des types.
 *
 * ## TLA-01 — écrivain unique, à l'AST, sur le disque
 *
 * 🛑 **Pas au grep, et le motif est mesuré.** Un `grep 'X.getMetrics ='` sur tout `src/` rend
 * exactement UN résultat par nom — celui de `globals.api.ts` — parce que le second écrivain est un
 * **littéral d'objet** (`getMetrics: readHealthStatus,`). L'instrument naïf est aveugle à la forme
 * même du doublon : il aurait certifié « un seul écrivain » pendant qu'il y en avait deux.
 *
 * 🛑 **Pas à l'import instrumenté non plus.** Un `Proxy` sur le namespace mesurerait ce que la
 * chaîne d'import du TEST charge, pas ce que le dépôt contient — et sous Vitest `geoleaf-api.ts`
 * n'est presque jamais dans cette chaîne. La garde serait verte quel que soit l'état du fichier.
 *
 * Donc : `ts.createSourceFile` sur tout `src/**\/*.ts`, trois formes d'écriture reconnues
 * (affectation de membre, littéral d'`Object.assign`, `Object.defineProperty`), et les
 * identifiants qui désignent le namespace **dérivés par fichier**, jamais écrits à la main.
 *
 * ## TLA-02 — détachabilité, formulée en ÉQUIVALENCE
 *
 * ⚠️ La formulation littérale « aucune ne doit jeter » est **infaisable** : `init()` jette
 * légitimement quand aucun contrôleur n'est monté, et fabriquer un contrôleur factice ferait
 * porter la garde sur le montage plutôt que sur la forme. L'assertion retenue est plus forte et
 * n'a besoin d'aucun contrôleur : **détacher ne change RIEN**.
 *
 * La comparaison porte sur le VERDICT (a jeté / a rendu), et sur le constructeur + le message
 * quand ça jette. Elle ne compare pas les valeurs rendues : `getHealth()` porte des compteurs
 * vivants, et une égalité profonde y serait instable pour une raison sans rapport avec le défaut.
 * C'est exactement le discriminant de D8 — attaché rendait, détaché jetait.
 *
 * ## Preuve par mutation — et la première est GRATUITE
 *
 *   G1  **aucune mutation, code de production intact (08/08/2026, avant 7.7)** → 🔴 **TLA-01 sur
 *       les 11 noms**, en nommant les deux fichiers. C'est la mesure qui DÉMONTRE le doublon : la
 *       garde et le relevé de pré-vol sont le même objet, et elle bascule au vert quand 7.7 retire
 *       l'`Object.assign`. Écrire cette garde APRÈS la réconciliation l'aurait fait naître verte,
 *       et il aurait fallu fabriquer une mutation pour ce que le dépôt démontrait tout seul.
 *   G2  `globals.api.ts` : `getMetrics` réécrit en `function () { return this.getHealth(); }`
 *       → 🔴 TLA-02 sur `getMetrics`. La mutation vise le SURVIVANT, pas le module condamné :
 *       muter celui qu'on supprime ne prouverait rien sur l'après.
 *   G6  restaurer l'`Object.assign` après 7.7 → 🔴 TLA-01 de nouveau. Prouve que la garde tient
 *       dans le sens RETOUR, pas seulement qu'elle a suivi le changement.
 *
 * @see packages/core/src/contracts/top-level-api.contract.ts — la liste des 11, jamais recopiée
 * @see roadmap_socle-init.md 📦 (archivée le 09/08/2026) §Sprint 7, tâche 7.7
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const ts = require_("typescript");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../../..");
const SRC = path.join(REPO, "packages/core/src");
const CONTRACT = path.join(SRC, "contracts/top-level-api.contract.ts");

const { readInterfaceMembers } = require_(path.join(REPO, "scripts/lib/ts-decl-read.cjs"));

/** Les 11 noms — LUS dans le contrat, jamais recopiés ici. */
const NAMES: string[] = [
    ...readInterfaceMembers(CONTRACT, "GeoLeafTopLevelApi", { tag: "TLA" }).keys(),
];

/** Tous les `.ts` de `src/`, récursivement. */
function sources(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) sources(p, out);
        else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
    }
    return out;
}

/**
 * Les expressions qui, DANS CE FICHIER, désignent le namespace `GeoLeaf`.
 *
 * Dérivées, jamais listées : un identifiant en est un si son initialiseur appelle
 * `ensureGeoLeaf()` / `getGeoLeaf()`, ou s'il porte une chaîne `….GeoLeaf` ; un paramètre en est
 * un si son type nomme `GeoLeaf`. Toute expression dont le texte finit par `.GeoLeaf` compte aussi.
 * Si ce détecteur cesse de matcher, TLA-03 le dit — il ne sort pas vert en silence.
 */
function namespaceAliases(sf: unknown): Set<string> {
    const aliases = new Set<string>();
    const visit = (node: any): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            const init = node.initializer.getText(sf);
            if (/\bensureGeoLeaf\s*\(|\bgetGeoLeaf\s*\(|\.GeoLeaf\b/.test(init)) {
                aliases.add(node.name.text);
            }
        }
        if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.type) {
            if (/GeoLeaf/.test(node.type.getText(sf))) aliases.add(node.name.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return aliases;
}

/** `true` si `expr` désigne le namespace dans ce fichier. */
function isNamespace(expr: unknown, sf: unknown, aliases: Set<string>): boolean {
    const t = (expr as any)?.getText?.(sf) ?? "";
    return aliases.has(t) || /\.GeoLeaf$/.test(t) || t === "GeoLeaf";
}

/** nom de méthode → fichiers (relatifs au dépôt) qui l'écrivent sur le namespace. */
function collectWriters(): Map<string, Set<string>> {
    const writers = new Map<string, Set<string>>(NAMES.map((n) => [n, new Set<string>()]));
    const files = sources(SRC);

    for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
        const aliases = namespaceAliases(sf);
        const rel = path.relative(REPO, file);
        const note = (name: string) => {
            if (writers.has(name)) writers.get(name)!.add(rel);
        };

        const visit = (node: any): void => {
            // Forme 1 — affectation de membre : `_gl.init = …`
            if (
                ts.isBinaryExpression(node) &&
                node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                ts.isPropertyAccessExpression(node.left) &&
                isNamespace(node.left.expression, sf, aliases)
            ) {
                note(node.left.name.text);
            }

            // Forme 2 — littéral d'`Object.assign` : `Object.assign(existing, { init: … })`.
            // C'est CELLE que le grep ne voit pas, et c'est la forme du doublon.
            if (
                ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                node.expression.name.text === "assign" &&
                node.expression.expression.getText(sf) === "Object" &&
                node.arguments.length >= 2 &&
                isNamespace(node.arguments[0], sf, aliases)
            ) {
                for (const arg of node.arguments.slice(1)) {
                    const lit = ts.isSatisfiesExpression?.(arg) ? arg.expression : arg;
                    if (!ts.isObjectLiteralExpression(lit)) continue;
                    for (const p of lit.properties) {
                        if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
                            note(p.name.text);
                        }
                    }
                }
            }

            // Forme 3 — `Object.defineProperty(<ns>, "init", …)`
            if (
                ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                node.expression.name.text === "defineProperty" &&
                node.expression.expression.getText(sf) === "Object" &&
                node.arguments.length >= 2 &&
                isNamespace(node.arguments[0], sf, aliases) &&
                ts.isStringLiteral(node.arguments[1])
            ) {
                note((node.arguments[1] as any).text);
            }

            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return writers;
}

const WRITERS = collectWriters();
const CORPUS = sources(SRC).length;

describe("TLA — les 11 méthodes de haut niveau : un seul écrivain, et détachables (7.7)", () => {
    it("TLA-03 — anti-garde-vide : corpus, contrat et détecteur sont tous vivants", () => {
        // ① le corpus scanné est réel
        expect(
            CORPUS,
            "moins de 400 fichiers scannés — le walk ne voit plus `src/`"
        ).toBeGreaterThan(400);
        // ② le contrat rend bien ses onze membres, sinon TLA-01 porterait sur l'ensemble vide
        expect(NAMES.length, `GeoLeafTopLevelApi rend ${NAMES.length} membres`).toBe(11);
        // ③ le DÉTECTEUR matche encore : `globals.api.ts` doit être vu comme écrivain de chacun.
        // Sans cette assertion, un détecteur cassé rendrait « 1 écrivain » (voire 0) partout et
        // TLA-01 sortirait verte en ne gardant plus rien — le mode d'échec exact de la classe.
        for (const name of NAMES) {
            expect(
                [...WRITERS.get(name)!],
                `TLA-03 : \`${name}\` n'est vu écrit par AUCUN fichier — le détecteur de namespace ` +
                    `ne matche plus. Ce n'est pas un succès, c'est une cécité.`
            ).toContain("packages/core/src/globals/globals.api.ts");
        }
    });

    it("TLA-01 — chacune des 11 est écrite par EXACTEMENT un module", () => {
        const multi = NAMES.map((n) => ({ n, files: [...WRITERS.get(n)!] })).filter(
            (x) => x.files.length !== 1
        );
        expect(
            multi.map((x) => `${x.n} ← ${x.files.join(" + ") || "(aucun)"}`),
            `Des méthodes de \`GeoLeafTopLevelApi\` ont plusieurs écrivains. Le dernier module ` +
                `évalué gagne, et rien ne garantit que les deux formes soient équivalentes — c'est ` +
                `le doublon B11, et il a déjà coûté deux défauts de production ` +
                `(\`get BaseLayers\` écrasé par undefined, \`getMetrics\` non détachable).`
        ).toEqual([]);
    });
});

// ── TLA-02 — détachabilité, au runtime ────────────────────────────────────────────────────────
//
// Chargé APRÈS le scan pour que l'import n'influence pas TLA-01. `globals/globals.js` est la
// chaîne que toute entrée du dépôt importe — c'est la surface réellement livrée.
await import("../../src/globals/globals.js");

/** Arguments plausibles par méthode — leur valeur importe peu, leur ARITÉ oui. */
const ARGS: Record<string, unknown[]> = {
    init: [{}],
    setTheme: ["light"],
    loadConfig: ["/profile.json"],
    createMap: ["map"],
    getMap: ["map"],
    getAllMaps: [],
    getModule: ["legend"],
    hasModule: ["legend"],
    getNamespace: ["Legend"],
    getHealth: [],
    getMetrics: [],
};

/**
 * Le VERDICT d'un appel, réduit à ce qui discrimine le défaut D8.
 *
 * Pas la valeur rendue : `getHealth()` porte des compteurs vivants, et une égalité profonde y
 * serait instable pour une raison étrangère au sujet. Ce qui compte est « a jeté ou a rendu », et
 * si ça jette, quoi exactement — c'est précisément là que la forme non détachable divergeait.
 */
function verdict(fn: (...a: unknown[]) => unknown, args: unknown[]): string {
    try {
        const v = fn(...args);
        // Une promesse rejetée n'est pas un throw synchrone : on la neutralise pour ne pas
        // faire échouer le run sur un rejet non capturé, et on ne compare que la synchronie.
        if (v && typeof (v as Promise<unknown>).catch === "function") {
            (v as Promise<unknown>).catch(() => {});
            return "returned:thenable";
        }
        return `returned:${v === null ? "null" : typeof v}`;
    } catch (e) {
        return `threw:${(e as Error)?.constructor?.name}:${(e as Error)?.message}`;
    }
}

describe("TLA-02 — détacher une méthode du namespace ne change RIEN", () => {
    const GeoLeaf = globalThis.GeoLeaf as unknown as Record<string, (...a: unknown[]) => unknown>;

    it("TLA-03bis — le namespace porte bien les 11 après import de la chaîne globals", () => {
        // Sans elle, la boucle ci-dessous sauterait tout et sortirait verte sur zéro sujet.
        for (const name of NAMES) {
            expect(typeof GeoLeaf?.[name], `GeoLeaf.${name} absent après import`).toBe("function");
        }
    });

    it.each(NAMES)("TLA-02 — %s : attaché et détaché rendent le même verdict", (name) => {
        const args = ARGS[name] ?? [];
        const attached = verdict((...a) => GeoLeaf[name](...a), args);
        const detached = verdict(
            (({ [name]: f }) => f as (...a: unknown[]) => unknown)(GeoLeaf),
            args
        );
        expect(
            detached,
            `\`const { ${name} } = GeoLeaf\` puis appel ne se comporte pas comme ` +
                `\`GeoLeaf.${name}()\`. C'est le défaut D8 : une méthode qui dépend de \`this\` ` +
                `marche attachée et casse détachée, et aucune gate de NOMS ne peut le voir.`
        ).toBe(attached);
    });
});
