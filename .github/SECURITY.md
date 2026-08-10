# Security Policy — GeoLeaf

## Supported Versions

Versioning is **independent per package**; the supported line is each package's current major.
Published versions are printed by `npm run versions:check` — they are deliberately not copied
here, this table having already sat a whole major behind (it read `2.x` while the core shipped
`3.0.0`).

| Version                       | Supported          |
| ----------------------------- | ------------------ |
| Current major of each package | :white_check_mark: |
| Any earlier major             | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

### Contact

Send your report to: **contact@geoleaf.dev**

Include in your report:

- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Affected version(s)
- Any suggested mitigation or fix (optional)

### Response Timeline

| Step                          | Timeframe        |
| ----------------------------- | ---------------- |
| Acknowledgement of receipt    | Within 48 hours  |
| Initial triage and assessment | Within 5 days    |
| Status update                 | Every 7 days     |
| Fix or workaround             | Within 30 days   |
| Public disclosure             | After fix is out |

We follow a **coordinated disclosure** model. We ask that you give us reasonable time to address the vulnerability before any public disclosure.

## Scope

This policy covers the whole `GeoLeaf-Js` monorepo — every package it publishes to npmjs:

| Package                | Scope                                                    |
| ---------------------- | -------------------------------------------------------- |
| `@geoleaf/core`        | The engine — `packages/core/src/`                        |
| `@geoleaf-plugins/*`   | All published plugins                                    |
| `@geoleaf/*` libraries | Shared libraries (`field-renderer`, `host-runtime`)      |
| Build pipeline         | `scripts/`, `.github/workflows/`, deployment build chain |

### In scope

- Cross-Site Scripting (XSS) vulnerabilities in the security module
- CSRF token bypass
- Prototype pollution
- Unsafe HTML injection via the DOM
- URL validation bypass allowing dangerous protocol execution
- Dependency vulnerabilities with direct exploit paths

### Out of scope

- Vulnerabilities in MapLibre GL or other peer dependencies (please report to those projects directly)
- Issues that require physical access to the user's device
- Social engineering attacks
- Issues in outdated, unsupported versions (any majeure below the current one)
- Denial of service attacks against a deployed instance

## Security Architecture

GeoLeaf implements multiple layers of protection:

All paths below are relative to `packages/core/src/` and were re-verified against the code on
31/07/2026. They previously all named a `modules/` root **dissolved at R.9** — six dead paths
in the policy GitHub renders in its own Security tab, invisible to every gate because this file
sat outside their perimeter until that date.

- **XSS protection**: `kernel/security/escaping.ts` — `escapeHtml()`, `escapeAttribute()` ·
  `kernel/security/sanitizers.ts` — `sanitizeHTML()`, `sanitizeSvgContent()`
- **CSRF protection**: `kernel/security/csrf-token.ts` — token generation and validation for POST operations
- **DOM security**: `kernel/security/dom-security.ts` — replaces all direct `innerHTML` usage
- **Input validation**: `kernel/security/validators.ts` — URL whitelist and the exact `data:`
  MIME allow-list. `https:`, `http:` and image `data:` URLs pass by default; `isValidUrl()`
  takes an `httpsOnly` option that rejects `http:`, but see Known Limitations — nothing
  currently passes it
- **Fetch security**: `utils/general/fetch-helper.ts` — URL validation + rate limiting
  (`maxPerDomain: 50` / `windowMs: 10000`, i.e. 50 req/10 s/domain)
- **Error sanitization**: `utils/errors/errors.ts` — `sanitizeErrorMessage()` escapes HTML in error messages

## Deployment Security Recommendations

See [`packages/core/docs/SECURITY.md`](../packages/core/docs/SECURITY.md) and [`packages/core/docs/security/`](../packages/core/docs/security/) for recommended HTTP headers, CSP configuration, and security architecture guidance.

## Known Limitations

- `data:` URLs for images are permitted by design, restricted to an **exact** MIME whitelist —
  not a `startsWith("image/")` prefix test. The canonical source is `ALLOWED_DATA_URL_TYPES` in
  `kernel/security/validators.ts`; as of 31/07/2026 it holds six entries (`image/png`,
  `image/jpeg`, `image/jpg`, `image/gif`, `image/svg+xml`, `image/webp`). ⚠️ This line listed
  **five** and omitted `image/jpg` — read the constant rather than this copy.
- The library accepts both `http:` and `https:` protocols, and **there is currently no profile
  setting to change that**. ⚠️ This line promised a `security.httpsOnly` configuration option
  until 31/07/2026; measured, it is not one. `httpsOnly` is a **call-site option** of
  `isValidUrl()` (`kernel/security/validators.ts`), it was **removed from every JSON schema** on
  26/06/2026 as a 0-consumer key, and **no call site passes it** — so an integrator cannot turn
  it on. Enforce HTTPS at the deployment layer (CSP `upgrade-insecure-requests`, HSTS) until the
  option is wired back; see [`packages/core/docs/SECURITY.md`](../packages/core/docs/SECURITY.md).
- The Service Worker does not implement authentication checks — it handles only static/cacheable resources.

## Bug Bounty

There is currently **no formal bug bounty program**. Responsible disclosure is always appreciated and credited in the changelog (with your permission).
