/*!
 * GeoLeaf Core — Share / QR code (lazy)
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * Lazy QR code generator. The `qrcode-generator` library (~4 KB minified) is
 * loaded via `import("qrcode-generator")` **only** when {@link generateQrSvg}
 * is first called — never at boot, never on share dialog open. The default
 * code path (open dialog → copy link) downloads zero bytes of QR code.
 *
 * The dynamic import is memoised: subsequent calls reuse the resolved module.
 *
 * @see share-modal — calls `generateQrSvg` when the user clicks "Afficher le QR"
 */

type QrFactory = (
    typeNumber: number,
    errorCorrectionLevel: string
) => {
    addData(data: string): void;
    make(): void;
    createSvgTag(opts: { scalable?: boolean; margin?: number; cellSize?: number }): string;
};

let _qrcodeFactory: QrFactory | null = null;
let _loaderPromise: Promise<QrFactory> | null = null;

async function _loadQrcode(): Promise<QrFactory> {
    if (_qrcodeFactory) return _qrcodeFactory;
    if (!_loaderPromise) {
        _loaderPromise = import("qrcode-generator").then((mod) => {
            // qrcode-generator v2 ships dual ESM/CJS: the ESM build exposes the
            // factory as the default export. Fall back to the namespace itself
            // for bundlers that surface it directly (CJS interop edge cases).
            const factory =
                (mod as unknown as { default?: QrFactory }).default ??
                (mod as unknown as QrFactory);
            _qrcodeFactory = factory;
            return factory;
        });
    }
    return _loaderPromise;
}

/**
 * Generates an inline SVG string encoding the given URL.
 *
 * On first call, lazy-loads `qrcode-generator` (~4 KB chunk). The QR uses
 * type-number 0 (auto) and error-correction level "M" — a balanced choice
 * for URLs up to ~360 chars while staying scannable at small sizes.
 *
 * @param url - URL to encode. Caller is responsible for length checks.
 * @returns SVG markup, safe to inject via {@link DOMSecurity.setSafeHTML}.
 */
export async function generateQrSvg(url: string): Promise<string> {
    const factory = await _loadQrcode();
    const qr = factory(0, "M");
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({ scalable: true, margin: 1 });
}

/**
 * Reset internal state — test-only.
 * @internal
 */
export function _resetQrLoaderForTests(): void {
    _qrcodeFactory = null;
    _loaderPromise = null;
}
