/*!
 * @geoleaf/field-renderer — gallery component (multi-image upload)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Stores string[] of URLs. Uploads via fetch to fieldConfig.uploadEndpoint.
 * fieldConfig extras:
 *   uploadEndpoint?: string   — POST endpoint; response must be JSON { url: string }
 *   maxCount?: number         — maximum number of images (default 20)
 *   maxSizeMb?: number        — TARGET size in MB after compression (default 5). Larger
 *                               images are resized+recompressed to fit; rejected only past 5× that
 *                               value before compression. See `image-compress.ts` (task 5.1-d).
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { required as vRequired } from "../validators.js";
import { _el, _getLabel } from "../helpers.js";

import {
    ACCEPTED_ACCEPT,
    _createObjectUrl,
    _openLightbox,
    _safeImageSrc,
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
            // Protocol-checked like the side-panel path; the item itself stays
            // in the grid either way, so `idx` keeps matching `urls`.
            img.src = _safeImageSrc(url);
            img.className = "gl-form-gallery__thumb";
            img.alt = "";
            img.style.cursor = "zoom-in";
            img.addEventListener("click", () => _openLightbox(url));

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
            // 5.1-d — même forme que le composant `image` : le refus reste SYNCHRONE, et on
            // n'attend la compression que si elle est nécessaire. `maxSizeMb` devient la
            // taille visée APRÈS compression. Voir `image-compress.ts`.
            const preErr = _validateFile(file, maxSizeMb * PRECOMPRESSION_FACTOR);
            if (preErr) {
                errorEl.textContent = _getLabel(preErr);
                errorEl.hidden = false;
                continue;
            }
            // Variable distincte : `file` est le `const` de la boucle `for…of`.
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
            if (endpoint) {
                try {
                    const url = await _uploadFile(toSend, endpoint);
                    urls.push(url);
                    onChange([...urls]);
                    renderGrid();
                } catch {
                    errorEl.textContent = _getLabel("form.error.uploadFailed");
                    errorEl.hidden = false;
                }
            } else {
                urls.push(_createObjectUrl(toSend));
                onChange([...urls]);
                renderGrid();
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
