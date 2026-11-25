/**
 * Contract test — the members of the NAMED paths below depth 2 (`EXPECTED_DEEP_MEMBERS`).
 *
 * The golden master cannot measure them: its boot does not load the deferred offline engine,
 * so `Storage.Cache` is empty there. This file wires the real engine entry into the real
 * `Storage` façade — exactly what the capability's loader does — then walks the named paths
 * twice, 30 ms apart, through `walkNamespace(..., { deep })`, the walk the consumer gate
 * believes. Locked by the consumer-contract gate (CC-09), which reads this file's assertions.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

// `scripts/lib/` is tooling and ships no declarations: the shapes used here are named on the
// next lines rather than left as `any` (same pattern as internal-member-migration.guard).
// @ts-expect-error — untyped tooling module, shapes asserted on the next lines
const oracle = (await import("../../../../../scripts/lib/namespace-surface.mjs")) as {
    walkNamespace: (
        root: unknown,
        opts?: { descend?: string[]; deep?: string[] }
    ) => { members: Record<string, string[]> };
    diffSurface: (expected: string[], actual: string[]) => { missing: string[]; extra: string[] };
    EXPECTED_DEEP_MEMBERS: Record<string, string[]>;
    DEEP_PATHS: string[];
};
const { walkNamespace, diffSurface, EXPECTED_DEEP_MEMBERS, DEEP_PATHS } = oracle;

let captured: { members: Record<string, string[]>; membersAgain?: Record<string, string[]> };

beforeAll(async () => {
    const { Storage } = await import("../../../src/kernel/storage/facade.js");
    (globalThis as { GeoLeaf?: unknown }).GeoLeaf = {
        Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        Storage,
        // registerPoiRestore reads the Layers surface; a neutral stub suffices.
        Layers: { onLayerAdded: vi.fn() },
    };
    await import("../../../src/capabilities/offline/offline-engine-entry.js");

    const root = (globalThis as { GeoLeaf?: unknown }).GeoLeaf;
    captured = { members: walkNamespace(root, { deep: DEEP_PATHS }).members };
    await new Promise((r) => setTimeout(r, 30));
    captured.membersAgain = walkNamespace(root, { deep: DEEP_PATHS }).members;
});

describe("chemins profonds nommés — mesurés sur le moteur hors ligne câblé", () => {
    it("chaque chemin est atteint — un chemin perdu ne se lit pas comme une liste vide", () => {
        expect(DEEP_PATHS.filter((p) => captured.members[p] === undefined)).toEqual([]);
    });

    it("expose exactement les MEMBRES figés de chaque chemin", () => {
        for (const deepPath of DEEP_PATHS) {
            const d = diffSurface(
                EXPECTED_DEEP_MEMBERS[deepPath] ?? [],
                captured.members[deepPath] ?? []
            );
            expect(
                d.missing,
                `GeoLeaf.${deepPath} — membres DISPARUS : ${d.missing.join(", ")}`
            ).toEqual([]);
            expect(
                d.extra,
                `GeoLeaf.${deepPath} — membres APPARUS : ${d.extra.join(", ")}`
            ).toEqual([]);
        }
    });

    it("la surface est stable entre deux mesures", () => {
        expect(captured.membersAgain).toEqual(captured.members);
    });
});
