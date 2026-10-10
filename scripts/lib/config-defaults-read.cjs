/**
 * @fileoverview Reading a configuration DEFAULT out of a Markdown table.
 *
 * Shared by the gate that confronts the integrator guide to the configuration inventory
 * (`check-doc-config-defaults.cjs`) and by the guard that confronts the inventory to the
 * capabilities' own `configSchema` (`doc-capability-config.guard.test.js`): two instruments
 * that read the same column must read it with the same grammar, or a cell one of them takes
 * for a literal is prose to the other and the two verdicts stop meaning the same thing.
 *
 * The cell grammar itself is documented where it is enforced, in the header of
 * `check-doc-config-defaults.cjs`.
 */

"use strict";

const fs = require("node:fs");

const { createFenceTracker } = require("./md-fences.cjs");

// English too: the plugins' READMEs and the core's guides are written in English, and a
// header this pattern does not know makes a whole table invisible, not wrong.
const DEFAULT_HEADER = /^(?:d[ée]faut|default)$/i;
const BINDING = /<!--\s*geoleaf:docs:default\s+(\S+)\s+(\S+)\s+(\S+)\s*-->/;
const KEY_PREFIX = /<!--\s*geoleaf:docs:key-prefix\s+(\S+)\s*-->/;

/**
 * @typedef {{ kind: "none" } | { kind: "prose" } | { kind: "lit", value: unknown }} Stated
 * @typedef {{ key: string, file: string, constant: string, line: number, used: boolean }} Binding
 * @typedef {{ line: number, section: string, headers: string[], rows: { line: number, cells: string[] }[], bindings: Binding[], prefix: string }} Table
 */

/**
 * Splits a Markdown table row on UNescaped pipes.
 *
 * @param {string} line
 * @returns {string[]}
 */
function splitRow(line) {
    const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
    if (cells.length && cells[0] === "") cells.shift();
    if (cells.length && cells[cells.length - 1] === "") cells.pop();
    return cells.map((c) => c.replace(/\\\|/g, "|"));
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isSeparatorRow(line) {
    return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

/**
 * Reads every table of a Markdown document, outside code fences.
 *
 * @param {string} md
 * @param {(heading: string) => string} sectionOf turns a heading line into a section id
 * @returns {Table[]}
 * @throws {Error} when a `geoleaf:docs:default` binding is followed by no table
 */
function readTables(md, sectionOf) {
    const lines = md.split(/\r?\n/);
    const fences = createFenceTracker();
    /** @type {Table[]} */
    const tables = [];
    /** @type {Table | null} */
    let current = null;
    /** @type {Binding[]} */
    let pending = [];
    let prefix = "";
    let section = "";

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (fences.consume(line) || fences.inCode) {
            current = null;
            continue;
        }
        if (/^#{2,4}\s/.test(line)) section = sectionOf(line) ?? section;

        const marker = BINDING.exec(line);
        if (marker) {
            const [, key, file, constant] = marker;
            pending.push({ key, file, constant, line: i + 1, used: false });
            continue;
        }
        const mounted = KEY_PREFIX.exec(line);
        if (mounted) {
            prefix = mounted[1];
            continue;
        }

        if (!/^\s*\|/.test(line)) {
            current = null;
            continue;
        }
        if (current) {
            current.rows.push({ line: i + 1, cells: splitRow(line) });
            continue;
        }
        if (!isSeparatorRow(lines[i + 1] || "")) continue;
        current = {
            line: i + 1,
            section,
            headers: splitRow(line),
            rows: [],
            bindings: pending,
            prefix,
        };
        tables.push(current);
        pending = [];
        prefix = "";
        i++; // skip the separator row
    }
    if (pending.length > 0) {
        throw new Error(`liaison sans tableau à sa suite (ligne ${pending[0].line} du guide).`);
    }
    return tables;
}

/**
 * Parses a numeric token, digit separators removed.
 *
 * @param {string} raw
 * @returns {number | undefined}
 */
function parseNumber(raw) {
    const compact = raw.replace(/(?<=\d)[\s_](?=\d)/g, "").replace(",", ".");
    if (!/^-?\d[\d.]*$/.test(compact)) return undefined;
    // `1.3.0` passes the pattern and is a version string, not a number.
    const value = Number(compact);
    return Number.isFinite(value) ? value : undefined;
}

/**
 * Reads the content of a backticked token as a literal.
 *
 * @param {string} inner
 * @returns {Stated}
 */
function parseLiteral(inner) {
    const text = inner.replace(/[\s,_]+$/, "").trim();
    const num = parseNumber(text.replace(/\.$/, ""));
    if (num !== undefined) return { kind: "lit", value: num };
    try {
        return { kind: "lit", value: JSON.parse(text) };
    } catch {
        // A single unquoted token (`top-left`, `image/png`) is a string written without
        // its quotes; anything carrying a space is prose.
        return /^[^\s"{}[\]]+$/.test(text) ? { kind: "lit", value: text } : { kind: "prose" };
    }
}

/**
 * A bare token followed by a word is a quantity with its unit (`250 Mo`), not a literal.
 * Punctuation in between (`5, puis…`) ends the token instead.
 *
 * @param {string} token the bare match, trailing separators included
 * @param {string} after what follows it
 * @returns {boolean}
 */
function hasUnit(token, after) {
    return /[\dA-Za-z]\s*$/.test(token) && /^[\p{L}%°]/u.test(after);
}

/**
 * Reads what a cell states as a default — see "Cell grammar" in the header.
 *
 * @param {string} raw
 * @returns {Stated}
 */
function parseStated(raw) {
    const cell = raw
        .trim()
        .replace(/^\*\*(.*)\*\*$/, "$1")
        .replace(/^code\s+/i, "")
        .trim();
    if (cell === "" || /^[—–-](\s|$)/.test(cell)) return { kind: "none" };

    const ticked = /^`([^`]+)`/.exec(cell);
    if (ticked) return parseLiteral(ticked[1]);

    const quoted = /^"[^"]*"/.exec(cell);
    if (quoted) return parseLiteral(quoted[0]);

    const bare = /^(true|false|null|-?\d[\d\s_.,]*)/.exec(cell);
    if (!bare) return { kind: "prose" };
    if (hasUnit(bare[1], cell.slice(bare[1].length))) return { kind: "prose" };
    return parseLiteral(bare[1]);
}

/**
 * Canonical JSON, keys sorted, so two equal values always render the same string.
 *
 * @param {unknown} value
 * @returns {string}
 */
function canon(value) {
    if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
    if (value && typeof value === "object") {
        const obj = /** @type {Record<string, unknown>} */ (value);
        return `{${Object.keys(obj)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canon(obj[k])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

/**
 * @param {Stated} stated
 * @returns {string}
 */
function render(stated) {
    if (stated.kind === "lit") return canon(stated.value);
    return stated.kind === "none" ? "—" : "(prose)";
}

/**
 * Instance placeholders are equivalent — see "Cell grammar" in the header.
 *
 * @param {string} key
 * @returns {string}
 */
function canonicalKey(key) {
    return key
        .replace(/^…/, "")
        .replace(/\.\{[^}]+\}/g, "[]")
        .replace(/\.<[^>]+>/g, "[]");
}

/**
 * Indexes the inventory's `Défaut` column by canonical key. Rows under a struck-through
 * heading are migration archives, skipped as `check-config-coverage.cjs` skips them.
 *
 * @param {string} inventoryPath absolute path of the inventory document
 * @returns {Map<string, { stated: Stated, line: number }[]>}
 */
function readInventory(inventoryPath) {
    const md = fs.readFileSync(inventoryPath, "utf8");
    /** @type {Map<string, { stated: Stated, line: number }[]>} */
    const index = new Map();
    const tables = readTables(md, (heading) => (heading.includes("~~") ? "archive" : "live"));
    for (const table of tables) {
        const keyCol = table.headers.findIndex((h) => /^cl[ée]/i.test(h));
        const defCol = table.headers.findIndex((h) => DEFAULT_HEADER.test(h));
        if (keyCol < 0 || defCol < 0 || table.section === "archive") continue;
        for (const row of table.rows) {
            const key = /^`([^`]+)`$/.exec(row.cells[keyCol] || "");
            if (!key) continue;
            const id = canonicalKey(key[1]);
            const entry = { stated: parseStated(row.cells[defCol] || ""), line: row.line };
            const known = index.get(id);
            if (known) known.push(entry);
            else index.set(id, [entry]);
        }
    }
    return index;
}

module.exports = {
    DEFAULT_HEADER,
    readTables,
    hasUnit,
    parseStated,
    canon,
    render,
    canonicalKey,
    readInventory,
};
