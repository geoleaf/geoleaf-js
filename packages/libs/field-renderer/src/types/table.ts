/*!
 * @geoleaf/field-renderer — table component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Stores Array<Record<string, string>> — one object per row, keys = column keys.
 * fieldConfig extras:
 *   columns: Array<{ key: string; label: string }>  — required, defines columns
 *   maxRows?: number                                 — maximum allowed rows
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { required as vRequired } from "../validators.js";
import { _el, _getLabel } from "../helpers.js";

interface TableColumn {
    key: string;
    label: string;
}

type TableRow = Record<string, string>;

function _getColumns(fieldConfig: FieldConfig): TableColumn[] {
    return (fieldConfig.columns as TableColumn[] | undefined) ?? [];
}

function formRender(
    value: TableRow[],
    fieldConfig: FieldConfig,
    onChange: (v: TableRow[]) => void,
    ctx: RenderCtx
): HTMLElement {
    const columns = _getColumns(fieldConfig);
    const rows: TableRow[] = Array.isArray(value) ? value.map((r) => ({ ...r })) : [];
    const maxRows = fieldConfig.maxRows != null ? Number(fieldConfig.maxRows) : Infinity;

    const wrap = _el("div", "gl-form-field gl-form-table");

    const labelEl = _el("span", "gl-form-label");
    labelEl.textContent = fieldConfig.label;
    if (fieldConfig.required) labelEl.dataset.required = "true";

    const tableWrap = _el("div", "gl-form-table__editor-wrap");

    const table = _el("table", "gl-form-table__editor");

    const thead = _el("thead");
    const headerRow = _el("tr");
    for (const col of columns) {
        const th = _el("th");
        th.textContent = col.label;
        headerRow.appendChild(th);
    }
    const actionTh = _el("th", "gl-form-table__action-col");
    headerRow.appendChild(actionTh);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = _el("tbody");

    const errorEl = _el("span", "gl-form-error");
    errorEl.hidden = true;

    function renderRows(): void {
        tbody.innerHTML = "";
        rows.forEach((row, rowIdx) => {
            const tr = _el("tr");
            for (const col of columns) {
                const td = _el("td");
                const input = _el("input");
                input.type = "text";
                input.className = "gl-form-input";
                input.value = row[col.key] ?? "";
                input.disabled = !!ctx.readOnly;
                input.setAttribute("aria-label", col.label);
                input.addEventListener("input", () => {
                    const target = rows[rowIdx];
                    if (!target) return;
                    target[col.key] = input.value;
                    onChange(rows.map((r) => ({ ...r })));
                });
                td.appendChild(input);
                tr.appendChild(td);
            }
            const actionTd = _el("td", "gl-form-table__action-col");
            const removeBtn = _el("button");
            removeBtn.type = "button";
            removeBtn.className = "gl-form-table__remove-row";
            removeBtn.textContent = "×";
            removeBtn.setAttribute("aria-label", _getLabel("form.aria.tableRowRemove"));
            removeBtn.disabled = !!ctx.readOnly;
            removeBtn.addEventListener("click", () => {
                rows.splice(rowIdx, 1);
                onChange(rows.map((r) => ({ ...r })));
                renderRows();
            });
            actionTd.appendChild(removeBtn);
            tr.appendChild(actionTd);
            tbody.appendChild(tr);
        });
    }

    table.appendChild(tbody);
    tableWrap.appendChild(table);

    const addBtn = _el("button");
    addBtn.type = "button";
    addBtn.className = "gl-form-table__add-row";
    addBtn.textContent = `+ ${_getLabel("form.label.tableAddRow")}`;
    addBtn.disabled = !!ctx.readOnly;
    addBtn.addEventListener("click", () => {
        if (rows.length >= maxRows) return;
        const newRow: TableRow = {};
        for (const col of columns) newRow[col.key] = "";
        rows.push(newRow);
        onChange(rows.map((r) => ({ ...r })));
        renderRows();
        const lastInput = tbody.querySelector<HTMLInputElement>("tr:last-child input");
        lastInput?.focus();
    });

    renderRows();
    wrap.appendChild(labelEl);
    wrap.appendChild(tableWrap);
    wrap.appendChild(addBtn);
    wrap.appendChild(errorEl);
    return wrap;
}

function validator(value: TableRow[], fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    return null;
}

/**
 * Tabular rows against the field's declared columns. The form edits rows in place.
 *
 * Registered under the id `table`, and selected when a field declares `"type": "table"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const tableComponent: ComponentDefinition<TableRow[]> = {
    id: "table",
    defaults: [],
    formRender,
    validator,
};
