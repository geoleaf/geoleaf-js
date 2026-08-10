/*!
 * @geoleaf/field-renderer — Field validators
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * All validators are pure functions returning either null (valid) or an i18n error key string.
 * https://geoleaf.dev
 */

/** True when the value is considered "present" (non-empty string, non-null, non-undefined). */
function hasValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

/** Rejects empty / blank values. */
export function required(value: unknown): string | null {
    return hasValue(value) ? null : "form.error.required";
}

/** Rejects values that do not match the given regex pattern. Passes if the value is empty. */
export function pattern(value: unknown, regex: RegExp): string | null {
    if (!hasValue(value)) return null;
    return regex.test(String(value)) ? null : "form.error.pattern";
}

/** Rejects values that are not valid http(s) or mailto or tel URLs. Passes if empty. */
export function url(value: unknown): string | null {
    if (!hasValue(value)) return null;
    try {
        const parsed = new URL(String(value));
        return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)
            ? null
            : "form.error.url";
    } catch {
        return "form.error.url";
    }
}

/** Rejects values that do not look like phone numbers (E.164 or common national formats). Passes if empty. */
export function tel(value: unknown): string | null {
    if (!hasValue(value)) return null;
    // Allows +, digits, spaces, hyphens, parentheses — minimum 6 digits.
    const digits = String(value).replace(/[\s\-().+]/g, "");
    return /^\d{6,15}$/.test(digits) ? null : "form.error.tel";
}

/** Rejects values that are not valid e-mail addresses. Passes if empty. */
export function email(value: unknown): string | null {
    if (!hasValue(value)) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)) ? null : "form.error.email";
}

/** Rejects numeric values outside [min, max]. Passes if empty or non-numeric. */
export function range(value: unknown, min: number, max: number): string | null {
    if (!hasValue(value)) return null;
    const n = Number(value);
    if (isNaN(n)) return null;
    if (n < min) return "form.error.min";
    if (n > max) return "form.error.max";
    return null;
}

/** Rejects string values longer than maxLen characters. Passes if empty. */
export function maxLength(value: unknown, maxLen: number): string | null {
    if (!hasValue(value)) return null;
    return String(value).length <= maxLen ? null : "form.error.maxLength";
}

/** Rejects string values shorter than minLen characters. Passes if empty. */
export function minLength(value: unknown, minLen: number): string | null {
    if (!hasValue(value)) return null;
    return String(value).length >= minLen ? null : "form.error.minLength";
}

/** Rejects values that are not E.164-simplified phone numbers (+country followed by 6-14 digits). Passes if empty. */
export function phoneE164(value: unknown): string | null {
    if (!hasValue(value)) return null;
    return /^\+?[1-9]\d{6,14}$/.test(String(value).replace(/[\s\-().]/g, ""))
        ? null
        : "form.error.phoneE164";
}

/** Rejects arrays with fewer than minCount items. Passes if empty. */
export function minItems(value: unknown, minCount: number): string | null {
    if (!Array.isArray(value)) return null;
    return value.length >= minCount ? null : "form.error.minItems";
}

/** Rejects values that are not a valid ISO date string (YYYY-MM-DD). Passes if empty. */
export function dateISO(value: unknown): string | null {
    if (!hasValue(value)) return null;
    const s = String(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "form.error.date";
    const d = new Date(s);
    return isNaN(d.getTime()) ? "form.error.date" : null;
}
