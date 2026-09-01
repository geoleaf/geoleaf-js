/**
 * DECLARED data origins.
 *
 * What is exercised: normalisation refuses rather than guesses, matching
 * compares ORIGINS and not strings, and an authenticated origin never becomes cacheable.
 */

import {
    parseDataOrigins,
    publishDataOrigins,
    DATA_ORIGINS_KEY,
} from "../../../src/capabilities/offline/data-origins.ts";
import swSource from "../../../src/kernel/storage/sw-core.js?raw";

describe("parseDataOrigins — refuser plutôt que deviner", () => {
    test("normalise l'origine au lieu d'accepter la chaîne écrite", () => {
        // Accepting `"https://api.example.com/v1"` as-is would reintroduce
        // the string comparison this work removes.
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
        // A `true` default would cache an authenticated API the day someone
        // forgets the field; `false` would break an offline basemap. Absence = refusal.
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
    // ⚠️ Exercised THROUGH `publishDataOrigins`, which uses it to refuse a
    // duplicate. `matchDataOrigin` is not exported: it has one consumer, and
    // exporting for a caller that does not exist yet would be the posture
    // reproached elsewhere.
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
        // The defect earlier hardened and now made impossible:
        // `includes`/`startsWith` would have confused these two hosts.
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
        // A credentialed response in a shared cache is served to the next
        // reader. No declaration makes that acceptable, so the two fields are
        // reconciled HERE.
        const out = await publish([
            { origin: "https://api.test", roles: ["api"], cacheable: true, authenticated: true },
        ]);
        expect(out[0].cacheable).toBe(false);
    });

    test("une panne d'écriture est journalisée, jamais propagée", async () => {
        // A profile must keep loading when persistence is unavailable.
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
        // 🛑 The worker cannot import — it is copied as-is, unbundled. The
        // literal is thus written twice, and that is exactly the defect shape
        // that let the base version diverge for months. This guard is what prevents it.
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
        // ⚠️ Banning `includes(` outright would be WRONG: `roles.includes(role)`
        // is an ARRAY `includes`, perfectly legitimate. What is proscribed is
        // STRING comparison on a URL fragment — it, and it alone, is what
        // `hostname.includes("tile")` illustrated.
        expect(declarative).not.toMatch(/(hostname|href|pathname|origin)\s*\.\s*includes\(/);
        expect(declarative).not.toMatch(/(hostname|href|pathname|origin)\s*\.\s*startsWith\(/);
    });

    test("la blacklist ne porte plus `/api/`", () => {
        // A blind exclusion skipping a data API's most common path — i.e.
        // exactly the traffic a field deployment depends on.
        const bl = swSource.match(/const CACHE_BLACKLIST = \[([^\]]*)\]/);
        expect(bl).not.toBeNull();
        expect(bl[1]).not.toMatch(/api/);
        expect(bl[1]).toMatch(/chrome-extension/); // témoin : la liste n'est pas vide
    });
});
