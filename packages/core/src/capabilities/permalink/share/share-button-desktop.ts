/*!
 * GeoLeaf Core — Share / Desktop button helper
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * Builds and inserts the "Share" icon button at the bottom of the desktop
 * tab strip, immediately above the theme toggle. Mirrors the pattern used by
 * {@link desktop-panel-theme.appendThemeToggleToTabs}.
 *
 * Visibility is controlled by `modules.permalink.share.enabled` (default `true`, opt-out).
 * The button dispatches `geoleaf:toolbar:action` with `action: "share"` so the
 * same `ShareLifecycle` handler used by the mobile pill reacts.
 */

import { DOMSecurity } from "../../../kernel/security/index.js";
import { getLabel } from "../../../utils/i18n/i18n.js";
import { getShareConfig } from "./config.js";

/**
 * Builds the desktop share button. Same dimensions / classes as the theme
 * toggle (`.gl-rp-theme-toggle` → reused via `.gl-rp-share-btn` mirror).
 */
function buildShareButton(): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gl-rp-tab-btn gl-rp-share-btn";
    btn.setAttribute("data-gl-toolbar-action", "share");
    // Share glyph from the shared registry (DOMSecurity.SVG_ICONS.share) — the single
    // source of the geometry (a capability must not import the app/ copy).
    const svg = DOMSecurity.getIcon("share", 18, {
        stroke: "currentColor",
        strokeWidth: "2",
        fill: "none",
    });
    if (svg) btn.appendChild(svg);
    const label = getLabel("share.toolbar.button");
    btn.setAttribute("aria-label", label);
    btn.title = label;
    // ⚠️ Émission BRUTE, et non `dispatchToolbarAction()` — décision de l'API publique S3.3,
    // prise après l'avoir substituée puis annulée.
    //
    // C'est le seul des 3 déclencheurs de toolbar à ne pas passer par la fabrique canonique
    // (`mobile-toolbar.ts:191` et `desktop-panel-slots.ts:81` l'appellent). Le passage par
    // le helper est pourtant refusé ici : `toolbar-dispatch.ts` n'est ni un barrel, ni un
    // `*-seam.ts`, ni un `*-types.ts`, donc l'importer depuis `capabilities/` viole la
    // frontière `no-restricted-imports` du backlog R.8 — ESLint l'a dit, ce n'est pas une
    // supposition. Et passer par le barrel `kernel/ui/index.js` tirerait `components.js`,
    // `pill-search.js` et `theme.js` dans la clôture de la capacité permalink : un coût de
    // bundle réel pour une déduplication sans effet fonctionnel.
    //
    // La divergence est donc inerte et mesurée : la seule chose que le helper ajoute est la
    // branche lazy, et `share` est une capacité in-core qui n'est jamais lazy. Rendre
    // `toolbar-dispatch` importable en le qualifiant de seam est la vraie correction — elle
    // relève d'un arbitrage de couche, pas de ce sprint. Versée au backlog.
    btn.addEventListener("click", () => {
        document.dispatchEvent(
            new CustomEvent("geoleaf:toolbar:action", {
                detail: { action: "share", element: btn },
                bubbles: false,
            })
        );
    });
    return btn;
}

/**
 * Inserts the share button at the bottom of the tab strip, above the
 * existing theme toggle. Idempotent.
 *
 * Suppressed when `modules.permalink.share.enabled === false` in the active profile.
 */
export function appendShareButtonToTabs(tabs: HTMLElement): void {
    if (tabs.querySelector(".gl-rp-share-btn")) return;
    // Suppressed when the share capability is disabled (modules.permalink.share.enabled: false).
    if (!getShareConfig().enabled) return;
    const btn = buildShareButton();
    // Insert just before the theme toggle so the bottom stack reads:
    //   …tabs… │ separator │ share │ theme-toggle
    const themeToggle = tabs.querySelector(".gl-rp-theme-toggle");
    if (themeToggle) {
        tabs.insertBefore(btn, themeToggle);
    } else {
        tabs.appendChild(btn);
    }
}

/**
 * Detaches every share button this capability injected (teardown counterpart of
 * {@link appendShareButtonToTabs}).
 *
 * Queries the whole document rather than a caller-supplied strip on purpose: the
 * button is injected into a container the capability does NOT own, from two
 * different entry points (the `tabs-ready` seam and the `init()` catch-up), and a
 * teardown must not depend on the caller still holding the right strip. `.gl-rp-share-btn`
 * is the capability's own class, so the selector cannot claim anything else.
 *
 * Removing the element is also what releases its click listener — the listener is a
 * closure with no handle to unsubscribe with, and it dies with the node.
 */
export function removeShareButtonsFromDocument(): void {
    if (typeof document === "undefined") return;
    document.querySelectorAll(".gl-rp-share-btn").forEach((btn) => btn.remove());
}
