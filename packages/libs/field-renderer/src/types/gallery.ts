/*!
 * @geoleaf/field-renderer — gallery component (multi-image upload)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Stores string[] — one entry per image: the URL its upload returned, or whatever the host's
 * upload strategy answered for a file it keeps (an opaque token, resolved for display by the
 * host's preview resolver). Without a host strategy, uploads via fetch to
 * fieldConfig.uploadEndpoint, and falls back to a local object URL when there is none.
 * fieldConfig extras:
 *   uploadEndpoint?: string   — POST endpoint; response must be JSON { url: string }
 *   maxCount?: number         — maximum number of images (default 20)
 *   maxSizeMb?: number        — TARGET size in MB after compression (default 5). Larger
 *                               images are resized+recompressed to fit; rejected only past 5× that
 *                               value before compression. See `image-compress.ts`.
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { required as vRequired } from "../validators.js";
import { _el, _getLabel } from "../helpers.js";

import {
    ACCEPTED_ACCEPT,
    _openLightboxResolved,
    _resolveImageSrc,
    _uploadFile,
    _validateFile,
} from "./field-media.js";
import { compressToFit, PRECOMPRESSION_FACTOR } from "./image-compress.js";

function formRender(
    value: string[],
    fieldConfig: FieldConfig,
    onChange: (v: string[]) => void,
    ctx: RenderCtx
): HTMLElement {
    const urls: string[] = Array.isArray(value) ? [...value] : [];
    const endpoint = fieldConfig.uploadEndpoint as string | undefined;
    const maxCount = fieldConfig.maxCount != null ? Number(fieldConfig.maxCount) : 20;
    const maxSizeMb = fieldConfig.maxSizeMb != null ? Number(fieldConfig.maxSizeMb) : 5;
    let dragSrcIdx: number | null = null;

    const wrap = _el("div", "gl-form-field gl-form-gallery");

    const labelEl = _el("label", "gl-form-label");
    labelEl.textContent = fieldConfig.label;
    if (fieldConfig.required) labelEl.dataset.required = "true";
    labelEl.htmlFor = `gl-field-${fieldConfig.id}-file`;

    const grid = _el("div", "gl-form-gallery__editor");

    const errorEl = _el("span", "gl-form-error");
    errorEl.hidden = true;

    function renderGrid(): void {
        grid.innerHTML = "";
        urls.forEach((url, idx) => {
            const item = _el("div", "gl-form-gallery__item");
            item.draggable = !ctx.readOnly;

            const img = _el("img");
            // Protocol-checked like the side-panel path, and resolved through the host first:
            // a capture waiting for its upload is held as an opaque token, and only the host
            // can read its store. The item itself stays in the grid either way, so `idx`
            // keeps matching `urls`.
            // ⚠️ The `src` is set asynchronously, on THIS element: a grid rebuilt while the
            // read was in flight has dropped it, so a late answer cannot land on another photo.
            void _resolveImageSrc(url).then((src) => {
                img.src = src;
            });
            img.className = "gl-form-gallery__thumb";
            img.alt = "";
            img.style.cursor = "zoom-in";
            img.addEventListener("click", () => void _openLightboxResolved(url));

            const removeBtn = _el("button");
            removeBtn.type = "button";
            removeBtn.className = "gl-form-gallery__remove";
            removeBtn.textContent = "×";
            removeBtn.setAttribute("aria-label", _getLabel("form.aria.imageRemove"));
            removeBtn.disabled = !!ctx.readOnly;
            removeBtn.addEventListener("click", () => {
                urls.splice(idx, 1);
                onChange([...urls]);
                renderGrid();
            });

            item.addEventListener("dragstart", () => {
                dragSrcIdx = idx;
                item.classList.add("is-dragging");
            });
            item.addEventListener("dragend", () => {
                dragSrcIdx = null;
                item.classList.remove("is-dragging");
            });
            item.addEventListener("dragover", (e) => {
                e.preventDefault();
                item.classList.add("is-over");
            });
            item.addEventListener("dragleave", () => item.classList.remove("is-over"));
            item.addEventListener("drop", (e) => {
                e.preventDefault();
                item.classList.remove("is-over");
                if (dragSrcIdx == null || dragSrcIdx === idx) return;
                const [moved] = urls.splice(dragSrcIdx, 1);
                if (moved === undefined) return;
                urls.splice(idx, 0, moved);
                onChange([...urls]);
                renderGrid();
            });

            item.appendChild(img);
            item.appendChild(removeBtn);
            grid.appendChild(item);
        });

        // Upload slot (shown when below maxCount)
        if (!ctx.readOnly && urls.length < maxCount) {
            const addSlot = _el("div", "gl-form-gallery__add-slot");

            const fileInput = _el("input");
            fileInput.type = "file";
            fileInput.accept = ACCEPTED_ACCEPT;
            fileInput.multiple = true;
            fileInput.id = `gl-field-${fieldConfig.id}-file`;
            fileInput.className = "gl-form-image__file-input";

            fileInput.addEventListener("change", () => {
                void handleFiles(Array.from(fileInput.files ?? []));
                fileInput.value = "";
            });

            addSlot.addEventListener("click", () => fileInput.click());
            addSlot.addEventListener("dragover", (e) => {
                e.preventDefault();
                addSlot.classList.add("is-over");
            });
            addSlot.addEventListener("dragleave", () => addSlot.classList.remove("is-over"));
            addSlot.addEventListener("drop", (e) => {
                e.preventDefault();
                addSlot.classList.remove("is-over");
                void handleFiles(Array.from(e.dataTransfer?.files ?? []));
            });

            const addLabel = _el("span");
            addLabel.textContent = "+";
            addSlot.appendChild(addLabel);
            addSlot.appendChild(fileInput);
            grid.appendChild(addSlot);
        }
    }

    async function handleFiles(files: File[]): Promise<void> {
        errorEl.hidden = true;
        for (const file of files) {
            if (urls.length >= maxCount) break;
            // Same shape as the `image` component: the refusal stays
            // SYNCHRONOUS, and we only wait for compression when needed.
            // `maxSizeMb` becomes the size aimed for AFTER compression. See `image-compress.ts`.
            const preErr = _validateFile(file, maxSizeMb * PRECOMPRESSION_FACTOR);
            if (preErr) {
                errorEl.textContent = _getLabel(preErr);
                errorEl.hidden = false;
                continue;
            }
            // Separate variable: `file` is the `for…of` loop's `const`.
            let toSend = file;
            if (file.size > maxSizeMb * 1024 * 1024) {
                const outcome = await compressToFit(file, maxSizeMb);
                if (outcome.error) {
                    errorEl.textContent = _getLabel(outcome.error);
                    errorEl.hidden = false;
                    continue;
                }
                toSend = outcome.file;
            }
            // 🛑 ONE ROAD, WITH OR WITHOUT AN ENDPOINT — the `image` component's. This used
            // to call the upload without the field it came from, so a host that kept the file
            // could not say which attribute to write its URL back to; and with no endpoint it
            // wrote a `URL.createObjectURL` value straight into the list — an object URL dies
            // with the document, so the photos were gone at the next reload. The host strategy
            // is now handed the field, and `null` for an endpoint it then knows is absent;
            // without a host, `_uploadFile` falls back to the object URL itself.
            try {
                const url = await _uploadFile(toSend, endpoint ?? null, fieldConfig.id);
                urls.push(url);
                onChange([...urls]);
                renderGrid();
            } catch {
                errorEl.textContent = _getLabel("form.error.uploadFailed");
                errorEl.hidden = false;
            }
        }
    }

    renderGrid();
    wrap.appendChild(labelEl);
    wrap.appendChild(grid);
    wrap.appendChild(errorEl);
    return wrap;
}

function validator(value: string[], fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    return null;
}

/**
 * An ordered set of image URLs. The sidepanel renders thumbnails; the form allows adding and removing entries.
 *
 * Registered under the id `gallery`, and selected when a field declares `"type": "gallery"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const galleryComponent: ComponentDefinition<string[]> = {
    id: "gallery",
    defaults: [],
    formRender,
    validator,
};
