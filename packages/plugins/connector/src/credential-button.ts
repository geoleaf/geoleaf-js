/*!
 * GeoLeaf Connector — Credential Button
 * Auto-injects a credential/login icon button into the desktop panel
 * (.gl-rp-tabs) and mobile toolbar (.gl-map-toolbar).
 * Uses MutationObserver to handle deferred DOM creation by the core.
 * SVG built via createElementNS — no innerHTML.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import type { ConnectorConfig } from "./config.js";
import { TokenStore } from "./token-store.js";
import { showLoginModal } from "./login-ui.js";
import { adoptStylesheet } from "@geoleaf/host-runtime";

// ─── CSS ──────────────────────────────────────────────────────────────────────

const _BTN_CSS = `
.gc-credential-separator {
  height: 1px;
  background: var(--gl-color-border-soft, rgba(15,23,42,0.08));
  margin: 8px 4px 8px;
  width: calc(100% - 8px);
  flex-shrink: 0;
}
.gc-credential-btn[data-variant="desktop"] {
  margin-bottom: 8px;
  flex-shrink: 0;
}
/* Hide the mobile-variant button on desktop (≥ 1440px) — core breakpoint
   where .gl-rp-tabs becomes the primary surface and the mobile pill still
   exists but several of its buttons are already hidden by the core. */
@media (min-width: 1440px) {
  .gc-credential-btn[data-variant="mobile"] {
    display: none !important;
  }
}
.gc-credential-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  margin: 4px auto;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--gl-color-text-muted, #6b7280);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.gc-credential-btn:hover {
  background: color-mix(in srgb, var(--gl-color-accent, #f97316) 15%, transparent);
  color: var(--gl-color-accent, #f97316);
}
.gc-credential-btn:focus-visible {
  outline: 2px solid var(--gl-color-focus-ring, #2684FF);
  outline-offset: 2px;
}
`;

// ─── Module state ─────────────────────────────────────────────────────────────

let _observer: MutationObserver | null = null;
let _desktopBtn: HTMLButtonElement | null = null;
let _mobileBtn: HTMLButtonElement | null = null;
let _styleInjected = false;

// ─── Activation check ─────────────────────────────────────────────────────────

function _shouldEnable(config: ConnectorConfig): boolean {
    // Source 1: explicit config
    if (config.auth?.credentialButton?.enabled === true) return true;
    // Source 2: profile ui.json — read via GeoLeaf.Config.getActiveProfile().
    // The core merges ui.json into the active profile (spread at root), so
    // showCredentialButton sits at profile.ui.showCredentialButton.
    const g = globalThis as Record<string, unknown>;
    const gl = g["GeoLeaf"] as Record<string, unknown> | undefined;
    const Config = gl?.["Config"] as
        { getActiveProfile?: () => Record<string, unknown> | null } | undefined;
    const profile = Config?.getActiveProfile?.();
    const ui = (profile?.["ui"] ?? undefined) as Record<string, unknown> | undefined;
    if (ui?.["showCredentialButton"] === true) return true;
    return false;
}

// ─── CSS injection ────────────────────────────────────────────────────────────

function _injectStyles(): void {
    if (_styleInjected) return;
    // CSP-safe: constructable stylesheet, not a <style> element (roadmap B.7).
    adoptStylesheet(_BTN_CSS, "gc-btn-style");
    _styleInjected = true;
}

// ─── SVG icon builder ─────────────────────────────────────────────────────────

function _buildSvgIcon(variant: "lock" | "user"): SVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");

    if (variant === "user") {
        // User silhouette — two paths: head circle + body arc
        const circle = document.createElementNS(ns, "circle");
        circle.setAttribute("cx", "12");
        circle.setAttribute("cy", "8");
        circle.setAttribute("r", "4");
        svg.appendChild(circle);

        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2");
        svg.appendChild(path);
    } else {
        // Lock — rect body + path for shackle
        const rect = document.createElementNS(ns, "rect");
        rect.setAttribute("x", "5");
        rect.setAttribute("y", "11");
        rect.setAttribute("width", "14");
        rect.setAttribute("height", "10");
        rect.setAttribute("rx", "2");
        svg.appendChild(rect);

        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", "M8 11V7a4 4 0 0 1 8 0v4");
        svg.appendChild(path);
    }

    return svg;
}

// ─── Button builder ───────────────────────────────────────────────────────────

function _buildButton(config: ConnectorConfig, variant: "desktop" | "mobile"): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gc-credential-btn";
    btn.dataset.variant = variant;

    const iconVariant = config.auth?.credentialButton?.iconVariant ?? "lock";
    const svg = _buildSvgIcon(iconVariant === "user" ? "user" : "lock");
    btn.appendChild(svg);

    btn.addEventListener("click", () => {
        void _onCredentialClick(config);
    });

    return btn;
}

// ─── Click handler ────────────────────────────────────────────────────────────

async function _onCredentialClick(config: ConnectorConfig): Promise<void> {
    // Only hit the token store when an auth endpoint is wired — otherwise
    // there is no backend to authenticate against and we go straight to the
    // modal. The ui.showCredentialButton flag is the sole display safeguard.
    const hasEndpoint = !!config.auth?.endpoint?.trim();
    const token = hasEndpoint ? await TokenStore.getTokenAsync(config.baseUrl) : null;
    const authenticated = !!token;

    document.dispatchEvent(
        new CustomEvent("geoleaf:connector:credential-button-clicked", {
            detail: { baseUrl: config.baseUrl, authenticated },
        })
    );

    if (authenticated) return;

    try {
        await showLoginModal(config);
    } catch {
        // User closed modal without authenticating — no-op
    }
}

// ─── Desktop injection ────────────────────────────────────────────────────────

function _injectDesktop(config: ConnectorConfig): void {
    const tabs = document.querySelector<HTMLElement>(".gl-rp-tabs");
    if (!tabs) return;
    // Idempotence guard
    if (tabs.querySelector(".gc-credential-btn")) return;

    const separator = document.createElement("div");
    separator.className = "gc-credential-separator";

    const btn = _buildButton(config, "desktop");
    btn.setAttribute("aria-label", "Connexion");
    btn.title = "Connexion";

    tabs.appendChild(separator);
    tabs.appendChild(btn);
    _desktopBtn = btn;
}

// ─── Mobile injection ─────────────────────────────────────────────────────────

function _injectMobile(config: ConnectorConfig): void {
    // Prefer the scroll container; fallback to the toolbar itself
    const scroll =
        document.querySelector<HTMLElement>(".gl-map-toolbar__scroll") ??
        document.querySelector<HTMLElement>(".gl-map-toolbar");
    if (!scroll) return;
    // Idempotence guard
    if (scroll.querySelector(".gc-credential-btn")) return;

    const btn = _buildButton(config, "mobile");
    btn.classList.add("gl-map-toolbar__btn");
    btn.setAttribute("aria-label", "Connexion");

    scroll.appendChild(btn);
    _mobileBtn = btn;
}

// ─── Injection orchestrator ───────────────────────────────────────────────────

function _tryInjectAll(config: ConnectorConfig): void {
    if (!_desktopBtn) _injectDesktop(config);
    if (!_mobileBtn) _injectMobile(config);
    if (_desktopBtn && _mobileBtn) {
        _observer?.disconnect();
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Auto-injects the credential button into the desktop panel tabs and mobile
 * toolbar. No-op if activation conditions are not met.
 * Uses MutationObserver to handle deferred DOM creation.
 */
export function installCredentialButton(config: ConnectorConfig): void {
    if (!_shouldEnable(config)) return;

    _injectStyles();

    // Immediate attempt (DOM may already be ready)
    _tryInjectAll(config);

    // Fallback: observe for late DOM creation
    if (!_desktopBtn || !_mobileBtn) {
        _observer = new MutationObserver(() => _tryInjectAll(config));
        _observer.observe(document.body, { childList: true, subtree: true });
        // Safety timeout — disconnect after 10s to prevent memory leak
        setTimeout(() => _observer?.disconnect(), 10_000);
    }
}

/**
 * Removes injected credential buttons and disconnects the MutationObserver.
 * Called by entry.ts destroy().
 */
export function uninstallCredentialButton(): void {
    _observer?.disconnect();
    _observer = null;
    _desktopBtn?.remove();
    _mobileBtn?.remove();
    _desktopBtn = null;
    _mobileBtn = null;
    _styleInjected = false;
}
