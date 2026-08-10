/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Lazy Chunk — Minimal OOXML (.xlsx) writer.
 *
 * Write-only, dependency-free replacement for SheetJS (`xlsx`). Removing that
 * dependency closes M4 (CVE-2023-30533 prototype pollution + ReDoS) at the
 * source: there is no longer any third-party spreadsheet parser shipped.
 *
 * The writer emits a valid SpreadsheetML workbook with a single worksheet,
 * using inline strings (no shared-string table) packaged as a STORED
 * (uncompressed, method 0) ZIP. Spreadsheet applications — Excel, LibreOffice
 * Calc, Google Sheets — open stored ZIP packages without warning.
 *
 * Scope is intentionally minimal: one sheet, string/number cells, no styling.
 * It is not a general-purpose xlsx library and must not grow into one.
 */

const encoder = new TextEncoder();

// ── XML helpers ─────────────────────────────────────────────────

/**
 * Escapes markup-significant characters and drops code points that are illegal
 * in XML 1.0 (C0 control chars except tab/newline/carriage-return), so a stray
 * control byte in a POI property never corrupts the produced document. A char
 * loop is used rather than a control-char regex to keep the source ASCII-safe.
 */
function escapeXml(value: string): string {
    let out = "";
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
        const ch = value[i];
        if (ch === "&") out += "&amp;";
        else if (ch === "<") out += "&lt;";
        else if (ch === ">") out += "&gt;";
        else if (ch === '"') out += "&quot;";
        else out += ch;
    }
    return out;
}

/** Converts a 0-based column index to its spreadsheet letter (0→A, 26→AA). */
function columnLetter(index: number): string {
    let n = index;
    let s = "";
    do {
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
}

interface Cell {
    value: string;
    numeric: boolean;
}

/** Maps an arbitrary cell value to a numeric or inline-string cell. */
function toCell(v: unknown): Cell {
    if (typeof v === "number" && Number.isFinite(v)) return { value: String(v), numeric: true };
    if (v == null) return { value: "", numeric: false };
    return { value: String(v), numeric: false };
}

/** Builds the XML for a single `<row>` of cells at the given 1-based row index. */
function rowXml(rowNum: number, cells: Cell[]): string {
    let out = `<row r="${rowNum}">`;
    for (const [c, cell] of cells.entries()) {
        const ref = columnLetter(c) + rowNum;
        if (cell.numeric) {
            out += `<c r="${ref}"><v>${cell.value}</v></c>`;
        } else if (cell.value === "") {
            out += `<c r="${ref}"/>`;
        } else {
            out += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
        }
    }
    return out + "</row>";
}

/** Builds `xl/worksheets/sheet1.xml`: a header row followed by one row per record. */
function buildSheetXml(headers: string[], rows: Record<string, unknown>[]): string {
    let xml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
    xml += rowXml(
        1,
        headers.map((h) => ({ value: h, numeric: false }))
    );
    for (const [r, row] of rows.entries()) {
        xml += rowXml(
            r + 2,
            headers.map((h) => toCell(row[h]))
        );
    }
    return xml + "</sheetData></worksheet>";
}

/** Sanitizes a worksheet name to Excel's rules (no `: \ / ? * [ ]`, ≤31 chars). */
function sanitizeSheetName(name: string): string {
    const cleaned = name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);
    return cleaned || "Sheet1";
}

function buildWorkbookXml(sheetName: string): string {
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${escapeXml(sanitizeSheetName(sheetName))}" sheetId="1" r:id="rId1"/></sheets>` +
        "</workbook>"
    );
}

// ── Static package parts ────────────────────────────────────────

const CONTENT_TYPES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    "</Types>";

const ROOT_RELS_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

const WORKBOOK_RELS_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    "</Relationships>";

// ── CRC32 + STORED ZIP ──────────────────────────────────────────

const CRC_TABLE: Uint32Array = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
        out.set(c, pos);
        pos += c.length;
    }
    return out;
}

interface ZipEntry {
    name: string;
    data: Uint8Array;
}

/**
 * Packages entries into a STORED (uncompressed) ZIP. No deflate is used, so the
 * writer carries no compression dependency; xlsx readers accept stored members.
 */
function zipStored(files: ZipEntry[]): Uint8Array {
    const localChunks: Uint8Array[] = [];
    const centralChunks: Uint8Array[] = [];
    let offset = 0;
    const DOS_TIME = 0;
    const DOS_DATE = 0x0021; // 1980-01-01, the ZIP epoch

    for (const file of files) {
        const nameBytes = encoder.encode(file.name);
        const crc = crc32(file.data);
        const size = file.data.length;

        const local = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true); // local file header signature
        lv.setUint16(4, 20, true); // version needed
        lv.setUint16(6, 0, true); // flags
        lv.setUint16(8, 0, true); // method = stored
        lv.setUint16(10, DOS_TIME, true);
        lv.setUint16(12, DOS_DATE, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, size, true); // compressed size
        lv.setUint32(22, size, true); // uncompressed size
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true); // extra length
        local.set(nameBytes, 30);
        localChunks.push(local, file.data);

        const central = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(central.buffer);
        cv.setUint32(0, 0x02014b50, true); // central directory signature
        cv.setUint16(4, 20, true); // version made by
        cv.setUint16(6, 20, true); // version needed
        cv.setUint16(8, 0, true); // flags
        cv.setUint16(10, 0, true); // method
        cv.setUint16(12, DOS_TIME, true);
        cv.setUint16(14, DOS_DATE, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, size, true);
        cv.setUint32(24, size, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true); // extra length
        cv.setUint16(32, 0, true); // comment length
        cv.setUint16(34, 0, true); // disk number start
        cv.setUint16(36, 0, true); // internal attributes
        cv.setUint32(38, 0, true); // external attributes
        cv.setUint32(42, offset, true); // local header offset
        central.set(nameBytes, 46);
        centralChunks.push(central);

        offset += local.length + file.data.length;
    }

    const centralSize = centralChunks.reduce((n, c) => n + c.length, 0);
    const centralOffset = offset;

    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); // end of central directory signature
    ev.setUint16(4, 0, true); // disk number
    ev.setUint16(6, 0, true); // disk with central directory
    ev.setUint16(8, files.length, true); // entries on this disk
    ev.setUint16(10, files.length, true); // total entries
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralOffset, true);
    ev.setUint16(20, 0, true); // comment length

    return concatBytes([...localChunks, ...centralChunks, end]);
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Builds a single-sheet `.xlsx` workbook buffer from a header list and rows.
 *
 * @param headers - Ordered column keys; also used as the header row labels.
 * @param rows - One record per data row; values are read by header key.
 * @param sheetName - Worksheet name (sanitized to Excel's constraints).
 * @returns The raw bytes of a valid `.xlsx` (Open XML, stored ZIP).
 */
export function buildXlsx(
    headers: string[],
    rows: Record<string, unknown>[],
    sheetName = "Sheet1"
): Uint8Array {
    const parts: ZipEntry[] = [
        { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES_XML) },
        { name: "_rels/.rels", data: encoder.encode(ROOT_RELS_XML) },
        { name: "xl/workbook.xml", data: encoder.encode(buildWorkbookXml(sheetName)) },
        { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(WORKBOOK_RELS_XML) },
        { name: "xl/worksheets/sheet1.xml", data: encoder.encode(buildSheetXml(headers, rows)) },
    ];
    return zipStored(parts);
}
