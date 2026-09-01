/*!
 * @geoleaf/field-renderer — built-in component registration
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * `ComponentRegistry` is a MODULE SINGLETON: whichever plugin loads first fills it, and
 * every other consumer reads the same map. Before this file existed, each host registered
 * its own subset by hand — `plugin-editor` all 23, `plugin-addpoi` 10 — so the set of
 * field types a form could render depended on WHICH PLUGINS WERE LOADED, not on the
 * profile. An addpoi form saw 23 types when the editor happened to be loaded and 10 when
 * it was not, and nothing failed loudly: an unknown type silently falls back to `text`
 * (`modal-bridge.ts`: `ComponentRegistry.get(field.type) ?? ComponentRegistry.get("text")`).
 *
 * Hosts call `registerBuiltinComponents()` instead. It is idempotent, and registering the
 * same id twice is a documented overwrite, so calling it from several plugins is safe.
 * https://geoleaf.dev
 */
import type { ComponentDefinition } from "./contract.js";
import { ComponentRegistry } from "./registry.js";

import { badgeComponent } from "./types/badge.js";
import { checkboxComponent } from "./types/checkbox.js";
import { coordinatesComponent } from "./types/coordinates.js";
import { dateComponent } from "./types/date.js";
import { dropdownComponent } from "./types/dropdown.js";
import { emailComponent } from "./types/email.js";
import { galleryComponent } from "./types/gallery.js";
import { hoursComponent } from "./types/hours.js";
import { imageComponent } from "./types/image.js";
import { linkComponent } from "./types/link.js";
import { listComponent } from "./types/list.js";
import { longtextComponent } from "./types/longtext.js";
import { metricComponent } from "./types/metric.js";
import { numberComponent } from "./types/number.js";
import { phoneComponent } from "./types/phone.js";
import { priceComponent } from "./types/price.js";
import { radioComponent } from "./types/radio.js";
import { ratingComponent } from "./types/rating.js";
import { reviewsComponent } from "./types/reviews.js";
import { tableComponent } from "./types/table.js";
import { tagsComponent } from "./types/tags.js";
import { textComponent } from "./types/text.js";
import { urlComponent } from "./types/url.js";

/**
 * The 23 built-in field components, in `index.ts` export order.
 *
 * Typed `ComponentDefinition<unknown>[]` — the same type the registry stores internally,
 * and the annotation is what makes the list compile at all. PLUGINS S4 tried a `forEach`
 * over a bare literal and reverted: with no annotation the array widens to a UNION of 23
 * instantiations, and `register<TValue>` cannot pick one `TValue` that satisfies it.
 *
 * Annotating with `unknown` works where `never` does not, because `TValue` appears in
 * both variances: `defaults?: TValue` is covariant (so the bound must be a SUPERtype —
 * `never` fails here), while `formRender(value: TValue, …)` is contravariant but
 * declared as a METHOD, and method parameters stay bivariant even under
 * `strictFunctionTypes`. `unknown` therefore satisfies both, with no cast.
 *
 * ⚠️ This paragraph cited `sidepanelRender` as the contravariant example
 * until 06/08/2026: it has since been removed from the contract. The
 * reasoning is **unchanged** — `formRender` holds exactly the same position
 * —, only the example had to follow. Found at the closure check, not at the
 * removal itself.
 */
const BUILTIN_COMPONENTS: ComponentDefinition<unknown>[] = [
    badgeComponent,
    checkboxComponent,
    coordinatesComponent,
    dateComponent,
    dropdownComponent,
    emailComponent,
    galleryComponent,
    hoursComponent,
    imageComponent,
    linkComponent,
    listComponent,
    longtextComponent,
    metricComponent,
    numberComponent,
    phoneComponent,
    priceComponent,
    radioComponent,
    ratingComponent,
    reviewsComponent,
    tableComponent,
    tagsComponent,
    textComponent,
    urlComponent,
];

/**
 * Registers every built-in field component on the shared {@link ComponentRegistry}.
 *
 * Call once, early, from each plugin that renders forms — before the first modal opens.
 * Idempotent: re-registering an id overwrites it with the same definition. Register your
 * own components AFTER this call if you mean to override a built-in id.
 */
export function registerBuiltinComponents(): void {
    for (const def of BUILTIN_COMPONENTS) {
        ComponentRegistry.register(def);
    }
}

/** Ids of the built-in components, for tests and diagnostics. */
export function builtinComponentIds(): string[] {
    return BUILTIN_COMPONENTS.map((d) => d.id);
}
