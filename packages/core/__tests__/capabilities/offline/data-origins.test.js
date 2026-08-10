/**
 * Origines de données DÉCLARÉES (tâche 3.9).
 *
 * Ce qui est éprouvé : la normalisation refuse plutôt qu'elle ne devine, l'appariement compare
 * des ORIGINES et non des chaînes, et une origine authentifiée ne devient jamais cachable.
 */

import {
    parseDataOrigins,
    publishDataOrigins,
    DATA_ORIGINS_KEY,
} from "../../../src/capabilities/offline/data-origins.ts";
import swSource from "../../../src/kernel/storage/sw-core.js?raw";

describe("parseDataOrigins — refuser plutôt que deviner", () => {
    test("normalise l'origine au lieu d'accepter la chaîne écrite", () => {
        // Accepter `"https://api.example.com/v1"` tel quel réintroduirait la comparaison de
        // chaînes que cette tâche retire.
        const [d] = parseDataOrigins([
            { origin: "https://api.example.com/v1?x=1", roles: ["api"], cacheable: false },
        ]);
        expect(d.origin).toBe("https://api.example.com");
    });

    test("une origine illisible est DROPPÉE, jamais coercée", () => {
        expect(
            parseDataOrigins([{ origin: "api.example.com", roles: ["api"], cacheable: true }])
        ).toEqual([]);
    });

    test("`cacheable` absent est un REFUS — aucun défaut n'est sûr", () => {
        // `true` par défaut cacherait une API authentifiée le jour où quelqu'un oublie le
        // champ ; `false` casserait un fond de carte hors-ligne. Absence = refus.
        expect(parseDataOrigins([{ origin: "https://a.test", roles: ["tiles"] }])).toEqual([]);
    });

    test("une déclaration sans rôle est droppée", () => {
        expect(
            parseDataOrigins([{ origin: "https://a.test", roles: [], cacheable: true }])
        ).toEqual([]);
    });

    test("une valeur non-tableau rend une liste vide, pas une exception", () => {
        expect(parseDataOrigins(undefined)).toEqual([]);
        expect(parseDataOrigins("https://a.test")).toEqual([]);
    });
});

describe("appariement d'origine — strict, jamais sous-chaîne", () => {
    // ⚠️ Éprouvé À TRAVERS `publishDataOrigins`, qui s'en sert pour refuser un doublon.
    // `matchDataOrigin` n'est pas exporté : il n'a qu'un consommateur, et exporter pour un
    // appelant du Sprint 4 qui n'existe pas serait la posture que ce sprint reproche ailleurs.
    const publish = async (raw) => {
        const written = [];
        await publishDataOrigins(
            { setPreference: async (_k, v) => written.push(v) },
            parseDataOrigins(raw)
        );
        return written[0] ?? [];
    };

    test("deux déclarations de la MÊME origine → la seconde est refusée", async () => {
        const out = await publish([
            { origin: "https://a.test", roles: ["tiles"], cacheable: true },
            { origin: "https://a.test/autre-chemin", roles: ["api"], cacheable: false },
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].roles).toEqual(["tiles"]); // la PREMIÈRE s'applique
    });

    test("un hôte SUFFIXE n'est PAS un doublon — c'est une autre origine", async () => {
        // Le défaut que 3.7 avait durci et que 3.9 rend impossible : `includes`/`startsWith`
        // auraient confondu ces deux hôtes.
        const out = await publish([
            { origin: "https://a.test", roles: ["tiles"], cacheable: true },
            { origin: "https://a.test.attaquant.tld", roles: ["tiles"], cacheable: true },
        ]);
        expect(out).toHaveLength(2);
    });

    test("un port différent est une origine différente", async () => {
        const out = await publish([
            { origin: "https://a.test", roles: ["api"], cacheable: false },
            { origin: "https://a.test:8443", roles: ["api"], cacheable: false },
        ]);
        expect(out).toHaveLength(2);
    });

    test("une origine AUTHENTIFIÉE est publiée non cachable, quoi qu'ait dit le profil", async () => {
        // Une réponse créditée dans un cache partagé est servie au lecteur suivant. Aucune
        // déclaration ne rend cela acceptable, donc les deux champs sont réconciliés ICI.
        const out = await publish([
            { origin: "https://api.test", roles: ["api"], cacheable: true, authenticated: true },
        ]);
        expect(out[0].cacheable).toBe(false);
    });

    test("une panne d'écriture est journalisée, jamais propagée", async () => {
        // Un profil doit continuer à charger quand la persistance est indisponible.
        await expect(
            publishDataOrigins(
                {
                    setPreference: async () => {
                        throw new Error("quota");
                    },
                },
                parseDataOrigins([{ origin: "https://a.test", roles: ["api"], cacheable: false }])
            )
        ).resolves.toBeUndefined();
    });
});

describe("3.9 — le littéral PARTAGÉ entre le core et le worker", () => {
    test("`sw-core.js` code la MÊME clé que `data-origins.ts`", () => {
        // 🛑 Le worker ne peut pas importer — il est copié tel quel, sans bundler. Le littéral
        // est donc écrit deux fois, et c'est exactement la forme de défaut qui a laissé la
        // version de base diverger pendant des mois. Cette garde est ce qui l'empêche.
        const inWorker = swSource.match(/const DATA_ORIGINS_KEY = "([^"]+)"/);
        expect(inWorker, "le worker doit déclarer la clé").not.toBeNull();
        expect(inWorker[1]).toBe(DATA_ORIGINS_KEY);
    });

    test("le worker ne route plus par sous-chaîne de hostname dans son chemin déclaratif", () => {
        const declarative = swSource.slice(
            swSource.indexOf("function matchDeclaredOrigin"),
            swSource.indexOf("function fetchBounded")
        );
        expect(declarative).toMatch(/new URL\(url\)\.origin/);
        // ⚠️ Interdire `includes(` tout court serait FAUX : `roles.includes(role)` est un
        // `includes` de TABLEAU, parfaitement légitime. Ce qui est proscrit, c'est la
        // comparaison de CHAÎNES sur une partie d'URL — c'est elle, et elle seule, que
        // `hostname.includes("tile")` illustrait.
        expect(declarative).not.toMatch(/(hostname|href|pathname|origin)\s*\.\s*includes\(/);
        expect(declarative).not.toMatch(/(hostname|href|pathname|origin)\s*\.\s*startsWith\(/);
    });

    test("la blacklist ne porte plus `/api/`", () => {
        // T4 : une exclusion en aveugle qui sautait le chemin le plus courant d'une API de
        // données — c'est-à-dire exactement le trafic dont dépend un déploiement de terrain.
        const bl = swSource.match(/const CACHE_BLACKLIST = \[([^\]]*)\]/);
        expect(bl).not.toBeNull();
        expect(bl[1]).not.toMatch(/api/);
        expect(bl[1]).toMatch(/chrome-extension/); // témoin : la liste n'est pas vide
    });
});
