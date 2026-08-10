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
// ── Décision W3 / A4″ (Sprint 6, S6b) — `createFocusTrap` et `confirmDialog` sont PARTIS ──
//
// Ils vivent désormais dans `@geoleaf/host-runtime`, qui possède la plomberie UI. Ce paquet
// possède la SAISIE, et rien d'autre.
//
// ⚠️ **Aucun ré-export de compatibilité, délibérément** : A16 (« aucun legacy, aucune
// migration, aucune dépréciation ») — l'application n'a pas d'utilisateurs, un alias serait
// du code à écrire, tester et supprimer plus tard pour zéro bénéficiaire. C'est un cassant
// direct, et il est assumé comme tel.

// ── Bridge ───────────────────────────────────────────────────────────────────
export { createFieldRendererBridge } from "./field-renderer-bridge.js";
export type { FieldRendererBridge } from "./field-renderer-bridge.js";

// ── DOM helpers ──────────────────────────────────────────────────────────────
export { _el, _getLabel } from "./helpers.js";

// ── Security ─────────────────────────────────────────────────────────────────
export { escapeHtml, validateUrl, safeUrl } from "./sanitize.js";

// ── Stratégie de téléversement d'image (tâche 5.1-d) ────────────────────────
// Seul membre de `types/field-media.ts` exporté : le reste y est interne. Il l'est
// parce qu'un hôte doit pouvoir changer le TRANSPORT sans cloner le composant.
export { setImageUploadStrategy } from "./types/field-media.js";
export type { ImageUploadStrategy } from "./types/field-media.js";
