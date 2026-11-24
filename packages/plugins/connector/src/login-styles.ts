/*!
 * GeoLeaf Connector — Login window styles
 * Colors follow the active GeoLeaf theme through --gl-color-* custom properties.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The login window's stylesheet, adopted once (CSP-safe constructable stylesheet, never a
 * `<style>`). Shared by its two presentations — the modal and the form mounted in an element
 * of the host (`.gc-mounted`).
 */
export const LOGIN_CSS = `
.gc-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--gl-z-window, 1049);
  font-family: var(--gl-font-family, system-ui, -apple-system, sans-serif);
}
.gc-modal {
  position: relative;
  background: var(--gl-color-bg-surface, #ffffff);
  color: var(--gl-color-text-main, #0f172a);
  border: 1px solid var(--gl-color-border-soft, rgba(15,23,42,0.08));
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.24);
  padding: 2rem;
  width: 100%;
  max-width: 360px;
  box-sizing: border-box;
}
.gc-modal h2 {
  margin: 0 0 1.25rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--gl-color-text-main, #0f172a);
}
.gc-modal label {
  display: block;
  margin-bottom: 0.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--gl-color-text-muted, #374151);
}
/* A form control does not inherit its font: left alone, the fields and the buttons are drawn
   in the browser's own, next to labels written in the application's. */
.gc-modal input,
.gc-modal button {
  font-family: inherit;
}
.gc-modal input {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  margin-bottom: 1rem;
  background: var(--gl-color-bg-surface-muted, #f9fafb);
  color: var(--gl-color-text-main, #0f172a);
  border: 1px solid var(--gl-color-border-strong, rgba(15,23,42,0.22));
  border-radius: 6px;
  font-size: 1rem;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.gc-modal input::placeholder {
  color: var(--gl-color-text-muted, #9ca3af);
  opacity: 0.7;
}
.gc-modal input:focus {
  border-color: var(--gl-color-accent, #3b82f6);
  box-shadow: 0 0 0 2px var(--gl-color-accent-soft, rgba(59,130,246,0.25));
}
.gc-modal button[type="submit"] {
  width: 100%;
  padding: 0.625rem 1rem;
  background: var(--gl-color-accent, #3b82f6);
  color: var(--gl-color-accent-contrast, #ffffff);
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.gc-modal button[type="submit"]:hover:not(:disabled) {
  background: var(--gl-color-accent-hover, #2563eb);
}
.gc-modal button[type="submit"]:disabled {
  background: var(--gl-color-accent-soft, #93c5fd);
  color: var(--gl-color-text-muted, #ffffff);
  cursor: not-allowed;
}
.gc-error {
  color: #dc2626;
  font-size: 0.875rem;
  margin: 0 0 0.75rem;
  min-height: 1.25em;
}
.gc-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--gl-color-text-muted, #6b7280);
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
  transition: background 0.15s, color 0.15s;
}
.gc-close:hover {
  background: var(--gl-color-bg-surface-muted, #f3f4f6);
  color: var(--gl-color-text-main, #111);
}
.gc-close:focus-visible {
  outline: 2px solid var(--gl-color-focus-ring, #2684FF);
  outline-offset: 1px;
}
.gc-links {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--gl-color-border-soft, rgba(15,23,42,0.08));
  font-size: 0.875rem;
  color: var(--gl-color-text-muted, #6b7280);
}
/* display: flex would override the hidden attribute: without a link, no empty rule. */
.gc-links[hidden] {
  display: none;
}
.gc-links a {
  color: var(--gl-color-accent-text, var(--gl-color-accent, #3b82f6));
  text-decoration: none;
}
.gc-links a:hover { text-decoration: underline; }
.gc-links a:focus-visible {
  outline: 2px solid var(--gl-color-focus-ring, #2684FF);
  outline-offset: 2px;
  border-radius: 2px;
}

/* Mounted in an element of the host: the card fills it, without its own frame. */
.gc-modal.gc-mounted {
  max-width: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
  padding: 1.25rem;
  font-family: var(--gl-font-family, system-ui, -apple-system, sans-serif);
}
.gc-notice {
  margin: 0 0 1rem;
  padding: 0.5rem 0.75rem;
  border-left: 3px solid var(--gl-color-accent, #3b82f6);
  background: var(--gl-color-bg-surface-muted, #f9fafb);
  color: var(--gl-color-text-main, #0f172a);
  font-size: 0.875rem;
}
`;
