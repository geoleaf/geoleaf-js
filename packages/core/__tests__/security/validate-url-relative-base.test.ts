/**
 * A relative URL resolves against the DOCUMENT's address, not the site's origin.
 *
 * `validateUrl` resolved a relative path against `location.origin`. Served at the root of a
 * site, the two coincide; served in a folder (`https://host/app/`), they do not: the profile's
 * `icons/sprite.svg` became `https://host/profiles/…` instead of `https://host/app/profiles/…` —
 * a 404, and not one taxonomy icon on the map, in the legend or in the popups. The offline cache
 * already resolved the same URL against the page's address: the two now agree.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { validateUrl, resolveBaseUrl } from "../../src/kernel/security/validators.js";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("validateUrl — base d'une URL relative", () => {
    it("sous un sous-chemin, un chemin relatif garde le dossier du document", () => {
        vi.stubGlobal("document", { baseURI: "https://host.test/app/index.html" });
        vi.stubGlobal("location", {
            origin: "https://host.test",
            href: "https://host.test/app/index.html",
        });

        expect(validateUrl("profiles/tourism/icons/sprite.svg")).toBe(
            "https://host.test/app/profiles/tourism/icons/sprite.svg"
        );
        expect(resolveBaseUrl()).toBe("https://host.test/app/index.html");
    });

    it("un chemin absolu et une base explicite restent ce qu'ils étaient", () => {
        vi.stubGlobal("document", { baseURI: "https://host.test/app/index.html" });
        expect(validateUrl("/x.svg")).toBe("https://host.test/x.svg");
        expect(validateUrl("y.svg", "https://other.test/dir/")).toBe(
            "https://other.test/dir/y.svg"
        );
    });
});
