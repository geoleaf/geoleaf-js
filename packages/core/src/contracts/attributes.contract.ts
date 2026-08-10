/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — Layer attribute model (public type boundary)
 *
 * Declares the `attributes` block of a layer configuration: one list of fields and two
 * projections — `display` for reading, `edit` for capture. It is the single declaration
 * of "which property, shown how, captured how" for a layer.
 *
 * ⚠️ A third part, a `uses` block binding the field to the other subsystems that name it,
 * lived here from 02/08 to 06/08/2026 and was REMOVED. It was meant to reconcile a field
 * named in five other files — but measurement showed it reconciled nothing: it added a
 * FOURTH list of field names without replacing any of the three that existed then
 * (`attributes.fields[]`, `table.columns[]`, `formSchema`), and two of its five target
 * subsystems name no layer field at all (`modules.filter.fields[]` declares filter
 * CONTROLS; `modules.permalink.fields` is posed by no profile). See decision A3‴ in
 * `_docs_projet/travail/roadmaps/roadmap_collecte-terrain-offline.md`.
 *
 * ✅ **Two lists, not three, since task 7.2** — `formSchema` is gone, key and all, absorbed
 * into the `edit` projection below. That is what A3‴ said the model was FOR, and it is the
 * measure of the difference: `uses` proposed a fourth declaration, `edit` removed one.
 *
 * Two columns carry the type, deliberately:
 * - `primitive` — what the value IS in the GeoJSON feature.
 * - `widget` — how it is presented or captured.
 *
 * Splitting them is what lets `validate:profiles` refuse an illegal pair at build
 * time (e.g. a `number` asked to render as a `date`). A single "representation"
 * column would give the schema nothing to confront.
 *
 * Ownership of the two halves is split by role: the core `feature-info` capability
 * owns reading (tooltip, popup, side panel) and the `field-renderer` package owns
 * capture. The core does not import `field-renderer`; this contract is the shared
 * vocabulary, not a shared implementation.
 *
 * Scope note — this file declares types only. The schema at
 * `profiles/schemas/layer-config.schema.json` is what enforces them, and the
 * `PROFILE_CONTRACT_SPEC.md` section is what documents them for integrators.
 */

/**
 * What an attribute value IS in the GeoJSON feature.
 *
 * Derived from the value type each `field-renderer` component actually declares
 * (`ComponentDefinition<TValue>`), not from the field name.
 *
 * ⚠️ `badge` (`{label, color}`), `link` (`{href, label?}`) and `price`
 * (`{amount, currency}`) hold objects **on the capture side** — which is why passing
 * one of them to a plain text renderer yields `[object Object]`, the defect that
 * motivated splitting the two type columns in the first place.
 *
 * 🛑 **But on the reading side they are scalars, and this doc used to claim
 * otherwise.** Confronting the declaration with the shipped GeoJSON found 15 fields
 * on 86 holding plain strings under those three widgets. The three are therefore
 * declared as unions in {@link AttributeWidgetPrimitive}, and the sentence above is
 * scoped rather than absolute — it was written from the capture components alone.
 */
export type AttributePrimitive =
    | "string"
    | "number"
    | "boolean"
    | "string[]"
    | "object"
    | "object[]";

/**
 * How an attribute value is presented (reading) or captured (edition).
 *
 * 23 of these identifiers are the components registered by `field-renderer`. They are
 * the reference vocabulary: the core render tables and the profile schema align on
 * this list, not the reverse.
 *
 * ⚠️ `action` is the exception, added 02/08/2026, and it is NOT a `field-renderer`
 * component — the package has none. It is a core-only reading widget: a button that
 * emits `geoleaf:popup:action`, live since 29/07/2026. It was missing from the first
 * cut of this contract, which would have made an action field undeclarable on a
 * migrated layer while the event stayed typed, emitted and taught in three published
 * places. Nothing would have reddened: no profile declares one today.
 */
export type AttributeWidget =
    | "action"
    | "badge"
    | "checkbox"
    | "coordinates"
    | "date"
    | "dropdown"
    | "email"
    | "gallery"
    | "hours"
    | "image"
    | "link"
    | "list"
    | "longtext"
    | "metric"
    | "number"
    | "phone"
    | "price"
    | "radio"
    | "rating"
    | "reviews"
    | "table"
    | "tags"
    | "text"
    | "url";

/**
 * The legal `primitive` for each `widget` — the whitelist of pairs, expressed as a
 * type so TypeScript refuses an illegal couple at the same place the JSON schema
 * refuses it at build time.
 *
 * `checkbox` holds a `boolean` when single and a `string[]` when its `multiple`
 * option is set.
 *
 * `action` takes `"string"` because its declared `field` still names a property —
 * the one a host may key its handler on. The button's identity travels in
 * `options.actionId`, which is opaque to the core.
 *
 * ⚠️ `badge`, `link` and `price` accept BOTH a scalar and an object, and the reason
 * is measured rather than defensive. The first cut of this contract derived them
 * from each `field-renderer` component's `ComponentDefinition<TValue>` — that is,
 * from the CAPTURE side, where a badge really is `{label, color}`. On the READING
 * side the value is a plain string: `renderBadge` takes the label and gets its
 * colours from the taxonomy seam, `renderLink` takes a URL. Confronting the
 * declaration against the actual GeoJSON of the shipped profiles, on 50 features per
 * layer, found **15 fields on 86** where the object form would have been a false
 * declaration — and `primitive` is defined as what the value IS in the feature.
 *
 * `price` has no user in any profile today; it is widened with the other two because
 * it belongs to the same group and its formatter carries the same scalar branch.
 * Declaring it narrowly would leave the next `price` field to rediscover this.
 */
export interface AttributeWidgetPrimitive {
    action: "string";
    badge: "string" | "object";
    checkbox: "boolean" | "string[]";
    coordinates: "object";
    date: "string";
    dropdown: "string";
    email: "string";
    gallery: "string[]";
    hours: "object";
    image: "string";
    link: "string" | "object";
    list: "string[]";
    longtext: "string";
    metric: "number";
    number: "number";
    phone: "string";
    price: "string" | "object";
    radio: "string";
    rating: "number";
    reviews: "object[]";
    table: "object[]";
    tags: "string[]";
    text: "string";
    url: "string";
}

/**
 * The three reading surfaces, addressable one by one.
 *
 * A single "displayed yes/no" boolean is deliberately refused: it could not express
 * "this field in the side panel, but not in the hover tooltip".
 */
export type AttributeSurface = "tooltip" | "popup" | "sidepanel";

/**
 * How a value is turned into DOM on a reading surface.
 *
 * - `"rendered"` — the widget renderer for the declared `widget` produces the DOM.
 * - `"raw"` — the value is emitted as text, with no widget-specific formatting.
 *
 * There is deliberately no mode that delegates reading to `field-renderer`: capture
 * is that package's role, reading belongs to the core.
 */
export type AttributeDisplayMode = "rendered" | "raw";

/**
 * Visual emphasis applied to a field on a reading surface.
 *
 * These are the ONLY three values the render code branches on, out of the 29 the
 * legacy `FieldStyle` union declared. The other 26 produced neither a branch nor a
 * CSS class — measured, and the reason they are not carried over.
 *
 * `title` lifts the field into the heading position; `category` and `subcategory`
 * each carry a badge modifier that exists in the stylesheet.
 */
export type AttributeEmphasis = "title" | "category" | "subcategory";

/**
 * Presentation modifiers that belong to the SURFACE, not to the value.
 *
 * ⚠️ Deliberately not per-widget options. `accordion` and `hero` say nothing about
 * what a value IS or how it is formatted — they say where the rendered node lands in
 * the surface. Pushing them into `AttributeWidgetOptions` would duplicate them across
 * every widget and would let the whitelist confront them, which is meaningless.
 *
 * ⚠️ Added 02/08/2026, at the Sprint 2 pre-flight, because the frozen contract could
 * not express what the profiles on disk already declare — and the descriptor is
 * `additionalProperties: false`, so the migration would have failed validation rather
 * than degrade silently. That is the good failure mode; the gap was still real.
 */
export interface AttributeDisplayPresentation {
    /** Wraps the field in a collapsible section. Side panel only. */
    readonly accordion?: boolean;
    /** Whether that collapsible section starts open. Meaningless without `accordion`. */
    readonly defaultOpen?: boolean;
    /** Visual emphasis. See {@link AttributeEmphasis}. */
    readonly emphasis?: AttributeEmphasis;
    /**
     * Lifts an image out of the field flow, as a header image.
     *
     * Only meaningful on the `image` widget, and only on the side panel. The current
     * body is closed before the image is inserted — otherwise it would nest inside
     * the field flow instead of heading it.
     */
    readonly hero?: boolean;
}

/** The reading projection of a field. */
export interface AttributeDisplay {
    /** Defaults to `"rendered"` when omitted. */
    readonly mode?: AttributeDisplayMode;
    /** Surfaces this field appears on. An empty list hides the field everywhere. */
    readonly surfaces: readonly AttributeSurface[];
    /** Surface-level presentation modifiers. See {@link AttributeDisplayPresentation}. */
    readonly presentation?: AttributeDisplayPresentation;
}

/**
 * The capture projection of a field.
 *
 * Declaring `edit` on any field of a layer is what obliges that layer to declare
 * both its editability and its write target — a schema-level rule, not a property
 * of this object.
 *
 * ⚠️ It carried `required` ALONE until task 7.2, and that made it a stunted twin of
 * {@link AttributeDisplay}, which has overridden its presentation since Sprint 2. The
 * measurement that reopened it: {@link AttributeWidgetOptions} is indexed BY WIDGET, so
 * one `widget` slot admits exactly one typed options bag. `BadgeOptions` is
 * `{placeholder?}` and has nowhere to hold a choice list; `DropdownOptions` carries
 * `options`. Two projections needing two widgets therefore need two pairs — deriving the
 * capture widget from the display one by a hard-coded table could not have supplied
 * `sites_rosario.statut`'s three choices at all.
 *
 * Both members are OVERRIDES: absent, the capture reuses the field-level pair. That is
 * the case for 10 of the 11 fields migrated at 7.2, which is why they are optional.
 *
 * The two forms are disjoint on purpose — `options` without `widget` would be typed by
 * the READING widget, that is, by something other than what it configures. The JSON
 * schema states the same thing as `dependencies: { options: ["widget"] }`.
 */
export type AttributeEdit =
    | {
          /** When true, the capture form refuses an empty value. */
          readonly required?: boolean;
          readonly widget?: undefined;
          readonly options?: undefined;
      }
    | {
          [E in AttributeCaptureWidget]: {
              /** When true, the capture form refuses an empty value. */
              readonly required?: boolean;
              /** Capture widget, named because it differs from the reading one. */
              readonly widget: E;
              /** Options of the CAPTURE widget — typed by it, never by the reading one. */
              readonly options?: AttributeWidgetOptions[E];
          };
      }[AttributeCaptureWidget];

/** Value pre-filled from the drawn geometry rather than typed by the user. */
export type AttributeComputedSource =
    | "geometry.length"
    | "geometry.area"
    | "geometry.centroid"
    | "geometry.vertexCount";

/* -------------------------------------------------------------------------- */
/* Per-widget options — derived from the keys each component actually reads.   */
/* A key absent here is a key no component consumes.                          */
/* -------------------------------------------------------------------------- */

/** A single choice in a `dropdown`, `radio`, `checkbox` or `tags` widget. */
export interface AttributeChoice {
    readonly value: string;
    readonly label: string;
}

/** A column of a `table` widget. Columns belong to the layer, rows to the feature. */
export interface AttributeTableColumn {
    readonly key: string;
    readonly label: string;
}

/**
 * Options of the `action` widget.
 *
 * Every key here is derived from what `renderActionButton` actually reads — not from
 * the published prose, which is what E1b.3 nearly got wrong when it was about to
 * declare a dialect nothing dispatches on.
 */
export interface ActionOptions {
    /**
     * Identifier carried in the emitted event. **Opaque to the core** — it is never
     * interpreted, only forwarded.
     *
     * Required: an action field without it renders nothing at all.
     */
    readonly actionId: string;
    /** The button is NOT rendered when the named plugin is absent. */
    readonly requiresPlugin?: string;
    /** Literal confirmation text shown before the event is emitted. */
    readonly confirm?: string;
    /** i18n key of the confirmation text. Takes precedence over `confirm`. */
    readonly confirmKey?: string;
    /**
     * Whitelist of feature properties joined to the emitted event.
     *
     * ⚠️ Without it, NO property is joined. The default goes to confidentiality, not
     * convenience: `geoleaf:popup:action` is a document event that any script on the
     * page can listen to, so a "send everything" default would leak the whole
     * property bag.
     */
    readonly payloadFields?: readonly string[];
}

/** Options of the `badge` widget. */
export interface BadgeOptions {
    readonly placeholder?: string;
}

/** Options of the `checkbox` widget. */
export interface CheckboxOptions {
    /** When true the value is a `string[]` of checked choices, not a `boolean`. */
    readonly multiple?: boolean;
    readonly options?: readonly AttributeChoice[];
}

/**
 * Options of the `date` widget.
 *
 * `locale` is NEW — the component reads only `min` and `max` today. It is declared
 * here so the rendering slice has a key to honour, with the profile locale as the
 * fallback when a field does not set one.
 */
export interface DateOptions {
    readonly min?: string;
    readonly max?: string;
    readonly locale?: string;
}

/** Options of the `dropdown` widget. */
export interface DropdownOptions {
    readonly options?: readonly AttributeChoice[];
    /** Label of the empty entry shown when no choice is selected. */
    readonly emptyLabel?: string;
    /** Endpoint the choices are fetched from when they are not declared inline. */
    readonly fetchOptions?: string;
}

/** Options of the `gallery` widget. */
export interface GalleryOptions {
    readonly maxCount?: number;
    readonly maxSizeMb?: number;
    readonly uploadEndpoint?: string;
}

/** Options of the `hours` widget. */
export interface HoursOptions {
    /** Day the week starts on, as a three-letter lowercase code (e.g. `"mon"`). */
    readonly firstDay?: string;
}

/** Options of the `image` widget. */
export interface ImageOptions {
    readonly maxSizeMb?: number;
    readonly uploadEndpoint?: string;
}

/** Options of the `link` widget. */
export interface LinkOptions {
    /** When true the link text is the field label rather than the raw href. */
    readonly showLabel?: boolean;
}

/** Options of the `list` widget. */
export interface ListOptions {
    readonly addLabel?: string;
    readonly minItems?: number;
    readonly maxItems?: number;
    readonly ordered?: boolean;
}

/** Options of the `longtext` widget. */
export interface LongtextOptions {
    readonly maxLength?: number;
    readonly rows?: number;
    readonly placeholder?: string;
}

/** Options of the `metric` widget. */
export interface MetricOptions {
    readonly prefix?: string;
    readonly suffix?: string;
    readonly unit?: string;
}

/**
 * Options of the `number` widget.
 *
 * `format` is NEW — the component reads only `min`, `max` and `step` today. It is
 * declared here so integer / decimal presentation is a per-field choice, with the
 * profile as the fallback.
 */
export interface NumberOptions {
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly format?: "integer" | "decimal";
}

/** Options of the `price` widget. */
export interface PriceOptions {
    /** Currency codes offered by the capture form. */
    readonly currencies?: readonly string[];
}

/** Options of the `radio` widget. */
export interface RadioOptions {
    readonly options?: readonly AttributeChoice[];
}

/** Options of the `rating` widget. */
export interface RatingOptions {
    readonly maxStars?: number;
    readonly halfStars?: boolean;
}

/** Options of the `reviews` widget. */
export interface ReviewsOptions {
    readonly maxReviews?: number;
}

/** Options of the `table` widget. */
export interface TableOptions {
    readonly columns?: readonly AttributeTableColumn[];
    readonly maxRows?: number;
}

/** Options of the `tags` widget. */
export interface TagsOptions {
    readonly options?: readonly AttributeChoice[];
    readonly minTags?: number;
    readonly maxTags?: number;
    /** When true only values present in `options` are accepted. */
    readonly restricted?: boolean;
    readonly placeholder?: string;
}

/** Options of the `text` widget. */
export interface TextOptions {
    readonly maxLength?: number;
    readonly placeholder?: string;
}

/** Options of widgets reading a placeholder and nothing else. */
export interface PlaceholderOnlyOptions {
    readonly placeholder?: string;
}

/** Options accepted by each widget, keyed by widget identifier. */
export interface AttributeWidgetOptions {
    action: ActionOptions;
    badge: BadgeOptions;
    checkbox: CheckboxOptions;
    coordinates: Record<string, never>;
    date: DateOptions;
    dropdown: DropdownOptions;
    email: PlaceholderOnlyOptions;
    gallery: GalleryOptions;
    hours: HoursOptions;
    image: ImageOptions;
    link: LinkOptions;
    list: ListOptions;
    longtext: LongtextOptions;
    metric: MetricOptions;
    number: NumberOptions;
    phone: PlaceholderOnlyOptions;
    price: PriceOptions;
    radio: RadioOptions;
    rating: RatingOptions;
    reviews: ReviewsOptions;
    table: TableOptions;
    tags: TagsOptions;
    text: TextOptions;
    url: PlaceholderOnlyOptions;
}

/* -------------------------------------------------------------------------- */
/* The field descriptor                                                        */
/* -------------------------------------------------------------------------- */

/** The parts of a field descriptor that do not depend on its widget. */
export interface AttributeFieldBase {
    /** Dotted path to the value inside the feature (e.g. `"properties.statut"`). */
    readonly field: string;
    /** Human-readable label, shown on reading surfaces and in the capture form. */
    readonly label: string;
    /** Fills the value from the drawn geometry instead of from user input. */
    readonly computed?: AttributeComputedSource;
    /** Reading projection. Omitted when the field is capture-only. */
    readonly display?: AttributeDisplay;
    /** Capture projection. Omitted when the field is read-only. */
    readonly edit?: AttributeEdit;
}

/**
 * Widgets that have no capture counterpart at all, and on which declaring `edit` is
 * therefore a declaration error rather than an unimplemented feature.
 *
 * `action` is one: `field-renderer` registers no `action` component, and a button is
 * a gesture, not a value to type in. Q6 named it as such.
 *
 * ✅ **The `reviews` contradiction is SETTLED — task 7.2, 07/08/2026.** Q6 had named
 * `reviews` display-only while `field-renderer` registers a `reviews` capture component,
 * and the note here parked the arbitration for « the sprint that migrates the capture
 * projection ». That is this one. Verdict: **the code was right, Q6 was wrong** —
 * `src/types/reviews.ts` exports a `reviewsComponent` with a real `formRender`, so
 * `reviews` is capturable and stays OUT of this list. Nothing was narrowed; a claim that
 * no measurement supported was dropped.
 */
export type AttributeDisplayOnlyWidget = "action";

/**
 * The widgets a field can be CAPTURED with — every widget that has a component.
 *
 * Derived rather than written, so that adding a widget to {@link AttributeWidget} makes
 * it capturable by default and only an explicit display-only listing removes it. A
 * hand-written twin is the second declaration this contract exists to remove.
 *
 * ⚠️ NOT exported, deliberately. It is the index of {@link AttributeEdit}'s union and
 * nothing else — exporting it would add a public type no integrator asked for, on a
 * surface where the meaningful knob is {@link AttributeDisplayOnlyWidget}. The parity
 * guard ATTR-10 confronts it with the schema by reading BOTH source lists, so nothing
 * here depends on it being importable.
 */
type AttributeCaptureWidget = Exclude<AttributeWidget, AttributeDisplayOnlyWidget>;

/**
 * One field of a layer's `attributes` list.
 *
 * The union is built per widget so that `primitive` and `options` are both
 * constrained by the chosen `widget`: declaring `widget: "rating"` with
 * `primitive: "string"`, or with a `maxRows` option, does not type-check.
 *
 * A descriptor carrying neither `display` nor `edit` is refused by the schema — a field
 * that is neither read nor captured has no reason to be declared.
 *
 * ⚠️ A `uses` block of bindings to secondary subsystems lived here from 02/08 to 06/08/2026
 * and was REMOVED: it added a fourth list of field names without replacing any of the three
 * that existed then (`attributes.fields[]`, `table.columns[]`, `formSchema`), and two of the
 * five subsystems it bound to name no layer field at all. See A3‴ in
 * `roadmap_collecte-terrain-offline.md`. `formSchema` itself went at task 7.2 — two lists remain.
 *
 * Two per-widget refinements ride on the conditional types below:
 * - a display-only widget cannot carry `edit`;
 * - `action` requires its `options`, because `actionId` is what identifies the button
 *   and a field without it renders nothing at all.
 */
export type AttributeField = {
    [W in AttributeWidget]: AttributeFieldBase & {
        readonly widget: W;
        readonly primitive: AttributeWidgetPrimitive[W];
    } & (W extends "action"
            ? { readonly options: AttributeWidgetOptions[W] }
            : { readonly options?: AttributeWidgetOptions[W] }) &
        (W extends AttributeDisplayOnlyWidget ? { readonly edit?: undefined } : unknown);
}[AttributeWidget];

/**
 * The `attributes` block of a layer configuration.
 *
 * It lives at the root of the layer config rather than under `capabilities` so the
 * "a field in edition requires an editable layer" rule stays expressible in pure
 * JSON Schema, and so an entry can never outlive the layer it describes.
 */
export interface LayerAttributes {
    /** Field whose value titles the popup and the side panel. */
    readonly titleField?: string;
    /** The fields, in declaration order. */
    readonly fields: readonly AttributeField[];
}

/* -------------------------------------------------------------------------- */
/* Geometry vocabularies — two of them, deliberately named apart               */
/* -------------------------------------------------------------------------- */

/**
 * Geometry named in domain lowercase, as written by `geometry` and `geometryType`
 * in the layer configs.
 *
 * `polyline` and `line` are two spellings of the same shape, both present in the
 * profiles on disk.
 */
export type GeometryDomainName = "point" | "line" | "polyline" | "polygon";

/**
 * Geometry named in canonical GeoJSON casing, as written by `editableGeometryTypes`
 * and as returned by the editor when it maps a drawing mode back to a type.
 *
 * ⚠️ The two vocabularies are NOT interchangeable, and confusing them is not
 * theoretical: a layer declaring `["point"]` in domain lowercase never matches the
 * canonical `"Point"` the editor produces, and drops out of the edition picker with
 * no error. They are kept as separate types so a conversion is always explicit.
 */
export type GeometryCanonicalType = "Point" | "LineString" | "Polygon";
