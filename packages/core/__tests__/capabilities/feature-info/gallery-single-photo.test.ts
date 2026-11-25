/**
 * A one-photo gallery opens the image viewer.
 *
 * The gallery draws thumbnails only past one photo, and `attachGalleryEvents` returned before
 * wiring anything when there were none: the magnifier showed on the image, and a click opened
 * nothing. Every gallery of the demonstration holds one photo, so the viewer was never
 * reachable there. Red on the code before the fix: the viewer stayed closed.
 */
import { describe, it, expect, afterEach } from "vitest";
import { renderGallery } from "../../../src/capabilities/feature-info/render/media.js";
import {
    LightboxManager,
    attachGalleryEvents,
} from "../../../src/capabilities/feature-info/render/lightbox.js";

afterEach(() => {
    document.querySelectorAll(".gl-poi-lightbox-global").forEach((n) => n.remove());
});

function mount(urls: string[]): { wrap: HTMLElement; viewer: LightboxManager } {
    const gallery = renderGallery({ field: "photos" } as never, urls);
    const wrap = document.createElement("div");
    if (gallery) wrap.appendChild(gallery);
    document.body.appendChild(wrap);
    const viewer = new LightboxManager();
    attachGalleryEvents(wrap, viewer);
    return { wrap, viewer };
}

function clickMain(wrap: HTMLElement): void {
    wrap.querySelector(".gl-poi-gallery__main img")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
    );
}

describe("galerie d'une seule photo", () => {
    it("le clic sur l'image ouvre la visionneuse, « 1 / 1 »", () => {
        const { wrap, viewer } = mount(["https://e.test/1.jpg"]);
        clickMain(wrap);
        expect(viewer.isOpen()).toBe(true);
        const img = document.querySelector<HTMLImageElement>(".gl-poi-lightbox-global img");
        expect(img?.src).toBe("https://e.test/1.jpg");
        expect(img?.alt).toBe("1 / 1");
        // One photo: nothing to navigate to.
        expect(document.querySelector(".gl-poi-lightbox__prev")).toBeNull();
        viewer.close();
    });

    it("une photo dont l'URL est refusée n'arme rien et ne lève pas", () => {
        const { wrap, viewer } = mount(["javascript:alert(1)"]);
        expect(wrap.querySelector(".gl-poi-gallery__main img")).toBeNull();
        expect(viewer.isOpen()).toBe(false);
    });
});
