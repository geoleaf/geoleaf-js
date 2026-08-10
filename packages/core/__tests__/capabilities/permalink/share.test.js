/**
 * @vitest-environment happy-dom
 *
 * Share module — Sprint 2 (A.7).
 * Covers: buildShareUrl, openShareModal, copy flow, lazy QR loading.
 *
 * Uses happy-dom instead of jsdom because tsx@4.21.0 + webidl-conversions@8
 * + Node 18 trigger a require() failure in jsdom's URL module — same
 * workaround as @geoleaf-plugins/print.
 */
import { vi } from "vitest";

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock the dynamic QR import — must return a factory matching the real
// qrcode-generator API surface used by share-qr.ts.
const mockMake = vi.hoisted(() => vi.fn());
const mockAddData = vi.hoisted(() => vi.fn());
const mockCreateSvgTag = vi.hoisted(() => vi.fn(() => "<svg><rect/></svg>"));
vi.mock("qrcode-generator", () => ({
    default: vi.fn(() => ({
        addData: mockAddData,
        make: mockMake,
        createSvgTag: mockCreateSvgTag,
    })),
}));

import { buildShareUrl } from "../../../src/capabilities/permalink/share/share-link.ts";
import {
    openShareModal,
    closeShareModal,
    isShareModalOpen,
} from "../../../src/capabilities/permalink/share/share-modal.ts";
import {
    generateQrSvg,
    _resetQrLoaderForTests,
} from "../../../src/capabilities/permalink/share/share-qr.ts";
import { Share } from "../../../src/capabilities/permalink/share/public-api.ts";

// ─── buildShareUrl ──────────────────────────────────────────────────────────
describe("buildShareUrl", () => {
    test("returns window.location.href when available", () => {
        // happy-dom default href
        expect(typeof buildShareUrl()).toBe("string");
        expect(buildShareUrl()).toBe(window.location.href);
    });
});

// ─── share-modal ────────────────────────────────────────────────────────────
describe("share-modal", () => {
    afterEach(() => {
        closeShareModal();
    });

    test("openShareModal injects a dialog into the DOM", () => {
        openShareModal();
        expect(isShareModalOpen()).toBe(true);
        const overlay = document.getElementById("gl-share-modal");
        expect(overlay).toBeTruthy();
        expect(overlay.getAttribute("role")).toBe("dialog");
        expect(overlay.getAttribute("aria-modal")).toBe("true");
    });

    test("URL input value matches buildShareUrl()", () => {
        openShareModal();
        const input = document.querySelector(".gl-share-modal__link");
        expect(input).toBeTruthy();
        expect(input.value).toBe(buildShareUrl());
        expect(input.readOnly).toBe(true);
    });

    test("calling openShareModal twice is idempotent", () => {
        openShareModal();
        openShareModal();
        const overlays = document.querySelectorAll("#gl-share-modal");
        expect(overlays.length).toBe(1);
    });

    test("ESC key closes the modal", () => {
        openShareModal();
        const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
        document.dispatchEvent(e);
        expect(isShareModalOpen()).toBe(false);
    });

    test("clicking the close button closes the modal", () => {
        openShareModal();
        const close = document.querySelector(".gl-share-modal__close");
        close.click();
        expect(isShareModalOpen()).toBe(false);
    });

    test("copy button calls navigator.clipboard.writeText", async () => {
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText },
            configurable: true,
        });
        openShareModal();
        const copyBtn = document.querySelector(".gl-share-modal__copy");
        copyBtn.click();
        await Promise.resolve();
        await Promise.resolve();
        expect(writeText).toHaveBeenCalledWith(buildShareUrl());
    });
});

// ─── share-qr ───────────────────────────────────────────────────────────────
describe("share-qr (lazy)", () => {
    beforeEach(() => {
        _resetQrLoaderForTests();
        mockAddData.mockClear();
        mockMake.mockClear();
        mockCreateSvgTag.mockClear();
    });

    test("does NOT load qrcode-generator at import time", () => {
        // Initial import should not trigger the lazy chunk. The mock factory is
        // only called when generateQrSvg() runs.
        expect(mockAddData).not.toHaveBeenCalled();
        expect(mockMake).not.toHaveBeenCalled();
    });

    test("generateQrSvg loads qrcode-generator on first call and returns SVG", async () => {
        const url = "https://example.com/?gl_lat=48&gl_lng=2&gl_zoom=10";
        const svg = await generateQrSvg(url);
        expect(svg).toContain("<svg");
        expect(mockAddData).toHaveBeenCalledWith(url);
        expect(mockMake).toHaveBeenCalled();
        expect(mockCreateSvgTag).toHaveBeenCalled();
    });

    test("subsequent calls reuse the cached factory (no second import)", async () => {
        await generateQrSvg("a");
        await generateQrSvg("b");
        // addData was called once per URL, but the factory itself is memoised.
        expect(mockAddData).toHaveBeenCalledTimes(2);
    });
});

// ─── Share facade ───────────────────────────────────────────────────────────
describe("Share facade", () => {
    afterEach(() => Share.closeShareDialog());

    test("exposes openShareDialog / closeShareDialog / getShareUrl / isOpen", () => {
        expect(typeof Share.openShareDialog).toBe("function");
        expect(typeof Share.closeShareDialog).toBe("function");
        expect(typeof Share.getShareUrl).toBe("function");
        expect(typeof Share.isOpen).toBe("function");
    });

    test("Share.getShareUrl returns the same value as buildShareUrl", () => {
        expect(Share.getShareUrl()).toBe(buildShareUrl());
    });

    test("Share.openShareDialog opens the modal", () => {
        Share.openShareDialog();
        expect(Share.isOpen()).toBe(true);
    });
});
