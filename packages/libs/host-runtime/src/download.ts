/*!
 * @geoleaf/host-runtime — Multi-platform file download
 *
 * Strategy (in priority order):
 *  1. navigator.share({ files }) — iOS Safari only.
 *     On iOS, <a download> opens the file in the browser instead of saving it,
 *     so the native share sheet is the only reliable save path.
 *     Desktop browsers (Chrome/Edge on Windows/macOS) also support navigator.share
 *     but it opens a system share dialog — NOT what we want on desktop.
 *     Guard: only activate on iOS (iPhone/iPad/iPod UA string).
 *  2. <a download> — Desktop and Android Chrome (reliable on non-iOS platforms).
 *  3. window.open(blobUrl) — Fallback for browsers that block <a download>.
 *
 * Consolidated at STRUCT S2 (F5): `plugin-measure` carried a near-literal fork of this
 * strategy in `geojson-export.ts` (`_triggerDownload`), differing only by its log prefix.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/** Navigator subset for the Web Share API (`canShare` is absent from some lib.dom). */
type NavigatorShare = Navigator & { canShare?(data?: { files?: File[] }): boolean };

/** Returns true only on iOS Safari / iOS Chrome where <a download> does not save. */
function _isIOS(): boolean {
    return typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * Triggers a file download for the given Blob.
 *
 * On iOS, the native share sheet is used (navigator.share with files) because
 * <a download> does not save to Files on iOS — it opens the file in the browser.
 * On all other platforms (desktop, Android), <a download> is used directly.
 *
 * @param blob     - The Blob to download.
 * @param filename - Suggested file name including extension (e.g. `"carte.pdf"`).
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
    const file = new File([blob], filename, { type: blob.type });

    // 1 — Web Share API — iOS only (iPhone/iPad/iPod)
    if (
        _isIOS() &&
        typeof navigator.share === "function" &&
        typeof (navigator as NavigatorShare).canShare === "function" &&
        (navigator as NavigatorShare).canShare?.({ files: [file] })
    ) {
        try {
            await navigator.share({ files: [file], title: filename });
            return;
        } catch (err) {
            // AbortError = user cancelled share sheet — fall through to <a download>
            if (err instanceof Error && err.name !== "AbortError") {
                console.warn("[GeoLeaf] navigator.share failed, falling back:", err);
            }
        }
    }

    // 2 — <a download> (desktop / Android / iOS fallback)
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } finally {
        // Revoke after a delay to allow the browser to start the download.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
}
