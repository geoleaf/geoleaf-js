/*!
 * @geoleaf-plugins/editor — Option lists kept off-network
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Joins the dropdowns of the editor's forms to the option lists the core keeps.
 *
 * A field loading its choices from a URL (`fetchOptions`) showed its placeholder alone
 * off-network. `@geoleaf/field-renderer` cannot keep a list — persisting would pull a storage
 * engine into a field renderer (decision D5 of its spec) — so it asks its host first
 * (`setOptionsResolver`). The core keeps the lists (`GeoLeaf.Storage.resolveOptions`: held
 * first, fetched and kept otherwise, in a store the cache budget does not evict). This plugin
 * renders the forms, so it is the host that joins the two — the pattern of `initImageUpload`.
 *
 * A core without the member answers nothing, and the dropdown fetches as it always did.
 */

import { setOptionsResolver } from "@geoleaf/field-renderer";
import { storageFacade } from "./storage-seam.js";

/**
 * Hands the core's kept lists to every dropdown the editor renders. Idempotent: the library
 * holds one resolver, and a second call replaces the first with the same.
 */
export function initOptionLists(): void {
    setOptionsResolver(async (url) => {
        const storage = storageFacade();
        if (typeof storage?.resolveOptions !== "function") return null;
        try {
            return (await storage.resolveOptions(url)) ?? null;
        } catch {
            return null;
        }
    });
}

/** Hands the dropdowns back to the network (plugin destroy). */
export function destroyOptionLists(): void {
    setOptionsResolver(null);
}
