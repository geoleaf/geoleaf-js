/*!
 * @geoleaf/field-renderer — hours component (weekly schedule)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Stores Record<string, Array<{ open: string; close: string; closed: boolean }>>.
 * Keys are day codes: mon, tue, wed, thu, fri, sat, sun.
 * fieldConfig extras:
 *   firstDay?: 'mon' | 'sun'  — display order (default 'mon')
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { _el, _getLabel } from "../helpers.js";

interface DaySlot {
    open: string;
    close: string;
    closed: boolean;
}

type HoursValue = Record<string, DaySlot[]>;

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type DayCode = (typeof DAYS)[number];

// Named on purpose rather than reached through DAY_LABELS["en"]: the fallback of a
// Record<string, …> lookup is itself a lookup, so it cannot prove it resolves. Binding the
// English table makes the invariant structural instead of asserted (qualite Q5).
const DAY_LABELS_EN: Record<DayCode, string> = {
    mon: "Mon",
    tue: "Tue",
    wed: "Wed",
    thu: "Thu",
    fri: "Fri",
    sat: "Sat",
    sun: "Sun",
};

const DAY_LABELS: Record<string, Record<DayCode, string>> = {
    fr: { mon: "Lun", tue: "Mar", wed: "Mer", thu: "Jeu", fri: "Ven", sat: "Sam", sun: "Dim" },
    en: DAY_LABELS_EN,
    es: { mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb", sun: "Dom" },
    pt: { mon: "Seg", tue: "Ter", wed: "Qua", thu: "Qui", fri: "Sex", sat: "Sáb", sun: "Dom" },
    it: { mon: "Lun", tue: "Mar", wed: "Mer", thu: "Gio", fri: "Ven", sat: "Sab", sun: "Dom" },
    de: { mon: "Mo", tue: "Di", wed: "Mi", thu: "Do", fri: "Fr", sat: "Sa", sun: "So" },
};

const CLOSED_LABELS: Record<string, string> = {
    fr: "Fermé",
    en: "Closed",
    es: "Cerrado",
    pt: "Fechado",
    it: "Chiuso",
    de: "Geschlossen",
};

const COPY_ALL_LABELS: Record<string, string> = {
    fr: "Copier sur tous les jours",
    en: "Copy to all days",
    es: "Copiar a todos los días",
    pt: "Copiar para todos os dias",
    it: "Copia a tutti i giorni",
    de: "Auf alle Tage kopieren",
};

function _getDayOrder(firstDay: string): DayCode[] {
    if (firstDay === "sun") {
        return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    }
    return [...DAYS];
}

function _pickLocalized(map: Record<string, string>, lang: string, fallback: string): string {
    return map[lang] ?? map["en"] ?? fallback;
}

function _getDayLabel(lang: string, day: DayCode): string {
    return (DAY_LABELS[lang] ?? DAY_LABELS_EN)[day];
}

function _emptyDay(): DaySlot {
    return { open: "08:00", close: "18:00", closed: false };
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function formRender(
    value: HoursValue,
    fieldConfig: FieldConfig,
    onChange: (v: HoursValue) => void,
    ctx: RenderCtx
): HTMLElement {
    const firstDay = (fieldConfig.firstDay as string | undefined) ?? "mon";
    const dayOrder = _getDayOrder(firstDay);
    const closedLabel = _pickLocalized(CLOSED_LABELS, ctx.lang, "Closed");
    const copyAllLabel = _pickLocalized(COPY_ALL_LABELS, ctx.lang, "Copy to all days");

    const hours: HoursValue = {};
    for (const day of DAYS) {
        hours[day] = value?.[day]?.map((s) => ({ ...s })) ?? [_emptyDay()];
    }

    const wrap = _el("div", "gl-form-field gl-form-hours");

    const labelEl = _el("span", "gl-form-label");
    labelEl.textContent = fieldConfig.label;
    if (fieldConfig.required) labelEl.dataset.required = "true";

    const table = _el("table", "gl-form-hours__editor");

    const errorEl = _el("span", "gl-form-error");
    errorEl.hidden = true;

    function emit(): void {
        onChange({ ...hours });
    }

    for (const day of dayOrder) {
        const slot = hours[day]?.[0] ?? _emptyDay();
        const tr = _el("tr", "gl-form-hours__row");

        const dayTd = _el("td", "gl-form-hours__day");
        dayTd.textContent = _getDayLabel(ctx.lang, day);

        const closedTd = _el("td", "gl-form-hours__closed");
        const closedChk = _el("input");
        closedChk.type = "checkbox";
        closedChk.id = `gl-hours-${day}-closed`;
        closedChk.checked = slot.closed;
        closedChk.disabled = !!ctx.readOnly;
        const closedLbl = _el("label");
        closedLbl.htmlFor = closedChk.id;
        closedLbl.textContent = closedLabel;
        closedTd.appendChild(closedChk);
        closedTd.appendChild(closedLbl);

        const openTd = _el("td");
        const openInput = _el("input");
        openInput.type = "time";
        openInput.className = "gl-form-input gl-form-hours__time";
        openInput.value = slot.open;
        openInput.disabled = !!ctx.readOnly || slot.closed;
        openInput.setAttribute("aria-label", `${_getDayLabel(ctx.lang, day)} open`);

        const closeTd = _el("td");
        const closeInput = _el("input");
        closeInput.type = "time";
        closeInput.className = "gl-form-input gl-form-hours__time";
        closeInput.value = slot.close;
        closeInput.disabled = !!ctx.readOnly || slot.closed;
        closeInput.setAttribute("aria-label", `${_getDayLabel(ctx.lang, day)} close`);

        // Copy-to-all button on the first row
        const actionTd = _el("td");
        if (day === dayOrder[0]) {
            const copyBtn = _el("button");
            copyBtn.type = "button";
            copyBtn.className = "gl-form-hours__copy-all";
            copyBtn.textContent = copyAllLabel;
            copyBtn.disabled = !!ctx.readOnly;
            copyBtn.addEventListener("click", () => {
                const src = hours[day]?.[0] ?? _emptyDay();
                for (const d of DAYS) {
                    hours[d] = [{ ...src }];
                }
                emit();
                // Re-render by replacing the form in-place
                const newForm = formRender(hours, fieldConfig, onChange, ctx);
                wrap.replaceWith(newForm);
            });
            actionTd.appendChild(copyBtn);
        }

        closedChk.addEventListener("change", () => {
            slot.closed = closedChk.checked;
            openInput.disabled = closedChk.checked;
            closeInput.disabled = closedChk.checked;
            hours[day] = [{ ...slot }];
            emit();
        });

        openInput.addEventListener("change", () => {
            if (TIME_PATTERN.test(openInput.value)) {
                slot.open = openInput.value;
                hours[day] = [{ ...slot }];
                emit();
                errorEl.hidden = true;
            } else {
                errorEl.textContent = _getLabel("form.error.timeFormat");
                errorEl.hidden = false;
            }
        });

        closeInput.addEventListener("change", () => {
            if (TIME_PATTERN.test(closeInput.value)) {
                slot.close = closeInput.value;
                hours[day] = [{ ...slot }];
                emit();
                errorEl.hidden = true;
            } else {
                errorEl.textContent = _getLabel("form.error.timeFormat");
                errorEl.hidden = false;
            }
        });

        openTd.appendChild(openInput);
        closeTd.appendChild(closeInput);
        tr.appendChild(dayTd);
        tr.appendChild(closedTd);
        tr.appendChild(openTd);
        tr.appendChild(closeTd);
        tr.appendChild(actionTd);
        table.appendChild(tr);
    }

    wrap.appendChild(labelEl);
    wrap.appendChild(table);
    wrap.appendChild(errorEl);
    return wrap;
}

function validator(value: HoursValue, fieldConfig: FieldConfig): string | null {
    if (!fieldConfig.required) return null;
    if (!value || Object.keys(value).length === 0) return "form.error.required";
    return null;
}

/**
 * Opening hours: per-day slots, each a start/end pair. The heaviest component of the set — a day may carry several slots or none.
 *
 * Registered under the id `hours`, and selected when a field declares `"type": "hours"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const hoursComponent: ComponentDefinition<HoursValue> = {
    id: "hours",
    defaults: Object.fromEntries(DAYS.map((d) => [d, [_emptyDay()]])) as HoursValue,
    formRender,
    validator,
};
