/*!
 * GeoLeaf Core (feature-info capability) — Ported renderers: media (image + gallery)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Self-contained port of the pre-extraction core `MediaRenderers`. Produces the
 * exact same DOM structure and `gl-poi-*` class names as the original, but as
 * plain functions with zero dependency on core, the field-renderer package, or
 * any sibling package. URLs assigned to `img.src` are always validated through
 * {@link safeUrl}; renders are skipped when the URL is unsafe.
 * https://geoleaf.dev
 */

import { el, safeUrl } from "./dom.js";
import type { RenderField } from "./dom.js";

/**
 * Renders a single image, hero or normal, matching the original
 * `gl-poi-sidepanel__photo` structure.
 *
 * The wrapper carries `gl-poi-sidepanel__photo`, plus the
 * `gl-poi-sidepanel__photo--hero` modifier when `config.variant === "hero"`.
 * The inner `<img>` is lazy-loaded and alt-labelled from `config.label`,
 * falling back to `"Photo"`.
 *
 * @param config Field configuration (`variant`, `label`).
 * @param value Candidate image URL (any type; only safe string URLs render).
 * @returns The photo `<div>` element, or `null` when the URL is empty/unsafe.
 */
export function renderImage(config: RenderField, value: unknown): HTMLElement | null {
    if (!value) return null;

    const url = safeUrl(value);
    if (!url) return null;

    const className =
        config.variant === "hero"
            ? "gl-poi-sidepanel__photo gl-poi-sidepanel__photo--hero"
            : "gl-poi-sidepanel__photo";

    const photoDiv = el("div", className);
    const img = el("img", undefined, {
        src: url,
        alt: config.label || "Photo",
        loading: "lazy",
    });

    photoDiv.appendChild(img);
    return photoDiv;
}

/**
 * Builds the gallery's main image container (`gl-poi-gallery__main`).
 *
 * The container always carries `data-gallery-index="0"`; the `<img>` is only
 * appended when the URL passes {@link safeUrl}, so an unsafe first image yields
 * an empty (but structurally present) main container.
 *
 * @param imageUrl Candidate URL for the first/main image.
 * @returns The main-image `<div>` element.
 */
function createMainImage(imageUrl: unknown): HTMLElement {
    const mainDiv = el("div", "gl-poi-gallery__main", {
        "data-gallery-index": "0",
    });

    const url = safeUrl(imageUrl);
    if (url) {
        const mainImg = el("img", undefined, {
            src: url,
            alt: "Image 1",
            loading: "lazy",
        });
        mainDiv.appendChild(mainImg);
    }
    return mainDiv;
}

/**
 * Builds a single thumbnail (`gl-poi-gallery__thumb`) and wires its click to
 * swap the gallery's main image and toggle the `active` class — the exact
 * behaviour of the original `_createThumbnail`.
 *
 * The first thumbnail (`index === 0`) starts with the `active` modifier. An
 * unsafe thumbnail URL yields an empty, non-interactive thumbnail (no `<img>`,
 * no click handler) rather than an unsafe `img.src` sink.
 *
 * @param imgUrl Candidate thumbnail URL.
 * @param index Zero-based position of the thumbnail in the gallery.
 * @param mainImg The gallery's main `<img>` element (swap target), or `null`.
 * @param mainDiv The gallery's main-image container (carries `data-gallery-index`).
 * @param thumbsDiv The thumbnails container (used to clear sibling `active`).
 * @returns The thumbnail `<div>` element.
 */
function createThumbnail(
    imgUrl: unknown,
    index: number,
    mainImg: HTMLImageElement | null,
    mainDiv: HTMLElement,
    thumbsDiv: HTMLElement
): HTMLElement {
    const thumbDiv = el(
        "div",
        index === 0 ? "gl-poi-gallery__thumb active" : "gl-poi-gallery__thumb",
        { "data-index": index.toString() }
    );

    // Validate the thumbnail URL once; an unsafe URL yields an empty
    // (non-interactive) thumbnail rather than an unsafe img.src sink.
    const url = safeUrl(imgUrl);
    if (!url) return thumbDiv;

    const imgThumb = el("img", undefined, {
        src: url,
        alt: `Image ${index + 1}`,
        loading: "lazy",
    });

    thumbDiv.appendChild(imgThumb);

    // Click handler swaps the main image and moves the active marker.
    thumbDiv.addEventListener(
        "click",
        (e: Event) => {
            e.preventDefault();
            e.stopPropagation();

            // Remove the active class from every thumbnail.
            const allThumbs = thumbsDiv.querySelectorAll(".gl-poi-gallery__thumb");
            allThumbs.forEach((t: Element) => t.classList.remove("active"));

            // Mark the clicked thumbnail active.
            thumbDiv.classList.add("active");

            // Swap the main image (url already validated above).
            if (mainImg) {
                mainImg.src = url;
                mainImg.alt = `Image ${index + 1}`;
            }
            mainDiv.setAttribute("data-gallery-index", index.toString());
        },
        true
    );

    return thumbDiv;
}

/**
 * Builds the thumbnails strip (`gl-poi-gallery__thumbnails`) for a gallery,
 * one thumbnail per URL, each wired to swap the main image.
 *
 * @param gallery Array of candidate image URLs.
 * @param mainDiv The gallery's main-image container.
 * @returns The thumbnails `<div>` element.
 */
function createThumbnails(gallery: unknown[], mainDiv: HTMLElement): HTMLElement {
    const thumbsDiv = el("div", "gl-poi-gallery__thumbnails");
    const mainImg = mainDiv.querySelector<HTMLImageElement>("img");

    gallery.forEach((imgUrl: unknown, index: number) => {
        const thumbDiv = createThumbnail(imgUrl, index, mainImg, mainDiv, thumbsDiv);
        thumbsDiv.appendChild(thumbDiv);
    });

    return thumbsDiv;
}

/**
 * Renders an image gallery with a main image and, when more than one image is
 * present, a thumbnails strip — matching the original `gl-poi-gallery`
 * structure. Each URL is validated via {@link safeUrl}; unsafe URLs are skipped
 * at their sink.
 *
 * @param _config Field configuration (unused; kept for a uniform renderer signature).
 * @param value Array of image URLs (`string[]`).
 * @returns The gallery `<div>` element, or `null` when the input is empty/invalid.
 */
export function renderGallery(_config: RenderField, value: unknown): HTMLElement | null {
    if (!Array.isArray(value) || value.length === 0) {
        return null;
    }

    const galleryDiv = el("div", "gl-poi-gallery");

    // Main image.
    const mainDiv = createMainImage(value[0]);
    galleryDiv.appendChild(mainDiv);

    // Thumbnails when there is more than one image.
    if (value.length > 1) {
        const thumbsDiv = createThumbnails(value, mainDiv);
        galleryDiv.appendChild(thumbsDiv);
    }

    return galleryDiv;
}
