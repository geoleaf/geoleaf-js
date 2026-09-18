/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Secret redaction for text that leaves the application: the log entries read
 * back for a diagnostic, and the diagnostic itself.
 *
 * ## Why at read time
 *
 * A diagnostic is handed to support by mail or chat, and log lines carry what the application
 * handled: a tile URL with its key, an `Authorization` header, a signed query, a payload with a
 * password field. Redacting when entries are READ keeps a log call cheap — it pays for
 * formatting only — and nothing that is read back is raw.
 *
 * ## Why this module imports nothing
 *
 * `kernel/security` would be the natural neighbour, but it logs through `utils/log`: the log
 * importing it back would close an import cycle.
 *
 * ⚠️ Pattern-based redaction removes the shapes listed on {@link redactSecrets} — it is a net,
 * not a proof. A secret written in a sentence with none of those markers stays.
 */

const REDACTED = "[redacted]";

/** `scheme://user:password@host` — the whole userinfo part. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+@/gi;

/**
 * A query, fragment or space-separated parameter whose NAME says secret. The `t` cache token is
 * not one of them: it names the deployment that answered, and support needs it.
 */
const SECRET_PARAMETER =
    /(^|[?&#;\s])((?:[a-z0-9_-]*(?:token|secret|passw(?:or)?d|pwd|signature|credential|api[_-]?key|session[_-]?id)|key|code|sig|auth|jwt)=)[^&#\s"'<>]+/gim;

/** `Bearer <token>` — that scheme name is never prose. */
const BEARER = /\b([Bb]earer)\s+[A-Za-z0-9._~+/=-]+/g;

/** `Basic <base64>` — the token is judged by {@link _looksEncoded}: "Basic authentication" stays. */
const BASIC = /\b([Bb]asic)\s+([A-Za-z0-9+/]{8,}={0,2})(?![A-Za-z0-9+/=])/g;

/** A JSON Web Token: three base64url segments, the first one a JSON header (`eyJ`). */
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

/**
 * A JSON member: its key, the colon, and its value when that is a string or a scalar. An object
 * or array value is left unconsumed (empty third group), so the members inside it are visited.
 */
const JSON_MEMBER = /"([^"\\]{1,80})"(\s*:\s*)("(?:[^"\\]|\\.)*"|[^\s,{}[\]]+|(?=[{[]))/g;

/** A JSON key that names a secret. */
const SECRET_KEY =
    /passw(?:or)?d|pwd|secret|token|api[_-]?key|authorization|credential|cookie|session[_-]?id/i;

/** An e-mail address — not a high-density asset name such as `sprite@2x.png`. */
const EMAIL = /\b[A-Za-z0-9._%+-]+@(?!\d+x\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** A digit, `+`, `/` or `=`, or a capital letter past the first character: base64, not a word. */
function _looksEncoded(token: string): boolean {
    return /[0-9+/=]|.[A-Z]/.test(token);
}

/**
 * Removes from a piece of text the secrets this module knows the shape of.
 *
 * Redacted: the userinfo of a URL (`https://user:password@host`); query, fragment or
 * space-separated parameters whose name says secret (`key`, `code`, `sig`, `auth`, `jwt`, and any
 * name ending in `token`, `secret`, `password`, `signature`, `credential`, `apikey` or
 * `sessionid`); `Bearer` credentials, and `Basic` ones that look encoded; JSON Web Tokens; JSON
 * members whose key names a secret (`password`, `apiKey`, `authorization`, `cookie`…); e-mail
 * addresses. The `t` cache token is kept.
 *
 * @param text - Any text: a log message, a serialised diagnostic.
 * @returns The text, each secret replaced by a `[redacted…]` marker.
 */
export function redactSecrets(text: string): string {
    return text
        .replace(JWT, "[redacted-jwt]")
        .replace(BEARER, `$1 ${REDACTED}`)
        .replace(BASIC, (match: string, scheme: string, token: string) =>
            _looksEncoded(token) ? `${scheme} ${REDACTED}` : match
        )
        .replace(URL_CREDENTIALS, `$1${REDACTED}@`)
        .replace(SECRET_PARAMETER, `$1$2${REDACTED}`)
        .replace(JSON_MEMBER, (member: string, key: string, colon: string, value: string) =>
            value !== "" && SECRET_KEY.test(key) ? `"${key}"${colon}"${REDACTED}"` : member
        )
        .replace(EMAIL, "[redacted-email]");
}
