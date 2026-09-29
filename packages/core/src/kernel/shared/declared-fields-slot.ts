/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The declared-fields slot — what the kernel asks of every reader of a layer's data.
 *
 * A profile names the properties of its data in free text: a taxonomy's `categoryField`, a
 * style rule's `when.field`, an attribute row's `field`. A name the data does not carry reads
 * `undefined`, and the reader falls back to its default without a word — a generic icon, an empty
 * row, a rule that never matches. The kernel's loader is the one place that holds a layer's
 * definition, its style and its features together, so it confronts the two
 * (`kernel/geojson/field-reconciliation.ts`).
 *
 * But the kernel does not know every key, nor how each is read: the taxonomy looks a name up at
 * the feature root, then under `attributes`, then under `properties`; the attribute rows resolve
 * `properties.x` and `attributes.x` paths. The reading rule belongs to the reader. So the
 * dependency is inverted, as the legend slot inverts it (`legend-slot.ts`): the kernel owns this
 * slot, each capability that reads a declared field fills it from its installer, and a bundle
 * without that capability leaves its keys unjudged — nothing would read them.
 *
 * Lives in `kernel/shared/` because capabilities fill it: R.8 forbids `capabilities/**` a deep
 * import under `kernel/**`, and `provideDeclaredFields` passes the mediation barrel; the kernel
 * reader imports this file directly.
 */

/** A feature as the loader holds it — a GeoJSON feature, possibly with extra members. */
export interface DeclaredFieldFeature {
    properties?: Record<string, unknown> | null;
    [key: string]: unknown;
}

/** One field a profile names, and how its reader looks for it. */
export interface DeclaredField {
    /** Where the profile declares it — the configuration path the diagnostic shows. */
    readonly key: string;
    /** The name as the profile writes it. */
    readonly field: string;
    /**
     * Whether a feature carries the field under its reader's own rule. A KEY, not a value: a
     * property present with `null` is carried — sparse data is not a naming fault.
     */
    present(feature: DeclaredFieldFeature): boolean;
}

/** What a provider is asked about: one layer, its definition, and the style it wears. */
export interface DeclaredFieldsContext {
    /** The layer's identifier. */
    readonly layerId: string;
    /** The layer's definition, as the loader holds it. */
    readonly def: Readonly<Record<string, unknown>>;
    /** The style document the layer wears — `null` when it has none. */
    readonly style: Readonly<Record<string, unknown>> | null;
}

/** A reader's side of the slot: the fields it will read on a layer, none when it reads none. */
export type DeclaredFieldsProvider = (ctx: DeclaredFieldsContext) => readonly DeclaredField[];

/**
 * The providers, by capability id. A map and not a list: an installer's `registerGlobals` runs on
 * every boot, and a remount would otherwise ask the same reader twice.
 */
const _providers = new Map<string, DeclaredFieldsProvider>();

/**
 * Fills the slot for one reader — a capability's installer does, when the bundle embarks it.
 *
 * @param id - The reader's identifier — its capability id; a second call replaces the first.
 * @param provider - The reader's side of the slot, or `null` to empty it.
 */
export function provideDeclaredFields(id: string, provider: DeclaredFieldsProvider | null): void {
    if (provider) _providers.set(id, provider);
    else _providers.delete(id);
}

/**
 * The readers the bundle embarks, in the order they filled the slot.
 *
 * @returns Every provider currently in the slot — empty when no reader filled it.
 */
export function declaredFieldProviders(): readonly DeclaredFieldsProvider[] {
    return [..._providers.values()];
}
