/**
 * The pending badge listens to what actually fires — and lets go of all of it.
 *
 * 🛑 **THE BADGE HANGS ON EVENTS THIS PLUGIN DOES NOT OWN.** It counted the whole
 * outbox but only ever heard about drains that went through this plugin's own replay
 * module (`geoleaf:editor:feature-sync-flushed`). The drain itself is the CORE's
 * (`Storage.pushOutbox`), and the core now announces every pass on
 * `geoleaf:offline:outbox-drained`. A drain fired by the core with this plugin merely
 * loaded would otherwise leave the badge frozen on a stale count — a number that looks
 * right and is wrong, which is worse than no badge.
 *
 * ⚠️ **Asserted on the SOURCE, and both directions.** A listener test that mounted the
 * plugin would prove the wiring of the day; this proves the pair. The subject is read
 * from disk, so an event added to the badge's diet enters the perimeter without anyone
 * registering it here — and its missing `removeEventListener` shows up at once. That
 * asymmetry is the leak class: a destroyed editor still refreshing a badge that no
 * longer exists.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(__dirname, "../entry.ts");

/** Event names bound to `_onQueueChanged`, per direction. */
function boundTo(source: string, verb: "addEventListener" | "removeEventListener"): string[] {
    const re = new RegExp(`${verb}\\(\\s*"([^"]+)"\\s*,\\s*_onQueueChanged\\s*\\)`, "g");
    return [...source.matchAll(re)].map((m) => m[1]!).sort();
}

describe("pending badge — the events it follows", () => {
    const source = readFileSync(ENTRY, "utf8");

    it("écoute l'annonce de drain DU CORE, pas seulement celle du plugin", () => {
        expect(boundTo(source, "addEventListener")).toContain("geoleaf:offline:outbox-drained");
    });

    it("garde l'événement du plugin — il reste émis sur le chemin du geste manuel", () => {
        expect(boundTo(source, "addEventListener")).toContain(
            "geoleaf:editor:feature-sync-flushed"
        );
    });

    it("🛑 tout ce qui est écouté est relâché — l'asymétrie est la fuite", () => {
        const added = boundTo(source, "addEventListener");
        expect(added.length).toBeGreaterThan(0);
        expect(boundTo(source, "removeEventListener")).toEqual(added);
    });
});
