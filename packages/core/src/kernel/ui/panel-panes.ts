/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Registry of **hostable panes** — the seam that lets something outside the kernel own a
 * panel surface without the kernel naming it.
 *
 * ## Why this exists
 *
 * The two panel hosts had their contents frozen in three independent literals: the desktop
 * panel's `["filters", "layers", "legend"]` (twice — tabs and panes) and the mobile sheet's
 * allow-list. Nothing could add a fourth. `plugins/table` had already hit the wall and worked
 * around it by setting `id = "gl-rp-pane-table"` on a panel of its own, purely to satisfy an
 * `aria-controls` pointing at a pane that does not exist.
 *
 * 🛑 **The three built-in panes are deliberately NOT migrated here.** They are configured
 * differently on each side — the desktop reads `showFilters`/`showLayers`/`showLegend` and
 * three title options, the sheet reads `getDefaultSheetTitles()` — and folding two shapes into
 * one registry would have meant rewriting both hosts to prove a symmetry neither of them
 * needs. The hosts therefore CONCATENATE: their own built-ins first, then whatever is
 * registered here. The two sets are disjoint by construction, so there is no second source of
 * truth for the same pane — which is the failure this arrangement is chosen to avoid.
 *
 * ## Why hosts register themselves
 *
 * A pane must open at every width: the desktop panel only exists at ≥1440px, and below that
 * the same content belongs in the mobile sheet. A caller — a plugin reacting to a click on a
 * POI — cannot be asked to know which. So the hosts declare themselves here, and
 * {@link openPane} picks the first one that is live. Nothing in this module imports either
 * host, which is what keeps the dependency arrow pointing one way.
 */

/** A panel surface some module owns, offered to whichever host is live. */
export interface PanelPane {
    /**
     * Pane identifier. Becomes the desktop tab id (`gl-rp-tab-<id>`), the pane id
     * (`gl-rp-pane-<id>`) and the mobile sheet id — so it must be usable in a DOM id and in an
     * attribute selector.
     */
    readonly id: string;
    /** i18n key resolved at render time — never a literal, so the tab follows the language. */
    readonly labelKey: string;
    /**
     * CSS selector for the element the host adopts.
     *
     * ⚠️ The host MOVES this node rather than cloning it: one node, one set of listeners, and
     * it is put back where it came from on close. A selector matching several elements takes
     * the first.
     */
    readonly selector: string;
    /** Sort order among registered panes. Lower comes first. @default 0 */
    readonly order?: number;
    /**
     * Called by the host just before it adopts the element, every time the pane is shown.
     *
     * 🛑 This is how a pane gets BUILT ON DEMAND, and without it the registry is close to
     * useless: an owner that constructs its panel on first use — the normal case, since
     * building DOM nobody has asked for is waste — has no way of learning that its tab was
     * clicked. Measured in the browser before this existed: the tab was there, it activated,
     * and it showed an empty pane, because the only thing that ever built the panel was the
     * plugin's own toolbar action.
     *
     * ⚠️ Must be idempotent: it fires on every open, not only the first.
     */
    onOpen?(): void;
}

/** A surface able to display a pane — the desktop panel, or the mobile sheet. */
export interface PaneHost {
    /** Host identifier, for diagnostics and idempotent re-registration. */
    readonly id: string;
    /**
     * Order of consultation among live hosts. Lower is asked first. @default 0
     *
     * 🛑 **Explicit, because registration order is NOT something either host controls.** It
     * had been left implicit, with a comment asserting the desktop panel registered first —
     * and the comment was simply false: hosts register when their module is imported, and
     * `globals.ui.ts` imports the mobile toolbar before the desktop panel. Measured in a real
     * browser at 1600px: `openPane` answered `true` and `getOpenPanel()` answered `null`,
     * because the full-screen sheet had opened over a desktop that has a side panel.
     */
    readonly priority?: number;
    /** Whether this host is currently live — the desktop panel is not, below its breakpoint. */
    isActive(): boolean;
    /** Shows the pane. Returns `false` when this host does not know it. */
    open(paneId: string): boolean;
    /** Closes whatever this host is showing. */
    close(): void;
    /**
     * Rebuilds this host from the current pane list.
     *
     * ⚠️ Optional but load-bearing: a plugin may register its pane AFTER the host was built —
     * the bundle load order is not something either side controls. Without this, such a pane
     * would exist in the registry and nowhere on screen, silently.
     */
    sync?(): void;
}

const _panes = new Map<string, PanelPane>();

/**
 * Hosts, in the order they are consulted.
 *
 * ⚠️ Order is registration order, and the desktop panel registers first — deliberately. Both
 * hosts can be live at once at ≥1440px (the mobile pill is only hidden by CSS, it is still
 * built), and opening a full-screen sheet on a desktop that has a side panel would be the
 * wrong one of the two.
 */
const _hosts: PaneHost[] = [];

/**
 * Registers a pane, or replaces the one already under that id.
 *
 * Idempotent by id, because a module may re-register across a destroy/recreate cycle and the
 * second registration must not double the tab.
 *
 * @param pane - The pane to offer to the hosts.
 */
export function registerPanelPane(pane: PanelPane): void {
    if (!pane?.id || !pane.selector || !pane.labelKey) return;
    _panes.set(pane.id, pane);
    for (const host of _hosts) host.sync?.();
}

/**
 * Every registered pane, ordered.
 *
 * @returns The panes, sorted by `order` ascending; those without one keep registration order
 *          and land after the ordered ones (`Array.prototype.sort` is stable per spec).
 */
export function listPanelPanes(): readonly PanelPane[] {
    return [..._panes.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * One registered pane.
 *
 * @param id - The pane identifier.
 * @returns The pane, or `undefined` when nothing is registered under that id.
 */
export function getPanelPane(id: string): PanelPane | undefined {
    return _panes.get(id);
}

/**
 * Lets a registered pane build itself, just before a host adopts it.
 *
 * Called by every host on every open. A throw is swallowed: an owner that fails to build is a
 * defect in that owner, and taking the whole panel — legend and layers included — down with it
 * would be a worse answer than an empty tab.
 *
 * @param id - The pane about to be shown.
 */
export function preparePane(id: string): void {
    const pane = _panes.get(id);
    if (!pane?.onOpen) return;
    try {
        pane.onOpen();
    } catch {
        // Owner's problem, and it already has the panel to say so in.
    }
}

/**
 * Registers a host. Idempotent by host id.
 *
 * @param host - The surface offering to display panes.
 */
export function registerPaneHost(host: PaneHost): void {
    if (!host?.id) return;
    const existing = _hosts.findIndex((h) => h.id === host.id);
    // ⚠️ `splice` and not `_hosts[existing] = host`. The index is numeric and comes from
    // `findIndex`, so it is safe in fact — but `check-dynamic-key-writes` reads the SHAPE of
    // the write, not its provenance, and it is right to: an assignment through a computed key
    // is the sink this repository refuses to have to reason about case by case.
    if (existing === -1) _hosts.push(host);
    else _hosts.splice(existing, 1, host);
}

/**
 * Opens a registered pane on whichever host is live.
 *
 * This is the entry point a plugin calls: it does not know, and must not have to know, whether
 * the current width puts its content in the desktop panel or in the mobile sheet.
 *
 * @param paneId - The pane to show.
 * @returns `true` when a host displayed it, `false` when none could.
 */
export function openPane(paneId: string): boolean {
    _pendingOpen = null;
    if (tryOpen(paneId)) return true;
    // 🛑 No host is live YET — and that is a real state, not a caller error. Both hosts are
    // built during boot: the sheet by `initMobileToolbar`, the side panel by
    // `initDesktopPanel`. Measured on the deployed build: at the moment the routing plugin
    // finishes loading, `.gl-sheet-overlay`, `#gl-right-panel` AND `.gl-map-toolbar` are all
    // still absent. Without what follows the pane stayed `display:none` FOREVER — four seconds
    // later it was still hidden — so a user clicking early never saw their panel, and nothing
    // anywhere said why.
    schedulePendingOpen(paneId);
    return false;
}

/**
 * Asks each live host, in priority order.
 *
 * @param paneId - The pane to show.
 * @returns Whether one of them displayed it.
 */
function tryOpen(paneId: string): boolean {
    for (const host of liveHosts()) {
        if (host.open(paneId)) return true;
    }
    return false;
}

/** The open request waiting for a host, if any. */
let _pendingOpen: string | null = null;

/**
 * How many animation frames a pending open keeps trying.
 *
 * ⚠️ Bounded, and short. This retries an open across the tail of boot — roughly a second at
 * 60fps — not indefinitely: a pane that opened ten seconds after the click would land on a user
 * who has moved on, which is worse than not opening at all.
 */
const PENDING_OPEN_FRAMES = 60;

/**
 * Retries an open until a host is live, or the budget runs out.
 *
 * ⚠️ ONE pending request at a time, the latest winning: two rapid clicks on different panes must
 * not race to open both, one over the other.
 *
 * @param paneId - The pane to show.
 */
function schedulePendingOpen(paneId: string): void {
    if (typeof requestAnimationFrame !== "function") return;
    _pendingOpen = paneId;
    let frames = 0;
    const attempt = (): void => {
        // Superseded by a later call, or already satisfied — either way, stop.
        if (_pendingOpen !== paneId) return;
        if (tryOpen(paneId)) {
            _pendingOpen = null;
            return;
        }
        if (++frames >= PENDING_OPEN_FRAMES) {
            _pendingOpen = null;
            return;
        }
        requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
}

/**
 * The live hosts, most specific first.
 *
 * @returns The hosts whose `isActive()` answers true, ordered by `priority`.
 */
function liveHosts(): PaneHost[] {
    return _hosts.filter((h) => h.isActive()).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}

/** Closes the pane on every live host. */
export function closePane(): void {
    for (const host of liveHosts()) host.close();
}

/**
 * Drops every registered pane. The HOSTS stay.
 *
 * 🛑 **Panes only, and the asymmetry is load-bearing.** A host registers once, at module
 * import, and answers `isActive()` about a panel it may or may not still have — that is
 * precisely what the predicate is for. Clearing the hosts too would leave a `Core.destroy()`
 * followed by a `Core.create()` with no host at all, because nothing re-imports the module:
 * every later `openPane` would answer `false`, and the panel would simply never open again.
 *
 * ⚠️ Written the other way round first, with a plausible rationale about hosts closing over
 * torn-down state. The registry test caught it — three cases red — which is the only reason
 * it is not in the shipped bundle.
 */
export function clearPanelPanes(): void {
    _panes.clear();
    _pendingOpen = null;
}
