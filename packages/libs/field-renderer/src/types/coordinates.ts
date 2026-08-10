/*!
 * @geoleaf/field-renderer — coordinates component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Stores { lat: number; lng: number }.
 * Side panel shows formatted coordinates with a copy-to-clipboard button.
 * Form includes a "Capture from map" button that calls ctx.onCapturePosition.
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { range as vRange } from "../validators.js";
import { _el, _getLabel } from "../helpers.js";

interface CoordsValue {
    lat: number;
    lng: number;
}

function formRender(
    value: CoordsValue,
    fieldConfig: FieldConfig,
    onChange: (v: CoordsValue) => void,
    ctx: RenderCtx
): HTMLElement {
    const current: CoordsValue = {
        lat: value?.lat ?? 0,
        lng: value?.lng ?? 0,
    };

    const wrap = _el("div", "gl-form-field gl-form-coordinates");

    const labelEl = _el("label", "gl-form-label");
    labelEl.textContent = fieldConfig.label;
    if (fieldConfig.required) labelEl.dataset.required = "true";

    const row = _el("div", "gl-form-coordinates__row");

    const latInput = _el("input");
    latInput.type = "number";
    latInput.className = "gl-form-input gl-form-coordinates__lat";
    latInput.step = "any";
    latInput.min = "-90";
    latInput.max = "90";
    latInput.value = String(current.lat);
    latInput.disabled = !!ctx.readOnly;
    latInput.setAttribute("aria-label", _getLabel("form.aria.latitude"));
    latInput.placeholder = _getLabel("form.placeholder.lat");
    labelEl.htmlFor = latInput.id = `gl-field-${fieldConfig.id}-lat`;

    const lngInput = _el("input");
    lngInput.type = "number";
    lngInput.className = "gl-form-input gl-form-coordinates__lng";
    lngInput.step = "any";
    lngInput.min = "-180";
    lngInput.max = "180";
    lngInput.value = String(current.lng);
    lngInput.disabled = !!ctx.readOnly;
    lngInput.setAttribute("aria-label", _getLabel("form.aria.longitude"));
    lngInput.placeholder = _getLabel("form.placeholder.lng");

    const errorEl = _el("span", "gl-form-error");
    errorEl.hidden = true;

    function updateFromInputs(): void {
        const lat = parseFloat(latInput.value);
        const lng = parseFloat(lngInput.value);
        if (!isNaN(lat) && !isNaN(lng)) {
            current.lat = lat;
            current.lng = lng;
            onChange({ ...current });
            errorEl.hidden = true;
        }
    }

    latInput.addEventListener("input", updateFromInputs);
    lngInput.addEventListener("input", updateFromInputs);

    row.appendChild(latInput);
    row.appendChild(lngInput);

    if (ctx.onCapturePosition && !ctx.readOnly) {
        const captureBtn = _el("button");
        captureBtn.type = "button";
        captureBtn.className = "gl-form-coordinates__capture";
        captureBtn.textContent = `📍 ${_getLabel("form.label.capture")}`;
        captureBtn.setAttribute("aria-label", _getLabel("form.aria.coordsCapture"));
        captureBtn.addEventListener("click", () => {
            captureBtn.disabled = true;
            captureBtn.classList.add("is-capturing");
            ctx.onCapturePosition!((lat, lng) => {
                current.lat = lat;
                current.lng = lng;
                latInput.value = String(lat);
                lngInput.value = String(lng);
                onChange({ ...current });
                captureBtn.disabled = false;
                captureBtn.classList.remove("is-capturing");
            });
        });
        row.appendChild(captureBtn);
    } else if (!ctx.readOnly) {
        // No map context available — show disabled capture button
        const captureBtn = _el("button");
        captureBtn.type = "button";
        captureBtn.className = "gl-form-coordinates__capture";
        captureBtn.textContent = `📍 ${_getLabel("form.label.capture")}`;
        captureBtn.disabled = true;
        captureBtn.setAttribute("aria-label", _getLabel("form.aria.coordsCaptureUnavailable"));
        captureBtn.title = _getLabel("form.title.captureUnavailable");
        row.appendChild(captureBtn);
    }

    wrap.appendChild(labelEl);
    wrap.appendChild(row);
    wrap.appendChild(errorEl);
    return wrap;
}

function validator(value: CoordsValue, fieldConfig: FieldConfig): string | null {
    if (!value) return fieldConfig.required ? "form.error.required" : null;
    const latErr = vRange(value.lat, -90, 90);
    if (latErr) return latErr;
    const lngErr = vRange(value.lng, -180, 180);
    if (lngErr) return lngErr;
    return null;
}

/**
 * A latitude/longitude pair. The form offers two numeric inputs; the sidepanel renders the formatted pair.
 *
 * Registered under the id `coordinates`, and selected when a field declares `"type": "coordinates"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const coordinatesComponent: ComponentDefinition<CoordsValue> = {
    id: "coordinates",
    defaults: { lat: 0, lng: 0 },
    formRender,
    validator,
};
