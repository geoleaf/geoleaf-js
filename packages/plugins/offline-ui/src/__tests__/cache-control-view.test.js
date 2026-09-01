/**
 * CacheControl — view layer: DOM, state, events.
 *
 * ## Where this file comes from
 *
 * It replaces `packages/core/__tests__/ui/cache-button.test.js` (725 l., 30
 * tests), since deleted. That file lived in the **core** and tested a control
 * that lives in **this package**; it imported no module and redefined in each
 * test the function it claimed to verify:
 *
 * ```js
 * const openCacheModal = () => { const m = document.getElementById("gl-cache-modal");
 *                                if (m) m.style.display = "flex"; };
 * openCacheModal();
 * expect(modal.style.display).toBe("flex");   // verifies the 3 lines above
 * ```
 *
 * Thirty green tests, zero production line covered. The scenarios, however, were
 * right — it was indeed `CacheControl`'s behaviour they described. They are
 * replayed here against the real code: `gl-cache-control__header`,
 * `gl-cache-control__body` and `_updateStatus` are no longer simulated, they are
 * exercised.
 *
 * ## What is targeted, and why these three modules
 *
 * `cache-control-dom.ts`, `cache-control-state.ts` and `cache-control-events.ts`
 * were at **0%** coverage (~600 l.), while `modal-manager.ts` — which the core's
 * test also simulated — is already at 91.66% via `cache-button.test.js`. The
 * hole was here.
 *
 * ⚠️ **We do NOT import `../cache/cache-control.js`**: `vitest.config.ts`
 * aliases it to `__mocks__/empty-module.js`
 * (`^(\.\.\/)+sync\/cache-control\.(js|ts)$`), and an import from
 * `src/__tests__/` matches that pattern. The assembler is thus not testable from
 * here; its three sub-modules are, and they carry all the logic.
 */
"use strict";

import { buildStructure } from "../cache/cache-control-dom.js";
import {
    updateStatus,
    updateProgress,
    updateClearProgress,
    handleCancelled,
} from "../cache/cache-control-state.js";
import {
    attachEventListeners,
    handleLayersToggle,
    handleStatusToggle,
    toggleCollapsed,
    cleanup,
} from "../cache/cache-control-events.js";

// The tests plant `GeoLeaf.Storage` the way PRODUCTION does. They used to drive
// `StorageContract.init()`, i.e. a SECOND instance of the singleton the bundle
// embedded and nothing initialised: they validated a dead channel.
function _installGeoLeafStorage(api) {
    globalThis.GeoLeaf = globalThis.GeoLeaf ?? {};
    // The helper reproduces what `StorageContract.init()` provided, because the
    // core's facade provides it too: `isPluginLoaded()` = "an engine registered",
    // and `isAvailable()` = "and its database is open". The plugin's adapter
    // DELEGATES these two methods — it does not recompute them — so a planted
    // object not carrying them would return `false` where the test expects
    // `true`. A caller providing them keeps the hand.
    globalThis.GeoLeaf.Storage =
        api === null || api === undefined
            ? null
            : {
                  isPluginLoaded: () => true,
                  isAvailable: () => !!api.DB,
                  ...api,
              };
    return api;
}

// ─── State factory ──────────────────────────────────────────────────────────────
//
// Reproduces what `createCacheControl()` builds in `cache-control.ts`: the
// delegations are spies, which makes WHO calls WHAT observable without loading
// the assembler (unreachable, cf. the header warning).

function makeSelf(options = {}) {
    const self = {
        options: {
            position: options.position || "topright",
            collapsed: options.collapsed || false,
            collapsible: options.collapsible !== false,
        },
        _eventCleanups: [],
        _map: null,
        _container: document.createElement("div"),
        _bodyEl: null,
        _toggleBtn: null,
        _layersContent: null,
        _layersToggleBtn: null,
        _statusToggleBtn: null,
        _downloadBtn: null,
        _clearBtn: null,
        _stopBtn: null,
        _progressEl: null,
        _progressFill: null,
        _progressText: null,
    };
    self._container.className = "gl-cache-control";
    self._updateStatus = vi.fn().mockResolvedValue(undefined);
    self._populateLayerSelection = vi.fn().mockResolvedValue(undefined);
    self._attachEventListeners = vi.fn();
    // `cache-control-types.ts` declares _handleDownload and _handleClear as
    // `Promise<void>` and _handleStop as `void`. The doubles must honour that: a bare
    // vi.fn() returns undefined, and the caller attaches .catch() to the two async ones.
    // Faithfulness matters here — an unfaithful double is what let a floating promise
    // live in attachEventListeners unnoticed until Q1.4 posed the rule.
    self._handleDownload = vi.fn(() => Promise.resolve());
    self._handleClear = vi.fn(() => Promise.resolve());
    self._handleStop = vi.fn();
    self._handleLayersToggle = vi.fn();
    self._handleStatusToggle = vi.fn();
    self._handleCancelled = vi.fn();
    self._toggleCollapsed = vi.fn();
    self._updateProgress = vi.fn();
    self._updateClearProgress = vi.fn();
    self._cleanup = vi.fn();
    return self;
}

/** Mounts the structure in the document — `updateStatus` reads via `getElementById`. */
function mount(self) {
    document.body.appendChild(self._container);
    buildStructure(self);
    return self;
}

beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

// ─── Structure DOM ──────────────────────────────────────────────────────────────

describe("buildStructure — squelette", () => {
    test("construit wrapper, en-tête et corps", () => {
        const self = mount(makeSelf());

        expect(self._container.querySelector(".gl-cache-control__wrapper")).not.toBeNull();
        expect(self._container.querySelector(".gl-cache-control__header")).not.toBeNull();
        expect(self._bodyEl).not.toBeNull();
        expect(self._bodyEl.className).toBe("gl-cache-control__body");
    });

    test("le titre porte l'icône et le libellé", () => {
        const self = mount(makeSelf());
        const title = self._container.querySelector(".gl-cache-control__title");

        expect(title.querySelector(".gl-cache-control__icon")).not.toBeNull();
        expect(title.textContent).toContain("Offline Cache");
    });

    test("un clic sur l'en-tête ne remonte pas jusqu'à la carte", () => {
        const self = mount(makeSelf());
        const onMap = vi.fn();
        document.body.addEventListener("click", onMap);

        self._container.querySelector(".gl-cache-control__header").click();

        expect(onMap).not.toHaveBeenCalled();
        document.body.removeEventListener("click", onMap);
    });

    test("collapsible:true pose le bouton de repli", () => {
        const self = mount(makeSelf({ collapsible: true }));

        expect(self._toggleBtn).not.toBeNull();
        expect(self._toggleBtn.type).toBe("button");
        expect(self._toggleBtn.getAttribute("aria-label")).toBe("Toggle cache");
    });

    test("collapsible:false ne le pose pas", () => {
        const self = mount(makeSelf({ collapsible: false }));

        expect(self._toggleBtn).toBeNull();
        expect(self._container.querySelector(".gl-cache-control__toggle")).toBeNull();
    });

    test("le bouton de repli délègue à _toggleCollapsed sans remonter", () => {
        const self = mount(makeSelf());
        const onMap = vi.fn();
        document.body.addEventListener("click", onMap);

        self._toggleBtn.click();

        expect(self._toggleCollapsed).toHaveBeenCalledTimes(1);
        expect(onMap).not.toHaveBeenCalled();
        document.body.removeEventListener("click", onMap);
    });

    test("collapsed:true marque le conteneur dès la construction", () => {
        const self = mount(makeSelf({ collapsed: true }));

        expect(self._container.classList.contains("gl-cache-control--collapsed")).toBe(true);
    });

    test("collapsed:false ne le marque pas", () => {
        const self = mount(makeSelf({ collapsed: false }));

        expect(self._container.classList.contains("gl-cache-control--collapsed")).toBe(false);
    });

    test("branche les écouteurs en fin de construction", () => {
        const self = mount(makeSelf());

        expect(self._attachEventListeners).toHaveBeenCalledTimes(1);
    });

    test("réclame un premier statut en différé", async () => {
        vi.useFakeTimers();
        try {
            const self = makeSelf();
            document.body.appendChild(self._container);
            buildStructure(self);

            expect(self._updateStatus).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(100);
            expect(self._updateStatus).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    test("un premier statut en échec n'abat pas la construction", async () => {
        vi.useFakeTimers();
        try {
            const self = makeSelf();
            self._updateStatus = vi.fn().mockRejectedValue(new Error("CacheManager absent"));
            document.body.appendChild(self._container);

            expect(() => buildStructure(self)).not.toThrow();
            await expect(vi.advanceTimersByTimeAsync(100)).resolves.not.toThrow();
        } finally {
            vi.useRealTimers();
        }
    });
});

// ─── Section STATUT ─────────────────────────────────────────────────────────────

describe("buildStructure — section STATUT", () => {
    test("pose les 4 lignes de statut avec leurs valeurs par défaut", () => {
        mount(makeSelf());

        expect(document.getElementById("gl-cache-profile").textContent).toBe("-");
        expect(document.getElementById("gl-cache-state").textContent).toBe("Not downloaded");
        expect(document.getElementById("gl-cache-size").textContent).toBe("0 MB");
        expect(document.getElementById("gl-cache-quota").textContent).toBe("0 MB available");
    });

    test("le bloc de statut est ouvert par défaut", () => {
        const self = mount(makeSelf());
        const info = self._bodyEl.querySelector(".gl-cache-status__info");

        expect(info.style.display).toBe("block");
    });

    test("le bouton de repli du statut est accessible", () => {
        const self = mount(makeSelf());

        expect(self._statusToggleBtn.getAttribute("aria-label")).toBe("Toggle status");
        expect(self._statusToggleBtn.textContent).toBe("▼");
    });
});

// ─── Sections CONFIG / ZONE / actions / progression ─────────────────────────────

describe("buildStructure — sections et actions", () => {
    test("pose l'accordéon CONFIG, ouvert, avec son remplissage d'attente", () => {
        const self = mount(makeSelf());

        expect(self._layersContent.style.display).toBe("block");
        expect(self._layersContent.querySelector(".gl-cache-layers__loading").textContent).toBe(
            "Loading layers..."
        );
        expect(self._layersToggleBtn.getAttribute("aria-label")).toBe("Toggle configuration");
    });

    test("pose l'accordéon ZONE", () => {
        const self = mount(makeSelf());

        expect(self._bodyEl.querySelector(".gl-cache-zone")).not.toBeNull();
        expect(self._zoneToggleBtn).not.toBeNull();
        expect(self._zoneSummaryEl).not.toBeNull();
    });

    test("l'avertissement est posé masqué", () => {
        mount(makeSelf());
        const warning = document.getElementById("gl-cache-warning");

        expect(warning).not.toBeNull();
        expect(warning.style.display).toBe("none");
    });

    test("pose les boutons Télécharger et Vider, ce dernier désactivé", () => {
        const self = mount(makeSelf());

        expect(self._downloadBtn.id).toBe("gl-cache-download");
        expect(self._downloadBtn.querySelector(".gl-btn__text").textContent).toBe(
            "Download profile"
        );
        expect(self._clearBtn.id).toBe("gl-cache-clear");
        expect(self._clearBtn.disabled).toBe(true);
    });

    test("pose la progression masquée, avec sa barre et son bouton d'arrêt", () => {
        const self = mount(makeSelf());

        expect(self._progressEl.style.display).toBe("none");
        expect(self._progressFill.id).toBe("gl-cache-progress-fill");
        expect(self._progressText.textContent).toBe("Downloading...");
        expect(self._stopBtn.id).toBe("gl-cache-stop");
    });
});

// ─── updateStatus ───────────────────────────────────────────────────────────────

describe("updateStatus", () => {
    afterEach(() => {
        // `init(null)` resets the contract to "plugin not loaded": its only write
        // method, and returning it to the singleton avoids leaking onto the next
        // files.
        _installGeoLeafStorage(null);
    });

    /**
     * Wires a CacheManager onto the contract **through its real API**, as
     * `geoleaf.storage.js` would at boot — rather than spying on the getter. A
     * spy on `CacheManager` would test the spy; `init()` exercises the real
     * indirection.
     */
    function withCacheManager(cacheManager) {
        _installGeoLeafStorage({ CacheManager: cacheManager });
    }

    test("ne touche à rien quand le plugin n'est pas chargé", async () => {
        _installGeoLeafStorage(null);
        const self = mount(makeSelf());

        await updateStatus(self);

        expect(document.getElementById("gl-cache-state").textContent).toBe("Not downloaded");
    });

    test("profil téléchargé : état vert, taille en Mo, bouton Vider réactivé", async () => {
        withCacheManager({
            getCacheStatus: vi
                .fn()
                .mockResolvedValue({ resourcesCount: 12, size: 5 * 1024 * 1024 }),
            getStorageQuota: vi.fn().mockResolvedValue({
                usage: 10 * 1024 * 1024,
                quota: 100 * 1024 * 1024,
                percentage: 10,
            }),
        });
        const self = mount(makeSelf());

        await updateStatus(self);

        const state = document.getElementById("gl-cache-state");
        expect(state.textContent).toContain("Downloaded");
        expect(state.style.color).toBe("#22c55e");
        expect(document.getElementById("gl-cache-size").textContent).toBe("5.00 MB");
        expect(self._clearBtn.disabled).toBe(false);
    });

    test("aucune ressource : état rouge, taille remise à zéro, bouton Vider désactivé", async () => {
        withCacheManager({
            getCacheStatus: vi.fn().mockResolvedValue({ resourcesCount: 0, size: 0 }),
            getStorageQuota: vi
                .fn()
                .mockResolvedValue({ usage: 0, quota: 100 * 1024 * 1024, percentage: 0 }),
        });
        const self = mount(makeSelf());
        self._clearBtn.disabled = false;

        await updateStatus(self);

        const state = document.getElementById("gl-cache-state");
        expect(state.textContent).toContain("Not downloaded");
        expect(state.style.color).toBe("#ef4444");
        expect(document.getElementById("gl-cache-size").textContent).toBe("0 MB");
        expect(self._clearBtn.disabled).toBe(true);
    });

    test("un statut null est traité comme « rien en cache »", async () => {
        withCacheManager({
            getCacheStatus: vi.fn().mockResolvedValue(null),
            getStorageQuota: vi
                .fn()
                .mockResolvedValue({ usage: 0, quota: 1024 * 1024, percentage: 0 }),
        });
        const self = mount(makeSelf());

        await updateStatus(self);

        expect(document.getElementById("gl-cache-state").textContent).toContain("Not downloaded");
    });

    test("le quota est rendu en Mo utilisés / total (pourcentage)", async () => {
        withCacheManager({
            getCacheStatus: vi.fn().mockResolvedValue(null),
            getStorageQuota: vi.fn().mockResolvedValue({
                usage: 25 * 1024 * 1024,
                quota: 200 * 1024 * 1024,
                percentage: 12.5,
            }),
        });
        const self = mount(makeSelf());

        await updateStatus(self);

        expect(document.getElementById("gl-cache-quota").textContent).toBe(
            "25.00 MB / 200.00 MB (12.5%)"
        );
    });

    test("un CacheManager qui jette ne propage pas l'erreur", async () => {
        withCacheManager({
            getCacheStatus: vi.fn().mockRejectedValue(new Error("IndexedDB indisponible")),
            getStorageQuota: vi.fn().mockResolvedValue({ usage: 0, quota: 1, percentage: 0 }),
        });
        const self = mount(makeSelf());

        await expect(updateStatus(self)).resolves.toBeUndefined();
    });
});

// ─── updateProgress / updateClearProgress ───────────────────────────────────────

describe("updateProgress", () => {
    test("ne fait rien sans détail de progression", () => {
        const self = mount(makeSelf());

        expect(() => updateProgress(self, null)).not.toThrow();
        expect(self._progressFill.style.width).toBe("");
    });

    test("ne fait rien quand la barre n'est pas construite", () => {
        const self = makeSelf();

        expect(() => updateProgress(self, { current: 1, total: 2 })).not.toThrow();
    });

    test("calcule le pourcentage sur le compte de fichiers par défaut", () => {
        const self = mount(makeSelf());

        updateProgress(self, { current: 3, total: 4 });

        expect(self._progressFill.style.width).toBe("75%");
        expect(self._progressText.textContent).toBe("3 / 4 files");
    });

    test("préfère les octets au compte de fichiers quand les deux sont fournis", () => {
        const self = mount(makeSelf());

        updateProgress(self, {
            current: 1,
            total: 10,
            downloadedSize: 5 * 1024 * 1024,
            totalSize: 10 * 1024 * 1024,
        });

        // 1/10 files = 10%, but 5/10 MB = 50%: the byte is what decides.
        expect(self._progressFill.style.width).toBe("50%");
        expect(self._progressText.textContent).toContain("5.0/10.0 MB");
    });

    test("retombe sur le compte de fichiers si totalSize vaut zéro", () => {
        const self = mount(makeSelf());

        updateProgress(self, { current: 1, total: 4, downloadedSize: 100, totalSize: 0 });

        expect(self._progressFill.style.width).toBe("25%");
    });

    test("affiche la vitesse instantanée quand elle est connue", () => {
        const self = mount(makeSelf());

        updateProgress(self, { current: 1, total: 2, speed: 2 * 1024 * 1024 });

        expect(self._progressText.textContent).toContain("2.00 MB/s");
    });

    test("des compteurs absents valent 0 sur 1", () => {
        const self = mount(makeSelf());

        updateProgress(self, {});

        expect(self._progressFill.style.width).toBe("0%");
        expect(self._progressText.textContent).toBe("0 / 1 files");
    });
});

describe("updateClearProgress", () => {
    test("affiche le pourcentage tant que la purge n'est pas finie", () => {
        const self = mount(makeSelf());

        updateClearProgress(self, { current: 1, total: 4 });

        expect(self._progressFill.style.width).toBe("25.0%");
        expect(self._progressText.textContent).toBe("Deleting: 1 / 4 files (25%)");
    });

    test("bascule sur un message de fin à 100 %", () => {
        const self = mount(makeSelf());

        updateClearProgress(self, { current: 4, total: 4 });

        expect(self._progressFill.style.width).toBe("100.0%");
        expect(self._progressText.textContent).toContain("Deletion complete");
    });

    test("ne fait rien quand la barre n'est pas construite", () => {
        const self = makeSelf();

        expect(() => updateClearProgress(self, { current: 1, total: 2 })).not.toThrow();
    });
});

// ─── handleCancelled ────────────────────────────────────────────────────────────

describe("handleCancelled", () => {
    test("marque l'arrêt, réactive le téléchargement et redemande le statut", () => {
        const self = mount(makeSelf());
        self._downloadBtn.disabled = true;

        handleCancelled(self);

        expect(self._progressText.textContent).toContain("Download stopped");
        expect(self._progressFill.style.backgroundColor).toBe("#ef4444");
        expect(self._downloadBtn.disabled).toBe(false);
        expect(self._downloadBtn.querySelector(".gl-btn__text").textContent).toBe(
            "Download profile"
        );
        expect(self._updateStatus).toHaveBeenCalled();
    });

    test("remet la barre à zéro et la masque après le délai de courtoisie", () => {
        vi.useFakeTimers();
        try {
            const self = mount(makeSelf());
            self._progressEl.style.display = "block";

            handleCancelled(self);
            expect(self._progressEl.style.display).toBe("block");

            vi.advanceTimersByTime(3000);

            expect(self._progressEl.style.display).toBe("none");
            expect(self._progressFill.style.width).toBe("0%");
            expect(self._progressFill.style.backgroundColor).toBe("");
        } finally {
            vi.useRealTimers();
        }
    });
});

// ─── Events and accordions ──────────────────────────────────────────────────────

describe("attachEventListeners", () => {
    test("chaque bouton appelle sa commande", () => {
        const self = mount(makeSelf());
        attachEventListeners(self);
        // `buildContent` sets Clear as `disabled`; `updateStatus` is what frees
        // it when a cache exists. Without this gesture the click below would not
        // fire — see the next test, whose subject it is.
        self._clearBtn.disabled = false;

        self._downloadBtn.click();
        self._clearBtn.click();
        self._stopBtn.click();
        self._layersToggleBtn.click();
        self._statusToggleBtn.click();

        expect(self._handleDownload).toHaveBeenCalledTimes(1);
        expect(self._handleClear).toHaveBeenCalledTimes(1);
        expect(self._handleStop).toHaveBeenCalledTimes(1);
        expect(self._handleLayersToggle).toHaveBeenCalledTimes(1);
        expect(self._handleStatusToggle).toHaveBeenCalledTimes(1);
    });

    test("Vider reste inerte tant qu'aucun cache n'existe", () => {
        const self = mount(makeSelf());
        attachEventListeners(self);

        // No `disabled = false` here: it is `buildContent`'s exit state.
        expect(self._clearBtn.disabled).toBe(true);
        self._clearBtn.click();

        expect(self._handleClear).not.toHaveBeenCalled();
    });

    test("un état sans boutons ne fait pas tomber le branchement", () => {
        const self = makeSelf();

        expect(() => attachEventListeners(self)).not.toThrow();
    });

    test("le cache terminé et le cache vidé redemandent le statut", () => {
        const self = mount(makeSelf());
        attachEventListeners(self);

        document.dispatchEvent(new CustomEvent("geoleaf:cache:completed"));
        document.dispatchEvent(new CustomEvent("geoleaf:cache:cleared"));

        expect(self._updateStatus).toHaveBeenCalledTimes(2);
    });

    test("l'annulation délègue à _handleCancelled", () => {
        const self = mount(makeSelf());
        attachEventListeners(self);

        document.dispatchEvent(new CustomEvent("geoleaf:cache:cancelled"));

        expect(self._handleCancelled).toHaveBeenCalledTimes(1);
    });

    test("un profil chargé redemande le statut ET la liste des couches", () => {
        const self = mount(makeSelf());
        attachEventListeners(self);

        document.dispatchEvent(new CustomEvent("geoleaf:profile:loaded"));

        expect(self._updateStatus).toHaveBeenCalledTimes(1);
        expect(self._populateLayerSelection).toHaveBeenCalledTimes(1);
    });

    test("la progression transporte son détail jusqu'à _updateProgress", () => {
        const self = mount(makeSelf());
        attachEventListeners(self);

        const detail = { current: 2, total: 5 };
        document.dispatchEvent(new CustomEvent("geoleaf:cache:progress", { detail }));

        expect(self._updateProgress).toHaveBeenCalledWith(detail);
    });

    test("la progression de purge a son propre canal", () => {
        const self = mount(makeSelf());
        attachEventListeners(self);

        const detail = { current: 1, total: 3 };
        document.dispatchEvent(new CustomEvent("geoleaf:cache:clear-progress", { detail }));

        expect(self._updateClearProgress).toHaveBeenCalledWith(detail);
    });
});

// ─── Listener failure paths ─────────────────────────────────────────────────────
//
// `attachEventListeners` wires six asynchronous commands. Before the fix, their
// rejections were caught by nobody: the promise floated, the error was
// swallowed, and on an ordered-boot base that is a silent defect. The
// `.catch()`es placed there are shipped code like any other — unexercised, they
// prove nothing.
//
// Each test below makes the command REJECT and verifies nothing escapes: it is
// the property that matters (the listener does not break the page), and also
// what distinguishes a real `.catch()` from a complacency `void`.

describe("attachEventListeners — rejets des commandes asynchrones", () => {
    /** Lets the .catch() microtask run before asserting. */
    const flush = () => new Promise((r) => setTimeout(r, 0));

    test("un _handleDownload qui rejette n'échappe pas au clic", async () => {
        const self = mount(makeSelf());
        self._handleDownload = vi.fn(() => Promise.reject(new Error("download boom")));
        attachEventListeners(self);

        expect(() => self._downloadBtn.click()).not.toThrow();
        await flush();

        expect(self._handleDownload).toHaveBeenCalledTimes(1);
    });

    test("un _handleClear qui rejette n'échappe pas au clic", async () => {
        const self = mount(makeSelf());
        self._clearBtn.disabled = false;
        self._handleClear = vi.fn(() => Promise.reject(new Error("clear boom")));
        attachEventListeners(self);

        expect(() => self._clearBtn.click()).not.toThrow();
        await flush();

        expect(self._handleClear).toHaveBeenCalledTimes(1);
    });

    test("un _updateStatus qui rejette n'échappe ni à cache:completed ni à cache:cleared", async () => {
        const self = mount(makeSelf());
        self._updateStatus = vi.fn(() => Promise.reject(new Error("status boom")));
        attachEventListeners(self);

        expect(() => {
            document.dispatchEvent(new CustomEvent("geoleaf:cache:completed"));
            document.dispatchEvent(new CustomEvent("geoleaf:cache:cleared"));
        }).not.toThrow();
        await flush();

        expect(self._updateStatus).toHaveBeenCalledTimes(2);
    });

    test("profile:loaded survit au rejet de SES DEUX commandes", async () => {
        const self = mount(makeSelf());
        self._updateStatus = vi.fn(() => Promise.reject(new Error("status boom")));
        self._populateLayerSelection = vi.fn(() => Promise.reject(new Error("layers boom")));
        attachEventListeners(self);

        expect(() => {
            document.dispatchEvent(new CustomEvent("geoleaf:profile:loaded"));
        }).not.toThrow();
        await flush();

        // Both fire: the first one's rejection must not short-circuit the second.
        expect(self._updateStatus).toHaveBeenCalledTimes(1);
        expect(self._populateLayerSelection).toHaveBeenCalledTimes(1);
    });
});

describe("accordéons", () => {
    test("handleLayersToggle replie puis déplie, et retourne le chevron", () => {
        const self = mount(makeSelf());

        handleLayersToggle(self);
        expect(self._layersContent.classList.contains("gl-cache-collapsible--collapsed")).toBe(
            true
        );
        expect(self._layersToggleBtn.textContent).toBe("▲");

        handleLayersToggle(self);
        expect(self._layersContent.classList.contains("gl-cache-collapsible--collapsed")).toBe(
            false
        );
        expect(self._layersToggleBtn.textContent).toBe("▼");
    });

    test("handleLayersToggle ne fait rien sans contenu", () => {
        const self = makeSelf();

        expect(() => handleLayersToggle(self)).not.toThrow();
    });

    test("handleStatusToggle replie le bloc de statut", () => {
        const self = mount(makeSelf());
        const info = self._bodyEl.querySelector(".gl-cache-status__info");

        handleStatusToggle(self);

        expect(info.classList.contains("gl-cache-collapsible--collapsed")).toBe(true);
        expect(self._statusToggleBtn.textContent).toBe("▲");
    });

    test("handleStatusToggle ne fait rien sans corps construit", () => {
        const self = makeSelf();

        expect(() => handleStatusToggle(self)).not.toThrow();
    });

    test("toggleCollapsed bascule la classe ET l'option", () => {
        const self = mount(makeSelf({ collapsed: false }));

        toggleCollapsed(self);
        expect(self._container.classList.contains("gl-cache-control--collapsed")).toBe(true);
        expect(self.options.collapsed).toBe(true);

        toggleCollapsed(self);
        expect(self.options.collapsed).toBe(false);
    });

    test("toggleCollapsed ne fait rien sans conteneur", () => {
        const self = makeSelf();
        self._container = null;

        expect(() => toggleCollapsed(self)).not.toThrow();
    });
});

describe("cleanup", () => {
    test("appelle les désabonnements de type fonction et vide la liste", () => {
        const self = mount(makeSelf());
        const off = vi.fn();
        self._eventCleanups = [off];

        cleanup(self);

        expect(off).toHaveBeenCalledTimes(1);
        expect(self._eventCleanups).toEqual([]);
    });

    test("une liste vide est un no-op", () => {
        const self = mount(makeSelf());

        expect(() => cleanup(self)).not.toThrow();
    });
});
