#!/usr/bin/env node
/**
 * Per-capability golden-master harness (S0 / 0.6).
 *
 * Snapshots the observable footprint of a capability BEFORE its extraction and
 * AFTER, then prints the delta — the evidence that an extraction actually shrank
 * the kernel and left no residue. One snapshot file per capability lives in
 * `scripts/.baselines/golden-master/<id>.json` and is committed at the sprint
 * that extracts the capability.
 *
 * Metrics (all cheap + deterministic — no test run, no network):
 *   - bootGz        : real eager-boot payload (minified CDN closure, `npm run size`).
 *   - leanFullGz    : eager static closure of the granular (preserveModules) build.
 *   - ownedFiles /
 *     ownedLoc      : core/src files whose path matches the capability (its modules).
 *   - refLines      : lines in OTHER core/src files mentioning the capability
 *                     (cross-cutting coupling — should fall to ~the config-key refs).
 *   - coreTestFiles : *.test.js under packages/core/__tests__ (test-surface proxy).
 *
 * Usage:
 *   node scripts/golden-master.cjs --capability taxonomy --phase before
 *   ... extract the plugin ...
 *   node scripts/golden-master.cjs --capability taxonomy --phase after
 *   --match <substr>   override the path/token match (defaults to the id)
 *
 * Build artifacts must exist (run `npm run build` first) for the size metrics;
 * if absent they are recorded as null and flagged, never throwing.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { measureEagerBoot, measureStaticClosure } = require("./check-bundle-size.cjs");

const ROOT = path.resolve(__dirname, "..");
// Through the registry, which throws if the core cannot be found.
const CORE_DIR = require("./lib/packages.cjs").requireByDirName("core").absDir;
const CORE_SRC = path.join(CORE_DIR, "src");
const CORE_TESTS = path.join(CORE_DIR, "__tests__");
const DIST = path.join(CORE_DIR, "dist");
const SNAP_DIR = path.join(__dirname, ".baselines", "golden-master");

function arg(name, fallback) {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    if (hit) return hit.split("=")[1];
    const i = process.argv.indexOf(`--${name}`);
    if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--"))
        return process.argv[i + 1];
    return fallback;
}

/** Recursively collect source/test files under `dir`. */
function walk(dir, test = (n) => /\.(ts|js)$/.test(n) && !n.endsWith(".d.ts")) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === "node_modules") continue;
            out.push(...walk(full, test));
        } else if (test(e.name)) {
            out.push(full);
        }
    }
    return out;
}

/** Footprint of `match` across packages/core/src. */
function footprint(match) {
    const rx = new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const srcFiles = walk(CORE_SRC).filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`));
    let ownedFiles = 0;
    let ownedLoc = 0;
    let refLines = 0;
    for (const f of srcFiles) {
        const rel = path.relative(CORE_SRC, f);
        const code = fs.readFileSync(f, "utf8");
        const lines = code.split(/\r?\n/);
        if (rx.test(rel)) {
            ownedFiles += 1;
            ownedLoc += lines.length;
        } else {
            refLines += lines.filter((l) => rx.test(l)).length;
        }
    }
    return { ownedFiles, ownedLoc, refLines };
}

function sizes() {
    const boot = measureEagerBoot();
    const full = measureStaticClosure(
        path.join(DIST, "esm", "bundle-esm-entry.js"),
        path.join(DIST, "esm")
    );
    return {
        bootGz: boot ? round(boot.gz) : null,
        leanFullGz: full ? round(full.gz) : null,
    };
}

const round = (n) => Math.round(n * 10) / 10;

function snapshot(id, match) {
    const fp = footprint(match);
    const coreTestFiles = walk(
        CORE_TESTS,
        (n) => n.endsWith(".test.js") || n.endsWith(".test.ts")
    ).length;
    return { capability: id, match, ...sizes(), ...fp, coreTestFiles };
}

function fmtDelta(label, before, after, unit, lowerIsBetter = true) {
    if (before == null || after == null) return `  ${label.padEnd(14)} : (build missing — n/a)`;
    const d = round(after - before);
    const arrow = d === 0 ? "=" : d < 0 ? "▼" : "▲";
    const good = lowerIsBetter ? d <= 0 : d >= 0;
    return `  ${label.padEnd(14)} : ${before}${unit} → ${after}${unit}  (${arrow}${Math.abs(d)}${unit}) ${good ? "" : "⚠"}`;
}

function main() {
    const id = arg("capability");
    const phase = arg("phase");
    const match = arg("match", id);
    if (!id || !["before", "after"].includes(phase)) {
        console.error(
            "usage: node scripts/golden-master.cjs --capability <id> --phase before|after [--match <substr>]"
        );
        process.exit(2);
    }
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    const snapPath = path.join(SNAP_DIR, `${id}.json`);
    const existing = fs.existsSync(snapPath) ? JSON.parse(fs.readFileSync(snapPath, "utf8")) : {};

    const snap = snapshot(id, match);
    existing[phase] = snap;
    fs.writeFileSync(snapPath, `${JSON.stringify(existing, null, 4)}\n`);

    console.log(`\n── golden-master [${id}] · phase=${phase} · match=/${match}/i ──\n`);
    console.log(`  bootGz=${snap.bootGz} · leanFull=${snap.leanFullGz}`);
    console.log(
        `  ownedFiles=${snap.ownedFiles} · ownedLoc=${snap.ownedLoc} · refLines=${snap.refLines} · coreTestFiles=${snap.coreTestFiles}`
    );

    if (phase === "after" && existing.before) {
        const b = existing.before;
        console.log("\n  ── delta before → after ──");
        console.log(fmtDelta("bootGz", b.bootGz, snap.bootGz, " KB gz"));
        console.log(fmtDelta("leanFull", b.leanFullGz, snap.leanFullGz, " KB gz"));
        console.log(fmtDelta("ownedFiles", b.ownedFiles, snap.ownedFiles, ""));
        console.log(fmtDelta("ownedLoc", b.ownedLoc, snap.ownedLoc, " LOC"));
        console.log(fmtDelta("refLines", b.refLines, snap.refLines, ""));
        if (snap.ownedFiles > 0)
            console.log(
                `  ⚠ ${snap.ownedFiles} core file(s) still own "${match}" — extraction incomplete (cf. test-garde).`
            );
    } else if (phase === "after") {
        console.log(
            "\n  ⚠ no `before` snapshot recorded — run `--phase before` prior to extraction next time."
        );
    }
    console.log(`\n  snapshot → ${path.relative(ROOT, snapPath)}\n`);
}

main();
