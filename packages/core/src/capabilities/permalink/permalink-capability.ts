/*!
 * GeoLeaf Core (permalink capability) — Capability declaration
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `permalink` capability.
 *
 * Registered in `boot.ts` before the optional module gate so that
 * `GeoLeaf.Introspection.getAllCapabilities()` and `getCapabilitySchema('permalink')`
 * work at runtime. Relocated to `capabilities/permalink/` (S13) — two-way sync between
 * the application state (view, theme, layers, filters) and the URL (deep-linking).
 *
 * Like `cluster`, permalink has **no `ICoreModule`**: it is driven by two boot hooks
 * (`core-map.module` reads the URL before map creation; `init-reveal` applies the
 * stored state and starts sync after the reveal). The declaration exists purely for
 * introspection + the `modules.permalink.enabled` gate, which those hooks enforce.
 *
 * Config gate: `modules.permalink.enabled`. `enableWhenAbsent: true` — opt-out
 * (active unless a profile sets it to `false`), preserving the pre-migration
 * default-on behaviour. Migrated from the former `ui.permalink` block (S13).
 */

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";
import { DEFAULT_PERMALINK_FIELDS } from "./constants.js";

/** In-core capability declaration for the Permalink subsystem (URL ↔ state sync). */
export const PERMALINK_CAPABILITY: ICapabilityDeclaration = {
    id: "permalink",
    label: "Permalink",
    description: "Two-way sync between the application state and the URL (deep-linking).",
    gate: {
        configPath: "modules.permalink.enabled",
        enableWhenAbsent: true,
    },
    configSchema: {
        enabled: {
            type: "boolean",
            default: true,
            description: "Enable the URL ↔ state synchronisation globally (opt-out).",
        },
        mode: {
            type: "string",
            default: "hash",
            description: "URL encoding for the serialised state: 'hash' | 'query' | 'compact'.",
        },
        fields: {
            type: "array",
            // Copies (not the shared constant): `getSchema()` hands the declaration to
            // studio consumers, which must not be able to mutate the runtime default.
            // The default set IS the full supported set, so it doubles as the enum.
            default: [...DEFAULT_PERMALINK_FIELDS],
            items: { type: "string", enum: [...DEFAULT_PERMALINK_FIELDS] },
            description:
                "Optional state facets serialised into the permalink. Absent ⇒ the full " +
                "default set (the three read sites — state capture, URL parse, URL build — " +
                "all fall back to it). The whitelist is enforced on both encodings: verbose " +
                "`gl_*` params AND the compact `gl=<base64>` payload. ⚠️ The view state " +
                "(`lat` / `lng` / `zoom`) is mandatory and is NOT listable: it is always " +
                "written and always required on parse. It used to be offered here and was " +
                "inert — the three values were removed from the enum rather than left as a " +
                "promise the runtime does not keep.",
        },
        share: {
            type: "object",
            description:
                "Share-view modal (copy the permalink URL + QR code) — a sub-feature of permalink (S13 F7).",
            properties: {
                enabled: {
                    type: "boolean",
                    default: true,
                    description: "Enable the share button + modal (opt-out).",
                },
            },
        },
    },
    // No loader, no ICoreModule: permalink is driven by two boot hooks. Gated via config.
};
