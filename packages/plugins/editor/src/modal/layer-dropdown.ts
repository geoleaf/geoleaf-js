/*!
 * @geoleaf-plugins/editor — Layer target dropdown
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { EditorConfig } from "../types.js";
import { _el, _getLabel } from "../internal.js";
import { getEditableLayers } from "../config.js";

interface LayerDropdown {
    /** .gl-form-field wrapper containing the label + select. */
    el: HTMLElement;
    getValue(): string | null;
    setValue(layerId: string): void;
    destroy(): void;
}

/**
 * Creates a layer-target `<select>` pre-filtered to editable layers.
 * Pass `geometryType` to further restrict by compatible geometry types.
 */
export function createLayerDropdown(cfg: EditorConfig, geometryType?: string): LayerDropdown {
    const layers = getEditableLayers(geometryType);

    const wrapper = _el("div", "gl-form-field gl-form-modal__layer");
    const label = _el("label", "gl-form-label");
    label.textContent = _getLabel("editor.modal.layer.dropdown");

    const select = _el("select", "gl-form-input");

    if (layers.length === 0) {
        const opt = _el("option");
        opt.textContent = _getLabel("editor.modal.layer.noLayer");
        opt.value = "";
        opt.disabled = true;
        select.appendChild(opt);
    } else {
        // With several compatible layers, show an unselectable placeholder first
        // so no form loads until the user picks a layer (value === '').
        if (layers.length > 1) {
            const placeholder = _el("option");
            placeholder.textContent = _getLabel("editor.modal.layer.placeholder");
            placeholder.value = "";
            placeholder.disabled = true;
            placeholder.selected = true;
            select.appendChild(placeholder);
        }

        layers.forEach((layer) => {
            const opt = _el("option");
            opt.value = layer.id;
            opt.textContent = layer.label ?? layer.id;
            select.appendChild(opt);
        });

        // Pre-selection priority: explicit defaultLayer, else the single layer.
        if (cfg.defaultLayer && layers.some((l) => l.id === cfg.defaultLayer)) {
            select.value = cfg.defaultLayer;
        } else if (layers.length === 1) {
            const [only] = layers;
            if (only) select.value = only.id;
        }
    }

    wrapper.appendChild(label);
    wrapper.appendChild(select);

    return {
        el: wrapper,
        getValue(): string | null {
            return select.value || null;
        },
        setValue(layerId: string): void {
            if (Array.from(select.options).some((o) => o.value === layerId)) {
                select.value = layerId;
            }
        },
        destroy(): void {
            wrapper.remove();
        },
    };
}
