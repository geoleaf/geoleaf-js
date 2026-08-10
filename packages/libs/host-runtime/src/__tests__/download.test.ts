/*!
 * @geoleaf/host-runtime — download tests
 * © 2026 Mattieu Pottier — MIT License
 *
 * @vitest-environment happy-dom
 *
 * `downloadBlob` drives real anchors and the Web Share API, so this suite opts into a
 * DOM (the package default is `node`). Moved verbatim from `plugin-print`'s
 * `download-server.test.ts` at STRUCT S2 (F5), where the module used to live; the
 * server-fallback half of that file stays with the plugin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadBlob } from "../download.js";

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

describe("downloadBlob", () => {
    let origCreateObjectURL: typeof URL.createObjectURL;
    let origRevokeObjectURL: typeof URL.revokeObjectURL;
    let clickSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        origCreateObjectURL = URL.createObjectURL;
        origRevokeObjectURL = URL.revokeObjectURL;
        URL.createObjectURL = vi.fn(() => "blob:fake-url");
        URL.revokeObjectURL = vi.fn();
        clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    });

    afterEach(() => {
        URL.createObjectURL = origCreateObjectURL;
        URL.revokeObjectURL = origRevokeObjectURL;
        clickSpy.mockRestore();
        vi.unstubAllGlobals();
        // Clean up any appended anchors
        document.querySelectorAll("a[download]").forEach((a) => a.remove());
    });

    it("creates an <a download> element and clicks it", async () => {
        const blob = new Blob(["data"], { type: "image/jpeg" });
        await downloadBlob(blob, "carte.jpg");

        expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
        expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it("sets href and download attribute on the anchor", async () => {
        const blob = new Blob(["data"], { type: "image/jpeg" });

        let capturedAnchor: HTMLAnchorElement | null = null;
        const origAppend = document.body.appendChild.bind(document.body);
        vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
            if (node instanceof HTMLAnchorElement) capturedAnchor = node;
            return origAppend(node);
        });

        await downloadBlob(blob, "ma-carte.pdf");

        expect(capturedAnchor).not.toBeNull();
        expect(capturedAnchor!.href).toContain("fake-url");
        expect(capturedAnchor!.download).toBe("ma-carte.pdf");

        vi.mocked(document.body.appendChild).mockRestore();
    });

    it("uses navigator.share on iOS when available and canShare returns true", async () => {
        const shareMock = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", {
            userAgent:
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
            share: shareMock,
            canShare: vi.fn(() => true),
        });

        const blob = new Blob(["data"], { type: "application/pdf" });
        await downloadBlob(blob, "doc.pdf");

        expect(shareMock).toHaveBeenCalledTimes(1);
        expect(shareMock).toHaveBeenCalledWith(
            expect.objectContaining({
                files: expect.any(Array),
                title: "doc.pdf",
            })
        );
        // Should NOT fall through to <a download>
        expect(clickSpy).not.toHaveBeenCalled();
    });

    it("uses <a download> directly on desktop even when navigator.share is available", async () => {
        const shareMock = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", {
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0",
            share: shareMock,
            canShare: vi.fn(() => true),
        });

        const blob = new Blob(["data"], { type: "application/pdf" });
        await downloadBlob(blob, "doc.pdf");

        // navigator.share must NOT be called on desktop
        expect(shareMock).not.toHaveBeenCalled();
        expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    });

    it("falls back to <a download> when navigator.share throws AbortError (iOS)", async () => {
        const shareMock = vi
            .fn()
            .mockRejectedValue(Object.assign(new Error("User cancelled"), { name: "AbortError" }));
        vi.stubGlobal("navigator", {
            userAgent:
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
            share: shareMock,
            canShare: vi.fn(() => true),
        });

        const blob = new Blob(["data"], { type: "application/pdf" });
        await downloadBlob(blob, "doc.pdf");

        // AbortError = user cancelled — should still fall through to <a download>
        expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    });
});

// ---------------------------------------------------------------------------
// download — non-AbortError branch
// ---------------------------------------------------------------------------

describe("downloadBlob — non-AbortError share failure", () => {
    let origCreateObjectURL: typeof URL.createObjectURL;
    let origRevokeObjectURL: typeof URL.revokeObjectURL;

    beforeEach(() => {
        origCreateObjectURL = URL.createObjectURL;
        origRevokeObjectURL = URL.revokeObjectURL;
        URL.createObjectURL = vi.fn(() => "blob:fake-url");
        URL.revokeObjectURL = vi.fn();
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    });

    afterEach(() => {
        URL.createObjectURL = origCreateObjectURL;
        URL.revokeObjectURL = origRevokeObjectURL;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.querySelectorAll("a[download]").forEach((a) => a.remove());
    });

    it("warns and falls back to <a download> when navigator.share throws non-AbortError (iOS)", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const shareError = new TypeError("Share not supported");
        vi.stubGlobal("navigator", {
            userAgent:
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
            share: vi.fn().mockRejectedValue(shareError),
            canShare: vi.fn(() => true),
        });

        const blob = new Blob(["data"], { type: "application/pdf" });
        await downloadBlob(blob, "doc.pdf");

        expect(warnSpy).toHaveBeenCalled();
        expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    });
});
