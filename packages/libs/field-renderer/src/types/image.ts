/*!
 * @geoleaf/field-renderer — image component (single upload)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Stores a URL string. Uploads via fetch to fieldConfig.uploadEndpoint (POST multipart/form-data).
 * Falls back to a URL text input when uploadEndpoint is absent.
 * fieldConfig extras:
 *   uploadEndpoint?: string   — POST endpoint; response must be JSON { url: string }
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
    value: string,
    fieldConfig: FieldConfig,
    onChange: (v: string) => void,
    ctx: RenderCtx
): HTMLElement {
    const endpoint = fieldConfig.uploadEndpoint as string | undefined;
    const maxSizeMb = fieldConfig.maxSizeMb != null ? Number(fieldConfig.maxSizeMb) : 5;
    let currentUrl = value ?? "";

    const wrap = _el("div", "gl-form-field gl-form-image");

    const labelEl = _el("label", "gl-form-label");
    labelEl.textContent = fieldConfig.label;
    if (fieldConfig.required) labelEl.dataset.required = "true";

    const errorEl = _el("span", "gl-form-error");
    errorEl.hidden = true;

    const previewWrap = _el("div", "gl-form-image__preview-wrap");

    function showError(msg: string): void {
        errorEl.textContent = _getLabel(msg);
        errorEl.hidden = false;
    }

    function renderPreview(): void {
        previewWrap.innerHTML = "";
        if (!currentUrl) return;
        const img = _el("img");
        // Protocol-checked like the side-panel path.
        img.src = _safeImageSrc(currentUrl);
        img.className = "gl-form-image__preview";
        img.alt = "";
        img.style.cursor = "zoom-in";
        img.addEventListener("click", () => _openLightbox(currentUrl));
        const removeBtn = _el("button");
        removeBtn.type = "button";
        removeBtn.className = "gl-form-image__remove";
        removeBtn.textContent = "×";
        removeBtn.setAttribute("aria-label", _getLabel("form.aria.imageRemove"));
        removeBtn.disabled = !!ctx.readOnly;
        removeBtn.addEventListener("click", () => {
            currentUrl = "";
            onChange("");
            renderPreview();
        });
        previewWrap.appendChild(img);
        previewWrap.appendChild(removeBtn);
    }

    async function handleFile(file: File): Promise<void> {
        // THE REFUSAL STAYS SYNCHRONOUS, and that is not a style detail: a
        // first draft waited for the compression before showing any error,
        // pushing the refusal back a tick. Four tests saw it at once
        // (`errorEl.hidden` still `true`), and a user would have seen it too
        // — a file refused with no immediate message reads as an unresponsive interface.
        const preErr = _validateFile(file, maxSizeMb * PRECOMPRESSION_FACTOR);
        if (preErr) {
            showError(preErr);
            return;
        }
        errorEl.hidden = true;

        // The wait is only paid when compression is really needed.
        // ⚠️ `maxSizeMb` is now the size aimed for AFTER compression: an 8 MB
        // phone photo, until now refused with no recourse, now passes.
        let toSend = file;
        if (file.size > maxSizeMb * 1024 * 1024) {
            dropZone.classList.add("is-uploading");
            const outcome = await compressToFit(file, maxSizeMb);
            dropZone.classList.remove("is-uploading");
            if (outcome.error) {
                showError(outcome.error);
                return;
            }
            toSend = outcome.file;
        }

        if (endpoint) {
            dropZone.classList.add("is-uploading");
            try {
                currentUrl = await _uploadFile(toSend, endpoint);
                onChange(currentUrl);
                renderPreview();
            } catch {
                showError("form.error.uploadFailed");
            } finally {
                dropZone.classList.remove("is-uploading");
            }
        } else {
            // Fallback: use object URL (not persisted — caller must handle)
            currentUrl = _createObjectUrl(toSend);
            onChange(currentUrl);
            renderPreview();
        }
    }

    labelEl.htmlFor = `gl-field-${fieldConfig.id}-file`;

    let dropZone: HTMLElement;

    if (endpoint || !ctx.readOnly) {
        dropZone = _el("div");
        dropZone.className = "gl-form-image__drop-zone";
        dropZone.setAttribute("role", "button");
        dropZone.setAttribute("tabindex", "0");

        const fileInput = _el("input");
        fileInput.type = "file";
        fileInput.accept = ACCEPTED_ACCEPT;
        fileInput.id = `gl-field-${fieldConfig.id}-file`;
        fileInput.className = "gl-form-image__file-input";
        fileInput.disabled = !!ctx.readOnly;
        fileInput.addEventListener("change", () => {
            const file = fileInput.files?.[0];
            if (file) void handleFile(file);
        });

        const dropLabel = _el("span");
        dropLabel.textContent = _getLabel("form.label.imageDropzone");

        dropZone.appendChild(dropLabel);
        dropZone.appendChild(fileInput);

        dropZone.addEventListener("click", () => fileInput.click());
        dropZone.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") fileInput.click();
        });
        dropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropZone.classList.add("is-over");
        });
        dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-over"));
        dropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            dropZone.classList.remove("is-over");
            const file = e.dataTransfer?.files[0];
            if (file) void handleFile(file);
        });

        wrap.appendChild(labelEl);
        renderPreview();
        wrap.appendChild(previewWrap);
        wrap.appendChild(dropZone);
    } else {
        // No endpoint and readOnly — URL text input fallback
        const urlInput = _el("input");
        urlInput.type = "url";
        urlInput.className = "gl-form-input";
        urlInput.value = currentUrl;
        urlInput.disabled = !!ctx.readOnly;
        urlInput.id = `gl-field-${fieldConfig.id}-url`;
        labelEl.htmlFor = urlInput.id;
        urlInput.addEventListener("input", () => {
            currentUrl = urlInput.value;
            onChange(currentUrl);
            renderPreview();
        });
        dropZone = wrap; // dummy ref
        wrap.appendChild(labelEl);
        renderPreview();
        wrap.appendChild(previewWrap);
        wrap.appendChild(urlInput);
    }

    wrap.appendChild(errorEl);
    return wrap;
}

function validator(value: string, fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    return null;
}

/**
 * A single image URL. The sidepanel renders the image; the form takes the URL.
 *
 * Registered under the id `image`, and selected when a field declares `"type": "image"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const imageComponent: ComponentDefinition<string> = {
    id: "image",
    defaults: "",
    formRender,
    validator,
};
