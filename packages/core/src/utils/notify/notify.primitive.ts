/*!
 * GeoLeaf Core – Notify Primitive
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * Lightweight notify primitive: buffers user-facing messages before a renderer
 * (e.g. the toast UI) registers itself, then forwards them on flush.
 * Console fallback ensures messages are never silently lost during early boot.
 *
 * Design intent: this primitive is the stable `GeoLeaf.notify()` anchor.
 * In Phase 3, the toast renderer becomes a plugin that calls `registerRenderer()`.
 */

import type {
    INotifyPrimitive,
    NotifyLevel,
    NotifyRenderer,
} from "../../contracts/notify.contract.js";

interface QueueEntry {
    message: string;
    level: NotifyLevel;
}

const _consoleFallback: Record<NotifyLevel, (msg: string) => void> = {
    info: (msg) => console.info("[GeoLeaf]", msg),
    success: (msg) => console.info("[GeoLeaf]", msg),
    warning: (msg) => console.warn("[GeoLeaf]", msg),
    error: (msg) => console.error("[GeoLeaf]", msg),
};

function createNotifyPrimitive(): INotifyPrimitive {
    const _queue: QueueEntry[] = [];
    let _renderer: NotifyRenderer | null = null;

    function notify(message: string, level: NotifyLevel = "info"): void {
        if (_renderer) {
            try {
                _renderer(message, level);
            } catch {
                _consoleFallback[level](message);
            }
        } else {
            _queue.push({ message, level });
            _consoleFallback[level](message);
        }
    }

    function registerRenderer(renderer: NotifyRenderer): void {
        _renderer = renderer;
        flush();
    }

    function unregisterRenderer(renderer?: NotifyRenderer): void {
        // Identity-checked when a renderer is given: a capability torn down *after*
        // another one registered must not silently blind the live renderer.
        if (renderer !== undefined && _renderer !== renderer) return;
        _renderer = null;
    }

    function flush(): void {
        if (!_renderer || _queue.length === 0) return;
        const pending = _queue.splice(0);
        for (const entry of pending) {
            try {
                _renderer(entry.message, entry.level);
            } catch {
                _consoleFallback[entry.level](entry.message);
            }
        }
    }

    return { notify, registerRenderer, unregisterRenderer, flush };
}

/** Singleton notify primitive. Exposed as `GeoLeaf.notify` after globals.core wiring. */
const notifyPrimitive = createNotifyPrimitive();

export { notifyPrimitive, createNotifyPrimitive };
export type { INotifyPrimitive, NotifyLevel, NotifyRenderer };
