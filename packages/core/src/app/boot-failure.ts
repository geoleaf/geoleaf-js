/*!
 * GeoLeaf Core – App / Boot failure
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Boot failure surface — a boot that cannot complete is SIGNALLED, never a silent spinner.
 *
 * ## The defect it closes
 *
 * `#gl-loader` is hidden only by `revealApp()` (`init-reveal.ts`), and only `UIModule` arms
 * it — once a map exists. Every earlier failure (root configuration, `profile.json`, map
 * extent, WebGL2, a module throwing before the interface) ended in a log line and a `return`:
 * the spinner turned forever, no event reached the host, and a technician in the field had
 * nothing to report.
 *
 * ## What it does
 *
 * - `failBoot()` — the first TERMINAL failure wins. It dispatches `geoleaf:boot:failed`
 *   (cancelable), logs it, disarms the watchdog and, unless a host cancelled the event, turns
 *   the veil into the failure screen (`boot-failure-screen.ts`).
 * - `noteProfileFailures()` then `holdReveal()` — declared profile resources failed, but a map
 *   can show: the reveal is HELD, the screen names the resources, and « Continue » replays the
 *   reveal. The screen appears at the moment the app would have been revealed, so the map
 *   exists by then — which is what makes « Continue » honest.
 * - `noteModuleFailure()` — a module threw and the application goes on without it
 *   (`geoleaf:module:failed`, cancelable): the same held reveal, naming the module, or a warning
 *   once the application is revealed. Whether a module failure is survivable is decided by the
 *   boot (`boot-core.ts`) from the dependency graph — not here.
 * - A watchdog, armed by `beginBoot()` and PAUSED around `beforeBoot` (an authentication gate
 *   may wait on a human for minutes), reports a boot that stops progressing: a PROVISIONAL
 *   `timeout`, whose screen a late reveal removes.
 *
 * The diagnostic the screen copies or downloads carries the log's recent entries
 * (`utils/log/log-record.ts`), and every string in it is redacted (`utils/log/redact.ts`).
 *
 * ⚠️ Module-level state: one boot per page, and `GeoLeaf.boot()` refuses a second call. Every
 * `beginBoot()` starts from a clean slate.
 */

import type { GeoLeafEventMap } from "../contracts/event-bus.contract.js";
import type { BootOptions } from "./app-types.js";
import { dispatchCancelableGeoLeafEvent } from "../kernel/events/event-bus.js";
import { getActiveLang } from "../utils/i18n/i18n.js";
import { Log } from "../utils/log/index.js";
import { getLogEntries, type LogEntry } from "../utils/log/log-record.js";
import { redactSecrets } from "../utils/log/redact.js";
import { notifyPrimitive } from "../utils/notify/notify.primitive.js";
import type { ProfileResourceFailure } from "../kernel/config/profile-load-report.js";
import {
    bootFailureMessage,
    clearBootFailureScreen,
    moduleWarningMessage,
    renderBootFailureScreen,
    type BootFailureScreenActions,
    type BootFailureScreenModel,
} from "./boot-failure-screen.js";

type BootFailedDetail = GeoLeafEventMap["geoleaf:boot:failed"];
type ModuleFailedDetail = GeoLeafEventMap["geoleaf:module:failed"];
type BootPhase = BootFailedDetail["phase"];

/** Default watchdog — generous on purpose: a field network is slow long before it is down. */
const DEFAULT_WATCHDOG_MS = 45_000;

type BootState = "idle" | "booting" | "attention" | "stalled" | "failed" | "aborted" | "ready";

interface BootFailureState {
    state: BootState;
    phase: BootPhase;
    version: string | null;
    failure: BootFailedDetail | null;
    profileFailures: ProfileResourceFailure[];
    moduleFailures: ModuleFailedDetail[];
    /** The lines an attention screen names: the failures no host took over, modules first. */
    heldModules: string[];
    heldResources: string[];
    /** A failure no host took over waits for the reveal: hold it. */
    attentionPending: boolean;
    /** The reveal « Continue » replays. */
    heldReveal: (() => void) | null;
    watchdogMs: number;
    timer: ReturnType<typeof setTimeout> | null;
}

function _freshState(): BootFailureState {
    return {
        state: "idle",
        phase: "config",
        version: null,
        failure: null,
        profileFailures: [],
        moduleFailures: [],
        heldModules: [],
        heldResources: [],
        attentionPending: false,
        heldReveal: null,
        watchdogMs: DEFAULT_WATCHDOG_MS,
        timer: null,
    };
}

let _s: BootFailureState = _freshState();

function _clearTimer(): void {
    if (_s.timer === null) return;
    clearTimeout(_s.timer);
    _s.timer = null;
}

function _armWatchdog(): void {
    _clearTimer();
    if (_s.watchdogMs <= 0) return;
    const timer = setTimeout(_onWatchdog, _s.watchdogMs);
    // A boot nobody awaits must not keep a Node test runner alive. A browser returns a number,
    // which has no `unref`: it is read through `Reflect` instead of asserting a type on the handle.
    const unref: unknown =
        typeof timer === "object" && timer !== null ? Reflect.get(timer, "unref") : undefined;
    if (typeof unref === "function") unref.call(timer);
    _s.timer = timer;
}

function _onWatchdog(): void {
    _s.timer = null;
    if (_s.state !== "booting") return;
    _s.state = "stalled";
    _signal(
        {
            reason: "timeout",
            phase: _s.phase,
            message: `The boot made no progress for ${_s.watchdogMs} ms (phase "${_s.phase}").`,
            provisional: true,
        },
        true
    );
}

function _moduleLine(failure: ModuleFailedDetail): string {
    return `${failure.module} — ${failure.message}`;
}

function _resourceLine(failure: ProfileResourceFailure): string {
    return `${failure.resource} — ${failure.message}`;
}

/** What a terminal failure screen lists: every module and declared resource that failed. */
function _failureLines(): string[] {
    return [..._s.moduleFailures.map(_moduleLine), ..._s.profileFailures.map(_resourceLine)];
}

/** The attention screen: the failures no host took over, in the words of what failed. */
function _attentionModel(): BootFailureScreenModel {
    return {
        kind: "attention",
        reason: _s.heldModules.length > 0 ? "module" : "profile",
        resources: [..._s.heldModules, ..._s.heldResources],
    };
}

function _actions(): BootFailureScreenActions {
    return {
        reload: () => {
            if (typeof location !== "undefined") location.reload();
        },
        continueBoot: _continue,
        diagnostic: _diagnostic,
    };
}

/** Logs, dispatches `geoleaf:boot:failed`, and draws the screen unless a host cancelled. */
function _signal(partial: Omit<BootFailedDetail, "timestamp">, drawScreen: boolean): void {
    const detail: BootFailedDetail = { ...partial, timestamp: Date.now() };
    _s.failure = detail;
    if (detail.provisional) Log.warn("[GeoLeaf.boot] Boot stalled:", detail);
    else Log.error("[GeoLeaf.boot] Boot failed:", detail);
    const notCancelled = dispatchCancelableGeoLeafEvent("geoleaf:boot:failed", detail);
    if (!notCancelled || !drawScreen) return;
    // The module at fault, when there is one, leads the list: it is the failure itself.
    const culprit = detail.module === undefined ? [] : [`${detail.module} — ${detail.message}`];
    const model: BootFailureScreenModel = {
        kind: "failure",
        reason: detail.reason,
        resources: [...culprit, ..._failureLines()],
    };
    renderBootFailureScreen(model, _actions());
}

function _continue(): void {
    if (_s.state !== "attention") return;
    const reveal = _s.heldReveal;
    _s.heldReveal = null;
    _s.state = "ready";
    clearBootFailureScreen();
    reveal?.();
}

/**
 * Starts a boot: a clean slate, and the watchdog armed.
 *
 * @param options - The boot options; only `watchdogMs` is read (default 45 000, `0` disables it).
 * @param version - The library version, reported in the diagnostic.
 */
export function beginBoot(options: Pick<BootOptions, "watchdogMs"> = {}, version?: string): void {
    _clearTimer();
    _s = _freshState();
    _s.state = "booting";
    _s.version = version ?? null;
    const ms = options.watchdogMs;
    _s.watchdogMs =
        typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_WATCHDOG_MS;
    _armWatchdog();
}

/**
 * Names the step the boot is in — the only clue a timeout carries.
 *
 * @param phase - The step about to run.
 */
export function setBootPhase(phase: BootPhase): void {
    _s.phase = phase;
}

/** Suspends the watchdog — around `beforeBoot`, which may wait on a human. */
export function pauseWatchdog(): void {
    _clearTimer();
}

/** Re-arms the watchdog for a full period, if the boot is still running. */
export function resumeWatchdog(): void {
    if (_s.state === "booting") _armWatchdog();
}

/**
 * Reports a failure the boot cannot recover from. The first terminal failure wins: later
 * calls are ignored, and a screen already drawn — a timeout, or failed resources or modules —
 * is replaced.
 *
 * Once the application has been revealed, the failure is still dispatched and logged, but it
 * travels as a notice instead of a screen: what is on screen still works in part.
 *
 * @param input - The reason (never `timeout`, which only the watchdog raises), an English
 *   message for logs and support, the phase when it differs from the current one, and the
 *   module at fault when known — named first on the screen.
 */
export function failBoot(input: {
    reason: Exclude<BootFailedDetail["reason"], "timeout">;
    message: string;
    phase?: BootPhase;
    module?: string;
}): void {
    if (_s.state === "failed" || _s.state === "aborted") return;
    _clearTimer();
    const revealed = _s.state === "ready";
    if (!revealed) {
        _s.state = "failed";
        _s.heldReveal = null;
        _s.attentionPending = false;
    }
    _signal(
        {
            reason: input.reason,
            phase: input.phase ?? _s.phase,
            message: input.message,
            provisional: false,
            ...(input.module !== undefined && { module: input.module }),
        },
        !revealed
    );
    if (revealed) notifyPrimitive.notify(bootFailureMessage(input.reason), "warning");
}

/**
 * Records the declared profile resources that failed while the boot goes on.
 *
 * @param failures - The failures of the profile load report.
 * @param options - `hold: false` when a host cancelled `geoleaf:profile:failed` — the failures
 *   still feed the diagnostic, but the reveal is not held for them.
 */
export function noteProfileFailures(
    failures: readonly ProfileResourceFailure[],
    options: { hold: boolean }
): void {
    _s.profileFailures = failures.map((failure) => ({ ...failure }));
    if (!options.hold || failures.length === 0) return;
    _s.heldResources = failures.map(_resourceLine);
    _s.attentionPending = true;
}

/**
 * Reports a module whose `init()` threw while the application goes on without it.
 *
 * Dispatches `geoleaf:module:failed` (cancelable) and logs it; the diagnostic records it either
 * way. Unless a host cancelled the event: before the reveal, the reveal is held on a screen that
 * names the module — or the attention screen already up names it too; once the application is
 * revealed, a warning names it instead. After a terminal failure or an abort, nothing is drawn.
 *
 * Whether a failure is survivable is the caller's decision: a module the interface depends on
 * is a {@link failBoot}, not this.
 *
 * @param input - The module, an English message for logs and support, and the modules skipped
 *   because they depend on it.
 */
export function noteModuleFailure(input: {
    module: string;
    message: string;
    skipped: readonly string[];
}): void {
    const detail: ModuleFailedDetail = {
        module: input.module,
        message: input.message,
        skipped: [...input.skipped],
        timestamp: Date.now(),
    };
    _s.moduleFailures.push(detail);
    Log.warn("[GeoLeaf.boot] Module failed:", detail);
    const notCancelled = dispatchCancelableGeoLeafEvent("geoleaf:module:failed", detail);
    if (!notCancelled || _s.state === "failed" || _s.state === "aborted") return;
    if (_s.state === "ready") {
        notifyPrimitive.notify(moduleWarningMessage(input.module), "warning");
        return;
    }
    _s.heldModules.push(_moduleLine(detail));
    if (_s.state === "attention") renderBootFailureScreen(_attentionModel(), _actions());
    else _s.attentionPending = true;
}

/**
 * Asked by the reveal before it hides the veil.
 *
 * A failed boot keeps the veil and its screen. Pending failures — declared resources or modules,
 * that no host took over — hold the reveal on a screen that names them, and « Continue »
 * replays `reveal`. Otherwise the boot is complete: the watchdog is disarmed and a provisional
 * timeout screen, if any, is removed.
 *
 * @param reveal - The reveal to replay on « Continue ».
 * @returns `true` when the caller must NOT reveal now.
 */
export function holdReveal(reveal: () => void): boolean {
    if (_s.state === "failed" || _s.state === "aborted" || _s.state === "attention") return true;
    _clearTimer();
    if (_s.attentionPending) {
        _s.attentionPending = false;
        const drawn = renderBootFailureScreen(_attentionModel(), _actions());
        if (drawn) {
            _s.state = "attention";
            _s.heldReveal = reveal;
            return true;
        }
    }
    if (_s.state === "stalled") clearBootFailureScreen();
    _s.state = "ready";
    return false;
}

/** The `beforeBoot` hook refused the boot: nothing more is watched, held or signalled. */
export function abortBoot(): void {
    _clearTimer();
    _s.heldReveal = null;
    _s.attentionPending = false;
    if (_s.state !== "failed") _s.state = "aborted";
}

/**
 * The diagnostic the screen copies or downloads: environment, boot state, the failure, the
 * declared resources and the modules that failed, and the log's recent entries. The page and
 * resource URLs carry no query string beyond the `t` cache token, and every string is redacted.
 *
 * @returns A pretty-printed JSON document.
 */
function _diagnostic(): string {
    let lang: string | null;
    try {
        lang = getActiveLang();
    } catch {
        lang = null;
    }
    const nav = typeof navigator === "undefined" ? null : navigator;
    const loc = typeof location === "undefined" ? null : location;
    const entries: readonly LogEntry[] = getLogEntries();
    return JSON.stringify(
        {
            format: "geoleaf-diagnostic",
            formatVersion: 1,
            version: _s.version,
            time: new Date().toISOString(),
            userAgent: nav ? nav.userAgent : null,
            lang,
            page: loc ? `${loc.origin}${loc.pathname}` : null,
            state: _s.state,
            phase: _s.phase,
            failure: _s.failure,
            profileFailures: _s.profileFailures,
            moduleFailures: _s.moduleFailures,
            entries,
        },
        // A failure message can carry a URL and its key as easily as a log line can.
        (_key, value: unknown) => (typeof value === "string" ? redactSecrets(value) : value),
        2
    );
}
