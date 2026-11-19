/**
 * Guard — a style carried by the bundle costs no request, and yields the SAME envelope.
 *
 * ## Why the second half matters as much as the first
 *
 * Returning the raw document would satisfy every consumer that only reads `styleData` — and
 * break the legend generator, which reads `styleData.id`. That is the defect `_ensureStyleId`
 * was written for. So this guard does not merely count requests: it compares the two
 * envelopes structurally, which is the only assertion that catches a shortcut.
 *
 * ## Why case ② is not decorative
 *
 * `debug: true` makes the profile loader IGNORE the bundle and take the cascade. Nothing in
 * the repo exercises that mode, so a store that silently became mandatory would pass every
 * other test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    clearStyleCache,
    seedStyleDocuments,
    styleDocumentStore,
} from "../../src/utils/loaders/style-cache.js";
import { loadAndValidateStyle } from "../../src/utils/loaders/style-loader-core.js";

/**
 * A REAL style document from the repo — schema-valid, because `_applyStyleValidation` runs on
 * both paths and a hand-made fixture would only prove that the guard rejects it.
 *
 * ⚠️ `id` is deliberately REMOVED: it is what `_ensureStyleId` derives, and the whole point of
 * comparing the two envelopes is to catch a seeded path that skips that derivation.
 */
const DOC = {
    label: {
        enabled: true,
        visibleByDefault: false,
        field: "nom",
        font: {
            family: "Open Sans",
            sizePt: 7,
            weight: 50,
            bold: false,
            italic: false,
        },
        color: "#1d4ed8",
        opacity: 1,
        buffer: {
            enabled: true,
            color: "#fafafa",
            opacity: 1,
            sizePx: 3.78,
        },
    },
    description: "",
    style: {
        casing: {
            enabled: true,
            color: "#1e3a8a",
            opacity: 1,
            widthPx: 1,
        },
        color: "#3b82f6",
        opacity: 1,
        weight: 3,
    },
    legend: {
        label: "Parcours (démo édition)",
    },
};

/** Strips what legitimately differs between two loads of the same style. */
const shape = (r: unknown) => {
    const { styleData, labelConfig, metadata } = r as {
        styleData: unknown;
        labelConfig: unknown;
        metadata: Record<string, unknown>;
    };
    const { loadedAt: _drop, ...stableMeta } = metadata;
    return { styleData, labelConfig, metadata: stableMeta };
};

describe("style documents carried by the bundle", () => {
    beforeEach(() => {
        clearStyleCache();
        vi.restoreAllMocks();
    });

    it("① seeded — zero request, and an envelope identical to the fetched one", async () => {
        // The reference: what the HTTP path produces for this very document.
        const fetched = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => structuredClone(DOC),
            text: async () => JSON.stringify(DOC),
        });
        vi.stubGlobal("fetch", fetched);
        const viaHttp = await loadAndValidateStyle("p", "l", "defaut", "defaut.json", "layers/l");
        expect(fetched).toHaveBeenCalledTimes(1);

        // Same style, this time handed over by the bundle.
        clearStyleCache();
        const refused = vi.fn(() => {
            throw new Error("GUARD: a style carried by the bundle must cost no request");
        });
        vi.stubGlobal("fetch", refused);
        seedStyleDocuments("p", { l: { defaut: structuredClone(DOC) } });

        const viaStore = await loadAndValidateStyle("p", "l", "defaut", "defaut.json", "layers/l");

        expect(refused).not.toHaveBeenCalled();
        expect(shape(viaStore)).toEqual(shape(viaHttp));
    });

    it("② absent — the HTTP path is unchanged (the `debug: true` cascade still works)", async () => {
        const fetched = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => structuredClone(DOC),
            text: async () => JSON.stringify(DOC),
        });
        vi.stubGlobal("fetch", fetched);

        expect(styleDocumentStore.has("p:other:defaut")).toBe(false);
        await loadAndValidateStyle("p", "other", "defaut", "defaut.json", "layers/other");

        expect(fetched).toHaveBeenCalledTimes(1);
    });

    describe("a newer bundle of the same profile — the remount case", () => {
        /** The document with another line colour, as a server writes it into the next bundle. */
        const recoloured = (color: string) => {
            const doc = structuredClone(DOC);
            doc.style.color = color;
            return doc;
        };
        const colourOf = (r: unknown) =>
            (r as { styleData: { style: { color: string } } }).styleData.style.color;
        const refuseFetch = () => {
            const refused = vi.fn(() => {
                throw new Error("GUARD: a style carried by the bundle must cost no request");
            });
            vi.stubGlobal("fetch", refused);
            return refused;
        };

        it("③ the newer bundle's document wins over the envelope of the first load", async () => {
            const refused = refuseFetch();
            seedStyleDocuments("p", { l: { defaut: recoloured("#111111") } });
            const first = await loadAndValidateStyle("p", "l", "defaut", "defaut.json", "layers/l");
            expect(colourOf(first)).toBe("#111111");

            seedStyleDocuments("p", { l: { defaut: recoloured("#222222") } });
            const second = await loadAndValidateStyle(
                "p",
                "l",
                "defaut",
                "defaut.json",
                "layers/l"
            );

            expect(colourOf(second)).toBe("#222222");
            expect(refused).not.toHaveBeenCalled();
        });

        it("④ the same bundle again — no request, the same envelope", async () => {
            const refused = refuseFetch();
            seedStyleDocuments("p", { l: { defaut: structuredClone(DOC) } });
            const first = await loadAndValidateStyle("p", "l", "defaut", "defaut.json", "layers/l");
            seedStyleDocuments("p", { l: { defaut: structuredClone(DOC) } });
            const second = await loadAndValidateStyle(
                "p",
                "l",
                "defaut",
                "defaut.json",
                "layers/l"
            );

            expect(refused).not.toHaveBeenCalled();
            expect(shape(second)).toEqual(shape(first));
        });

        it("⑤ another profile keeps its documents and its envelopes", async () => {
            refuseFetch();
            seedStyleDocuments("other", { l: { defaut: recoloured("#333333") } });
            const kept = await loadAndValidateStyle(
                "other",
                "l",
                "defaut",
                "defaut.json",
                "layers/l"
            );
            seedStyleDocuments("p", { l: { defaut: recoloured("#222222") } });

            expect(styleDocumentStore.has("other:l:defaut")).toBe(true);
            const again = await loadAndValidateStyle(
                "other",
                "l",
                "defaut",
                "defaut.json",
                "layers/l"
            );
            expect(again).toBe(kept);
        });

        it("⑥ a style the newer bundle no longer carries does not survive it", () => {
            seedStyleDocuments("p", { l: { a: structuredClone(DOC), b: structuredClone(DOC) } });
            seedStyleDocuments("p", { l: { a: structuredClone(DOC) } });

            expect(styleDocumentStore.has("p:l:a")).toBe(true);
            expect(styleDocumentStore.has("p:l:b")).toBe(false);
        });

        it("⑦ no bundle (the cascade) — a fetched envelope stays cached", async () => {
            const fetched = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                statusText: "OK",
                json: async () => structuredClone(DOC),
                text: async () => JSON.stringify(DOC),
            });
            vi.stubGlobal("fetch", fetched);
            await loadAndValidateStyle("p", "l", "defaut", "defaut.json", "layers/l");
            seedStyleDocuments("p", undefined);
            await loadAndValidateStyle("p", "l", "defaut", "defaut.json", "layers/l");

            expect(fetched).toHaveBeenCalledTimes(1);
        });
    });

    it("clearing the cache clears the seeded documents too", () => {
        seedStyleDocuments("p", { l: { defaut: DOC } });
        expect(styleDocumentStore.size).toBeGreaterThan(0);
        clearStyleCache();
        expect(styleDocumentStore.size).toBe(0);
    });
});
