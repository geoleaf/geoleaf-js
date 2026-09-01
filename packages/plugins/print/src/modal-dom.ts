/*!
 * @geoleaf-plugins/print — Preview modal DOM (PLUGINS S6)
 *
 * Builds the preview modal's element tree and hands back typed references to
 * every node the interaction layer needs. Structure only: the sole listener set
 * here is the content-level `stopPropagation`, which exists to keep a click
 * inside the dialog from reaching the closing overlay — that is a property of
 * the tree, not a behaviour. Everything semantic (close, recompose, export) is
 * wired by `modal-open.ts`.
 *
 * Ids and class names are contractual: `geoleaf-print.css` and the test suite
 * both address the modal through them.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { PrintConfig } from "./config.js";
import type { PrintFlowOptions } from "./types.js";
import { formatScaleDenominator } from "./scale-format.js";

// `_el` was the 4th copy of the same helper (measure, print/internal,
// field-renderer); it now comes from the shared package, under its local name.
import { createEl as _el } from "@geoleaf/host-runtime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A checkbox and its wrapping label — the label carries the layout, the input the state. */
export interface CheckboxRef {
    label: HTMLLabelElement;
    input: HTMLInputElement;
}

/** Typed handles on every node the modal's behaviour needs. */
export interface ModalDom {
    modal: HTMLDivElement;
    overlay: HTMLDivElement;
    closeBtn: HTMLButtonElement;
    titleInput: HTMLInputElement;
    previewImg: HTMLImageElement;
    spinner: HTMLDivElement;
    legend: CheckboxRef;
    scale: CheckboxRef;
    north: CheckboxRef;
    /** Only built when plugin-measure is loaded. */
    annot: CheckboxRef | null;
    descArea: HTMLTextAreaElement;
    redefineLink: HTMLAnchorElement;
    formatSelect: HTMLSelectElement;
    exportButtons: Array<{ format: string; btn: HTMLButtonElement }>;
}

/** Inputs needed to lay out the modal — no map state, no session. */
interface ModalDomInputs {
    getLabel: (key: string) => string;
    config: PrintConfig;
    opts: PrintFlowOptions;
    /** Scale denominator locked by the emprise step, shown read-only in the footer. */
    lockedScale: number;
    currentFormat: string;
    /** Whether the core legend module is available — hides the legend checkbox when not. */
    hasLegend: boolean;
    /** Whether plugin-measure is loaded — gates the annotations checkbox entirely. */
    hasMeasure: boolean;
}

function _buildHeader(title: string): { header: HTMLDivElement; closeBtn: HTMLButtonElement } {
    const header = _el("div", "gl-print-modal__header");
    const h = _el("h2", "gl-print-modal__title");
    h.textContent = title;
    const closeBtn = _el("button", "gl-print-modal__close", {
        "aria-label": "Fermer",
        type: "button",
    });
    closeBtn.textContent = "×";
    header.appendChild(h);
    header.appendChild(closeBtn);
    return { header, closeBtn };
}

function _buildCheckbox(id: string, label: string, checked: boolean): CheckboxRef {
    const lbl = _el("label", "gl-print-check-label", { for: id });
    const inp = _el("input", "gl-print-check-input", { type: "checkbox", id });
    inp.checked = checked;
    lbl.appendChild(inp);
    lbl.append(` ${label}`);
    return { label: lbl, input: inp };
}

/** Title text field + its label, wrapped in a form group. */
function _buildTitleField(getLabel: ModalDomInputs["getLabel"], value: string) {
    const wrap = _el("div", "gl-print-form-group");
    const label = _el("label", "gl-print-form-label", { for: "gl-print-title" });
    label.textContent = getLabel("print.modal.field.title");
    const input = _el("input", "gl-print-form-input", {
        id: "gl-print-title",
        type: "text",
        maxlength: "120",
    });
    input.value = value;
    wrap.appendChild(label);
    wrap.appendChild(input);
    return { wrap, input };
}

/** Description textarea + its label, wrapped in a form group. */
function _buildDescField(getLabel: ModalDomInputs["getLabel"]) {
    const wrap = _el("div", "gl-print-form-group");
    const label = _el("label", "gl-print-form-label", { for: "gl-print-desc" });
    label.textContent = getLabel("print.modal.field.description");
    const area = _el("textarea", "gl-print-form-input gl-print-desc", {
        id: "gl-print-desc",
        rows: "2",
    });
    wrap.appendChild(label);
    wrap.appendChild(area);
    return { wrap, area };
}

/** Preview image plus the spinner overlaid on it. */
function _buildPreview() {
    const wrap = _el("div", "gl-print-preview-wrap");
    const img = _el("img", "gl-print-preview-img");
    img.alt = "";
    const spinner = _el("div", "gl-print-spinner");
    spinner.innerHTML = `<div class="gl-print-spinner__icon"></div>`; // SAFE: static markup
    spinner.style.display = "none";
    wrap.appendChild(img);
    wrap.appendChild(spinner);
    return { wrap, img, spinner };
}

/** The four overlay checkboxes; `annot` is null when plugin-measure is absent. */
function _buildChecks(inputs: ModalDomInputs) {
    const { getLabel, config, opts } = inputs;
    const wrap = _el("div", "gl-print-checks");

    const legend = _buildCheckbox(
        "gl-print-chk-legend",
        getLabel("print.modal.check.legend"),
        opts.includeLegend ?? config.includeLegend
    );
    if (!inputs.hasLegend) legend.label.style.display = "none";

    const scale = _buildCheckbox(
        "gl-print-chk-scale",
        getLabel("print.modal.check.scale"),
        opts.includeScale ?? config.includeScale
    );
    const north = _buildCheckbox(
        "gl-print-chk-north",
        getLabel("print.modal.check.northArrow"),
        opts.includeNorthArrow ?? config.includeNorthArrow
    );
    const annot = inputs.hasMeasure
        ? _buildCheckbox(
              "gl-print-chk-annot",
              getLabel("print.modal.check.annotations"),
              (opts.includeAnnotations ?? config.includeAnnotations) !== false
          )
        : null;

    wrap.appendChild(legend.label);
    wrap.appendChild(scale.label);
    wrap.appendChild(north.label);
    if (annot) wrap.appendChild(annot.label);

    return { wrap, legend, scale, north, annot };
}

/** Footer: locked scale + format selector on the left, export buttons on the right. */
function _buildFooter(inputs: ModalDomInputs) {
    const { getLabel, config, lockedScale, currentFormat } = inputs;
    const footer = _el("div", "gl-print-modal__footer");

    const footerLeft = _el("div", "gl-print-footer-left");
    const scaleLocked = _el("span", "gl-print-scale-locked");
    scaleLocked.title = getLabel("print.modal.scaleLocked");
    scaleLocked.textContent = `🔒 1:${formatScaleDenominator(lockedScale)}`;
    footerLeft.appendChild(scaleLocked);

    const formatSelect = _el("select", "gl-print-format-select", {
        "aria-label": getLabel("print.modal.format"),
    });
    (config.availableFormats ?? ["A4", "A3"]).forEach((fmt) => {
        const opt = _el("option", "", { value: fmt });
        opt.textContent = fmt;
        if (fmt === currentFormat) opt.selected = true;
        formatSelect.appendChild(opt);
    });
    footerLeft.appendChild(formatSelect);
    footer.appendChild(footerLeft);

    const footerRight = _el("div", "gl-print-footer-right");
    const exportButtons = (config.exportFormats ?? ["pdf", "jpg"]).map((format) => {
        const btn = _el("button", `gl-print-btn gl-print-btn--${format}`, { type: "button" });
        btn.textContent = getLabel(`print.btn.${format}`);
        footerRight.appendChild(btn);
        return { format, btn };
    });
    footer.appendChild(footerRight);

    return { footer, formatSelect, exportButtons };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Id of the modal root — also used to evict a stale modal before opening a new one. */
export const MODAL_ID = "gl-print-modal";

/**
 * Builds the whole modal tree, detached from the document.
 * The caller mounts it and wires every semantic listener.
 */
export function buildModalDom(inputs: ModalDomInputs): ModalDom {
    const { getLabel, config, opts } = inputs;

    const modal = _el("div", "gl-print-modal");
    modal.id = MODAL_ID;

    const overlay = _el("div", "gl-print-modal__overlay");
    const content = _el("div", "gl-print-modal__content");
    // Keeps a click inside the dialog from reaching the closing overlay.
    content.onclick = (e) => e.stopPropagation();

    const { header, closeBtn } = _buildHeader(getLabel("print.modal.title"));

    const body = _el("div", "gl-print-modal__body");
    const title = _buildTitleField(getLabel, opts.title ?? config.title);
    const preview = _buildPreview();
    const checks = _buildChecks(inputs);
    const desc = _buildDescField(getLabel);

    const redefineLink = _el("a", "gl-print-redefine", { href: "#", role: "button" });
    redefineLink.textContent = getLabel("print.modal.redefineExtent");

    body.appendChild(title.wrap);
    body.appendChild(preview.wrap);
    body.appendChild(checks.wrap);
    body.appendChild(desc.wrap);
    body.appendChild(redefineLink);
    body.appendChild(_el("hr", "gl-print-separator"));

    const { footer, formatSelect, exportButtons } = _buildFooter(inputs);

    content.appendChild(header);
    content.appendChild(body);
    content.appendChild(footer);
    modal.appendChild(overlay);
    modal.appendChild(content);

    return {
        modal,
        overlay,
        closeBtn,
        titleInput: title.input,
        previewImg: preview.img,
        spinner: preview.spinner,
        legend: checks.legend,
        scale: checks.scale,
        north: checks.north,
        annot: checks.annot,
        descArea: desc.area,
        redefineLink,
        formatSelect,
        exportButtons,
    };
}
