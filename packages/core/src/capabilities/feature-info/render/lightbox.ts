/*!
 * GeoLeaf Core (feature-info capability) — Ported renderers: lightbox & gallery/accordion behaviours
 * © 2026 Mattieu Pottier — MIT License
 *
 * Self-contained port of the pre-extraction core lightbox manager and the
 * side-panel UI behaviours (gallery navigation + exclusive accordions). Class
 * names (`gl-poi-lightbox-global`, `gl-poi-lightbox__*`, `gl-poi-gallery__*`,
 * `gl-accordion`), keyboard navigation and counter are preserved exactly. No
 * dependency on the field-renderer package or any sibling package; i18n goes
 * through the {@link i18n} seam helper.
 *
 * The focus trap is no longer local: it lives in `modules/utils/controls`,
 * shared with the other modal surfaces. The copy that used to sit here had a
 * truncated selector that let Tab escape past links and form controls.
 * https://geoleaf.dev
 */

import { i18n } from "./dom.js";
import { handleFocusTrap } from "../../../utils/controls/focus-trap.js";

/**
 * Public surface of the lightbox: the three methods the gallery behaviour and
 * host code rely on. `onIndexChange` is a mutable hook the gallery wiring sets
 * to keep the side-panel thumbnails in sync with in-lightbox navigation.
 */
interface Lightbox {
    /**
     * Opens the lightbox on `imageSrc`. When `galleryImages` has more than one
     * entry, arrow navigation and a counter are enabled.
     */
    open(imageSrc: string, galleryImages?: string[], startIndex?: number): void;
    /** Closes the active lightbox and restores focus to the trigger element. */
    close(): void;
    /** Returns `true` while a lightbox is mounted in the document. */
    isOpen(): boolean;
    /** Callback invoked with the new index whenever in-lightbox navigation moves. */
    onIndexChange: ((index: number) => void) | null;
}

/**
 * Builds the lightbox DOM skeleton: overlay, content wrapper, image, and close
 * button, matching the original `gl-poi-lightbox-*` class names.
 *
 * @param imageSrc Initial image URL assigned to the lightbox `<img>`.
 * @returns The lightbox root element and its `<img>` element.
 */
function buildLightboxDom(imageSrc: string): {
    lightbox: HTMLDivElement;
    img: HTMLImageElement;
} {
    const lightbox = document.createElement("div");
    lightbox.className = "gl-poi-lightbox-global";
    lightbox.style.display = "flex";

    // 🛑 THESE THREE ATTRIBUTES WERE MISSING, AND THE ABSENCE OF A TEST IS WHAT HID THEM.
    // The lightbox traps focus, closes on Escape and restores focus to its trigger — it
    // behaves as a modal on every point EXCEPT the one that ANNOUNCES it. Without `role`
    // and `aria-modal`, a screen reader announces it as an ordinary `div`: the content
    // behind stays announced as reachable, and nothing signals that a dialog opened.
    // The repo's three other modals already set them — `share-modal.ts`,
    // `mobile-toolbar-sheet.ts`, `field-renderer/responsive-modal.ts`. This one alone did
    // not, and the test that would have seen it has been `skip` since forever: it looks
    // for `[role="dialog"].gl-poi-lightbox-global`, a selector that would have found
    // nothing even with the data it was missing.
    // 📌 `aria.lightbox.title` ALREADY existed in the six dictionaries, translated, and
    // was called by no code: a key created for this dialog and never wired. Reusing it
    // avoids a seventh translation — and the i18n gate `requested-keys-exist` rejected the
    // new key I had written first, which is exactly its office.
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    lightbox.setAttribute("aria-label", i18n("aria.lightbox.title", "Galerie d'images"));

    const overlay = document.createElement("div");
    overlay.className = "gl-poi-lightbox__overlay";
    lightbox.appendChild(overlay);

    const content = document.createElement("div");
    content.className = "gl-poi-lightbox__content";
    lightbox.appendChild(content);

    const img = document.createElement("img");
    img.className = "gl-poi-lightbox__image";
    img.src = imageSrc;
    img.alt = "";
    content.appendChild(img);

    const closeBtn = document.createElement("button");
    closeBtn.className = "gl-poi-lightbox__close";
    closeBtn.setAttribute("aria-label", i18n("aria.lightbox.close", "Fermer"));
    closeBtn.textContent = "×";
    lightbox.appendChild(closeBtn);

    return { lightbox, img };
}

/**
 * Fullscreen image lightbox with optional gallery navigation (arrows, counter,
 * keyboard, focus trap). Implements {@link Lightbox}.
 *
 * A single instance is reused across opens; {@link LightboxManager.open} first
 * closes any active lightbox. The exported {@link lightbox} singleton is the
 * one wired by {@link attachGalleryEvents}.
 */
export class LightboxManager implements Lightbox {
    private currentLightbox: HTMLElement | null = null;
    private keyHandler: ((e: KeyboardEvent) => void) | null = null;
    private galleryImages: string[] = [];
    private currentIndex = 0;
    private imgElement: HTMLImageElement | null = null;
    private counterElement: HTMLElement | null = null;
    private triggerElement: HTMLElement | null = null;

    /** Hook fired with the new index on every in-lightbox navigation step. */
    onIndexChange: ((index: number) => void) | null = null;

    /**
     * Opens a lightbox showing `imageSrc`. When `galleryImages` holds more than
     * one URL, arrow navigation and a counter are enabled; `startIndex` selects
     * the initial slide (falling back to the position of `imageSrc`).
     *
     * @param imageSrc URL of the image to display.
     * @param galleryImages Optional gallery URLs enabling navigation.
     * @param startIndex Optional initial index into `galleryImages`.
     */
    open(imageSrc: string, galleryImages?: string[], startIndex?: number): void {
        // 🛑 THE ORDER OF THESE THREE LINES IS THE FIX, AND THE OLD ONE CANCELLED ITSELF.
        // The previous version wrote `this.triggerElement = document.activeElement` THEN
        // called `this.close()` — but `close()` ends with `this.triggerElement = null`. The
        // trigger was thus erased on the line after the one that memorised it, and the
        // `this.triggerElement?.focus()` on close was a no-op **every single time**: a
        // keyboard user landed back at the top of the page on every close, while the TSDoc
        // of `close()` promises "restores focus".
        // Found on 17/08/2026 by the `lightbox-a11y.guard.test.ts` guard, written the same
        // day: precisely what the missing coverage was hiding.
        const trigger = document.activeElement as HTMLElement | null;
        this.close();
        this.triggerElement = trigger;

        if (Array.isArray(galleryImages) && galleryImages.length > 1) {
            this.galleryImages = galleryImages;
            this.currentIndex =
                typeof startIndex === "number" ? startIndex : galleryImages.indexOf(imageSrc);
            if (this.currentIndex < 0) this.currentIndex = 0;
        } else {
            this.galleryImages = [imageSrc];
            this.currentIndex = 0;
        }

        const { lightbox, img } = buildLightboxDom(imageSrc);

        const overlay = lightbox.querySelector<HTMLElement>(".gl-poi-lightbox__overlay");
        if (overlay) overlay.addEventListener("click", () => this.close());

        const closeBtn = lightbox.querySelector<HTMLElement>(".gl-poi-lightbox__close");
        if (closeBtn) {
            closeBtn.addEventListener("click", (e: Event) => {
                e.stopPropagation();
                this.close();
            });
        }
        this.imgElement = img;

        if (this.galleryImages.length > 1) {
            this.createNavigation(lightbox);
        }

        document.body.appendChild(lightbox);
        this.currentLightbox = lightbox;

        // Set the initial alt text to the counter position.
        this.imgElement.alt = this.counterLabel();

        // Move focus to the close button.
        const initialFocusBtn = lightbox.querySelector<HTMLElement>(".gl-poi-lightbox__close");
        if (initialFocusBtn) initialFocusBtn.focus();

        this.keyHandler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                this.close();
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                this.prev();
            } else if (e.key === "ArrowRight") {
                e.preventDefault();
                this.next();
            } else if (e.key === "Tab" && this.currentLightbox) {
                // Focus trap: cycle within the lightbox.
                handleFocusTrap(this.currentLightbox, e);
            }
        };
        document.addEventListener("keydown", this.keyHandler);
    }

    /**
     * Builds the navigation controls (prev/next buttons and counter) and
     * appends them to `lightbox`.
     *
     * @param lightbox The lightbox root element.
     */
    private createNavigation(lightbox: HTMLElement): void {
        const prevBtn = document.createElement("button");
        prevBtn.className = "gl-poi-lightbox__prev";
        prevBtn.setAttribute("aria-label", i18n("aria.lightbox.prev", "Précédent"));
        prevBtn.textContent = "‹";
        prevBtn.addEventListener("click", (e: Event) => {
            e.stopPropagation();
            this.prev();
        });
        lightbox.appendChild(prevBtn);

        const nextBtn = document.createElement("button");
        nextBtn.className = "gl-poi-lightbox__next";
        nextBtn.setAttribute("aria-label", i18n("aria.lightbox.next", "Suivant"));
        nextBtn.textContent = "›";
        nextBtn.addEventListener("click", (e: Event) => {
            e.stopPropagation();
            this.next();
        });
        lightbox.appendChild(nextBtn);

        const counter = document.createElement("div");
        counter.className = "gl-poi-lightbox__counter";
        lightbox.appendChild(counter);
        this.counterElement = counter;

        this.updateNavState();
    }

    /** Navigates to the previous image (wraps around). */
    private prev(): void {
        if (this.galleryImages.length <= 1) return;
        this.currentIndex =
            (this.currentIndex - 1 + this.galleryImages.length) % this.galleryImages.length;
        this.updateImage();
    }

    /** Navigates to the next image (wraps around). */
    private next(): void {
        if (this.galleryImages.length <= 1) return;
        this.currentIndex = (this.currentIndex + 1) % this.galleryImages.length;
        this.updateImage();
    }

    /** Builds the `N / M` counter label used for both the counter and alt text. */
    private counterLabel(): string {
        return `${this.currentIndex + 1} / ${this.galleryImages.length}`;
    }

    /**
     * Swaps the displayed image, refreshes the alt/counter, and notifies
     * `onIndexChange` so external thumbnails can stay in sync.
     */
    private updateImage(): void {
        if (!this.imgElement) return;
        const src = this.galleryImages[this.currentIndex];
        if (src === undefined) return;
        this.imgElement.src = src;
        this.imgElement.alt = this.counterLabel();
        this.updateNavState();

        if (typeof this.onIndexChange === "function") {
            this.onIndexChange(this.currentIndex);
        }
    }

    /** Updates the counter text to the current position. */
    private updateNavState(): void {
        if (this.counterElement) {
            this.counterElement.textContent = this.counterLabel();
        }
    }

    /** Closes the active lightbox, tears down listeners, and restores focus. */
    close(): void {
        if (this.currentLightbox && document.body.contains(this.currentLightbox)) {
            document.body.removeChild(this.currentLightbox);
        }

        if (this.keyHandler) {
            document.removeEventListener("keydown", this.keyHandler);
            this.keyHandler = null;
        }

        // Restore focus to the element that opened the lightbox.
        this.triggerElement?.focus();
        this.triggerElement = null;

        this.currentLightbox = null;
        this.imgElement = null;
        this.counterElement = null;
        this.galleryImages = [];
        this.currentIndex = 0;
        this.onIndexChange = null;
    }

    /** Returns `true` while a lightbox is mounted in the document. */
    isOpen(): boolean {
        return this.currentLightbox !== null && document.body.contains(this.currentLightbox);
    }
}

/** Module-level singleton lightbox used by {@link attachGalleryEvents}. */
export const lightbox: LightboxManager = new LightboxManager();

/** Side-panel element carrying the one-shot gallery-events flag expando. */
type GalleryPanelElement = HTMLElement & { _galleryEventsAttached?: boolean };

/**
 * Wires gallery navigation on a rendered side panel: thumbnail clicks swap the
 * main image and move the active marker, and clicking the main image opens the
 * lightbox over the whole gallery with two-way synchronization back to the
 * thumbnails. Guarded by a one-shot `_galleryEventsAttached` flag so repeated
 * calls on the same panel are no-ops.
 *
 * @param sidePanelElement The side-panel root containing the gallery, or `null`.
 * @param lightboxManager The lightbox to open on main-image click, or `null`.
 */
export function attachGalleryEvents(
    sidePanelElement: HTMLElement | null,
    lightboxManager: Lightbox | null
): void {
    if (!sidePanelElement) return;
    const panel = sidePanelElement as GalleryPanelElement;
    if (panel._galleryEventsAttached) return;
    panel._galleryEventsAttached = true;

    // Thumbnail navigation.
    const thumbs = panel.querySelectorAll(".gl-poi-gallery__thumb");
    const mainImg = panel.querySelector<HTMLImageElement>(".gl-poi-gallery__main img");

    if (!mainImg || thumbs.length === 0) return;

    // Collect every gallery image URL from the thumbnails.
    //
    // ⚠️ A thumbnail whose URL was rejected by `safeUrl` carries NO `<img>` — `media.ts`
    // produces it DELIBERATELY ("an unsafe URL yields an empty (non-interactive) thumbnail
    // rather than an unsafe img.src sink"). Dereferencing `querySelector("img")!.src` here
    // therefore threw on any remote gallery holding one bad URL, and since this runs inside
    // `buildSidePanelBody` the whole side panel failed to open — two deliberate designs
    // contradicting each other (CAPACITÉS S11 / B.32).
    //
    // Empty thumbnails are excluded from the navigable set, and `data-index` is REMAPPED onto
    // that set: keeping the raw attribute would shift every image after the rejected one.
    const navigable: { thumb: Element; img: HTMLImageElement }[] = [];
    thumbs.forEach((thumb: Element) => {
        const img = thumb.querySelector<HTMLImageElement>("img");
        if (img) navigable.push({ thumb, img });
    });
    if (navigable.length === 0) return;

    const galleryImages = navigable.map((entry) => entry.img.src);
    const indexOfThumb = new Map<Element, number>();
    navigable.forEach((entry, i) => indexOfThumb.set(entry.thumb, i));

    navigable.forEach(({ thumb, img }) => {
        thumb.addEventListener("click", () => {
            const index = indexOfThumb.get(thumb) ?? 0;

            // Update the main image.
            mainImg.src = img.src;
            mainImg.alt = `Image ${index + 1}`;

            // Update the active state of the thumbnails.
            thumbs.forEach((t: Element) => t.classList.remove("active"));
            thumb.classList.add("active");
        });
    });

    // Clicking the main image opens the lightbox over the whole gallery.
    mainImg.addEventListener("click", () => {
        if (!lightboxManager) return;

        // Determine the current index from the active thumbnail.
        const activeThumb = panel.querySelector(".gl-poi-gallery__thumb.active");
        const currentIndex = (activeThumb && indexOfThumb.get(activeThumb)) ?? 0;

        // Open the lightbox with the full gallery.
        lightboxManager.open(mainImg.src, galleryImages, currentIndex);

        // Sync the thumbnails when navigating inside the lightbox.
        lightboxManager.onIndexChange = (newIndex: number) => {
            thumbs.forEach((t: Element) => t.classList.remove("active"));
            // `newIndex` indexes `galleryImages`, i.e. the NAVIGABLE set — not the raw
            // `data-index` attribute, which still counts the rejected thumbnails.
            const target = navigable[newIndex];
            if (target) {
                target.thumb.classList.add("active");
                // Update the panel's main image too.
                mainImg.src = target.img.src;
                mainImg.alt = `Image ${newIndex + 1}`;
            }
        };
    });
}

/**
 * Attaches exclusive-open behaviour to every `<details.gl-accordion>` inside
 * `container`: opening one accordion collapses the others.
 *
 * @param container The element containing the accordions.
 */
export function attachSingleAccordionBehavior(container: HTMLElement): void {
    const accordions = container.querySelectorAll<HTMLDetailsElement>("details.gl-accordion");
    if (accordions.length === 0) return;

    accordions.forEach((accordion: HTMLDetailsElement) => {
        accordion.addEventListener("toggle", (event: Event) => {
            const target = event.target as HTMLDetailsElement;
            // When this accordion has just been opened, collapse the others.
            if (target.open) {
                accordions.forEach((other: HTMLDetailsElement) => {
                    if (other !== target && other.open) {
                        other.removeAttribute("open");
                    }
                });
            }
        });
    });
}
