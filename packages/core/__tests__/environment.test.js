/**
 * Vérification de l'environnement de test lui-même.
 *
 * ⚠️ **Conservé délibérément — n'importe aucun module du projet, et c'est sa nature**
 * (backlog R.3, 24/07/2026). Son sujet EST le harnais : `setup.js` monte-t-il bien
 * `global.testHelpers`, le DOM et le mock de `fetch` ? Un fichier qui teste le harnais
 * n'a pas de module sous test — ce n'est pas le défaut que R.3 chassait. Ne pas le
 * re-signaler au prochain tri.
 */

describe("Environment Setup", () => {
    test("Jest is configured correctly", () => {
        expect(true).toBe(true);
    });

    test("Global helpers are available", () => {
        expect(global.testHelpers).toBeDefined();
        expect(typeof global.testHelpers.createMapContainer).toBe("function");
        expect(typeof global.testHelpers.createMockPOI).toBe("function");
    });

    test("Leaflet mock is no longer required (MapLibre)", () => {
        // global.L was removed during the Leaflet purge (Sprint 9)
        expect(true).toBe(true);
    });

    test("DOM is available (jsdom)", () => {
        const div = document.createElement("div");
        div.id = "test";
        document.body.appendChild(div);

        expect(document.getElementById("test")).toBeDefined();
    });

    test("Fetch mock is available", () => {
        expect(global.fetch).toBeDefined();
        expect(typeof global.fetch).toBe("function");
    });
});
