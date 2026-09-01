/*!
 * @geoleaf/field-renderer — Public API surface
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

// ── Contracts & types ────────────────────────────────────────────────────────
export type { FieldConfig, RenderCtx, MapLayerHint, ComponentDefinition } from "./contract.js";

// ── Component registry ───────────────────────────────────────────────────────
export { ComponentRegistry } from "./registry.js";
export { registerBuiltinComponents, builtinComponentIds } from "./builtins.js";

// ── Validators namespace ─────────────────────────────────────────────────────
export * as validators from "./validators.js";

// ── Field component types (23) ───────────────────────────────────────────────
export { badgeComponent } from "./types/badge.js";
export { checkboxComponent } from "./types/checkbox.js";
export { coordinatesComponent } from "./types/coordinates.js";
export { dateComponent } from "./types/date.js";
export { dropdownComponent } from "./types/dropdown.js";
export { emailComponent } from "./types/email.js";
export { galleryComponent } from "./types/gallery.js";
export { hoursComponent } from "./types/hours.js";
export { imageComponent } from "./types/image.js";
export { linkComponent } from "./types/link.js";
export { listComponent } from "./types/list.js";
export { longtextComponent } from "./types/longtext.js";
export { metricComponent } from "./types/metric.js";
export { numberComponent } from "./types/number.js";
export { phoneComponent } from "./types/phone.js";
export { priceComponent } from "./types/price.js";
export { radioComponent } from "./types/radio.js";
export { ratingComponent } from "./types/rating.js";
export { reviewsComponent } from "./types/reviews.js";
export { tableComponent } from "./types/table.js";
export { tagsComponent } from "./types/tags.js";
export { textComponent } from "./types/text.js";
export { urlComponent } from "./types/url.js";

// ── UI ───────────────────────────────────────────────────────────────────────
export { createResponsiveModal } from "./ui/responsive-modal.js";
export type {
    ResponsiveModal,
    ResponsiveModalOptions,
    ModalOpenOptions,
    HeaderSlot,
} from "./ui/responsive-modal.js";
// ── `createFocusTrap` and `confirmDialog` are GONE ──
//
// They now live in `@geoleaf/host-runtime`, which owns the UI plumbing. This
// package owns INPUT, and nothing else.
//
// ⚠️ **No compatibility re-export, deliberately** ("no legacy, no migration,
// no deprecation") — the application has no users, an alias would be code to
// write, test and later delete for zero beneficiaries. A direct breaking
// change, owned as such.

// ── Bridge ───────────────────────────────────────────────────────────────────
export { createFieldRendererBridge } from "./field-renderer-bridge.js";
export type { FieldRendererBridge } from "./field-renderer-bridge.js";

// ── DOM helpers ──────────────────────────────────────────────────────────────
export { _el, _getLabel } from "./helpers.js";

// ── Security ─────────────────────────────────────────────────────────────────
export { escapeHtml, validateUrl, safeUrl } from "./sanitize.js";

// ── Image upload strategy ───────────────────────────────────────────────────
// The only exported member of `types/field-media.ts`: the rest is internal
// there. It is exported because a host must be able to change the TRANSPORT
// without cloning the component.
export { setImageUploadStrategy } from "./types/field-media.js";
export type { ImageUploadStrategy } from "./types/field-media.js";
