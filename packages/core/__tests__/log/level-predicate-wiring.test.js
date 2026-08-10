/**
 * @fileoverview Which log level consults which message predicate (B.38).
 *
 * `logger.ts` carries two pattern lists that are BEHAVIOUR, not documentation:
 * `isRepetitiveMessage` (grouped/hidden in quiet mode) and `isCriticalMessage`
 * (force-shown in quiet mode). KERNEL S11 already had to delete two French patterns that a
 * translation pass had orphaned, so the file warns "grep before adding or editing an entry".
 *
 * What the warning does NOT say — and what made backlog B.38 mis-state its own trap — is
 * WHICH LEVEL consults them. The entry claimed that translating `"Erreur loading style"`
 * into `"Error loading style"` would flip that log to always-shown, because
 * `criticalPatterns` contains `/Error/`. It would not: the site is a `Log.warn`, and `warn`
 * consults nothing at all. `criticalPatterns` is reachable from `info` ONLY.
 *
 * That is the fact worth pinning. It is invisible from the pattern lists themselves — you
 * have to read all four level methods to see it — so the next person reasoning about a
 * translation will make the same mistake unless a test states it.
 *
 * Consequence, in plain terms: a message containing "Error"/"Failed"/"WARN" changes
 * behaviour only when it is passed to `Log.info`. On `warn` and `error` the wording is
 * free; on `debug` and `info` it is load-bearing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let Log;
let LogControl;

beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../../src/utils/log/logger.js");
    Log = mod.Log ?? mod.default;
    LogControl = mod;
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Turns on quiet mode if the module exposes a way to; skips the pin otherwise. */
function enableQuiet() {
    const setQuiet = Log?.setQuietMode ?? LogControl?.setQuietMode;
    if (typeof setQuiet === "function") {
        setQuiet.call(Log, true);
        return true;
    }
    return false;
}

describe("logger — `warn` and `error` consult NO message predicate (B.38)", () => {
    it("warn prints regardless of wording, in quiet mode too", () => {
        Log.setLevel?.("debug");
        enableQuiet();

        // Neither of these matches anything in criticalPatterns…
        Log.warn("[Legend] Chargement style: x");
        // …and this one matches /Error/ and /Failed/. Same outcome: both printed.
        Log.warn("[Legend] Failed to load style: boom");

        expect(console.warn).toHaveBeenCalledTimes(2);
    });

    it("error prints regardless of wording, in quiet mode too", () => {
        Log.setLevel?.("debug");
        enableQuiet();

        Log.error("quelque chose");
        Log.error("Error: something");

        expect(console.error).toHaveBeenCalledTimes(2);
    });

    it("translating a warn message therefore cannot change whether it is shown", () => {
        Log.setLevel?.("debug");
        enableQuiet();
        Log.warn("[Legend] Erreur loading style: boom");
        const before = console.warn.mock.calls.length;

        console.warn.mockClear();
        Log.warn("[Legend] Failed to load style: boom");

        expect(console.warn.mock.calls.length).toBe(before);
    });
});
