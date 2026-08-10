/**
 * @fileoverview Every i18n key the CODE asks for must exist in all six dictionaries (B.38).
 *
 * The sibling suite (`i18n.test.js`) checks the dictionaries against `REQUIRED_KEYS` — a
 * list maintained BY HAND. A key that the source starts requesting without anyone editing
 * that list is therefore invisible to it, and the failure is silent by construction: every
 * call site passes a French fallback, so an unresolved key simply serves French to every
 * locale and nothing errors. That is bug C-5 all over again — the same shape
 * `check-i18n-dict-shape.cjs` was written for, on the other axis: it guards how keys are
 * DECLARED, this guards that requested keys EXIST.
 *
 * Found this way: `feature-info.sidepanel.landmark` and `feature-info.sidepanel.close` were
 * requested by `surfaces/sidepanel.ts` and present in none of the six dictionaries, so the
 * side-panel's landmark and close button announced themselves in French to English, Spanish,
 * Portuguese, Italian and German users.
 *
 * The key list is DERIVED from the source, never enumerated here — enumerating it would
 * reproduce exactly the weakness this suite exists to remove.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(__dirname, "../../src");
const LANG_CODES = ["fr", "en", "es", "pt", "it", "de"];

/** `getLabel("a.b")`, `t("a.b", …)`, `i18n("a.b", …)` — string literal first arg only. */
const CALL_RE = /\b(?:getLabel|t|i18n)\(\s*"([a-z][a-zA-Z0-9_.-]*\.[a-zA-Z0-9_.-]+)"/g;

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === "lang") continue; // the dictionaries themselves
            out.push(...walk(full));
        } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Strips block and line comments.
 *
 * Not cosmetic: TSDoc carries `@example getLabel("toast.geoloc.error_timeout", …)` on the
 * i18n module itself, and scanning it reported a missing key that no code ever asks for —
 * the real call site uses the correct dotted `toast.geoloc.error.timeout`. A guard that
 * cries wolf on documentation gets muted, so the noise is removed at the source rather
 * than allow-listed.
 */
function stripComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Every literal i18n key requested anywhere in `src/`, with the file that asks for it. */
function collectRequestedKeys() {
    const byKey = new Map();
    for (const file of walk(SRC)) {
        const text = stripComments(readFileSync(file, "utf8"));
        for (const m of text.matchAll(CALL_RE)) {
            const rel = file.slice(SRC.length + 1);
            if (!byKey.has(m[1])) byKey.set(m[1], new Set());
            byKey.get(m[1]).add(rel);
        }
    }
    return byKey;
}

describe("i18n — every key the code requests exists in all six dictionaries (B.38)", () => {
    const requested = collectRequestedKeys();

    it("finds keys to check — a green run here must never mean an empty sweep", () => {
        // The failure mode this guards is the gate that passes by scanning nothing.
        expect(requested.size).toBeGreaterThan(20);
    });

    test.each(LANG_CODES)("lang-%s resolves every requested key", async (code) => {
        const dict = (await import(/* @vite-ignore */ `../../src/lang/lang-${code}.js`)).default;

        const missing = [];
        for (const [key, files] of requested) {
            if (typeof dict[key] !== "string" || dict[key].length === 0) {
                missing.push(`${key}  ← ${[...files].join(", ")}`);
            }
        }

        expect(missing).toEqual([]);
    });
});
