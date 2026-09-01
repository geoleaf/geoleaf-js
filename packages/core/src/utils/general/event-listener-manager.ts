/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview EventListenerManager - Centralised event listener management
 */

import { Log } from "../log/index.js";

interface ListenerEntry {
    id: number;
    target:
        | EventTarget
        | { on?: (e: string, h: () => void) => void; off?: (e: string, h: () => void) => void };
    event: string;
    handler: EventListenerOrEventListenerObject | (() => void);
    options?: boolean | AddEventListenerOptions;
    label: string;
    createdAt: number;
    type?: "emitter";
}

function _detachListener(listener: ListenerEntry): void {
    if (listener.type === "emitter") {
        const t = listener.target as { off?: (e: string, h: () => void) => void };
        if (t && typeof t.off === "function") {
            t.off(listener.event, listener.handler as () => void);
        }
    } else {
        const t = listener.target as EventTarget;
        if (t && typeof t.removeEventListener === "function") {
            t.removeEventListener(
                listener.event,
                listener.handler as EventListener,
                listener.options
            );
        }
    }
}

/**
 * Tracks bound listeners so a module can release all of them at once.
 *
 * The point is teardown: `removeEventListener` needs the exact `(event, handler, options)`
 * triple used at bind time, and keeping that bookkeeping at each call site is where leaks come
 * from. Register through this and `removeAll()` is enough.
 */
export class EventListenerManager {
    name: string;
    listeners: ListenerEntry[];
    private _nextId: number;

    constructor(name = "default") {
        this.name = name;
        this.listeners = [];
        this._nextId = 1;
    }

    addEventListener(
        target: EventTarget | null,
        event: string,
        handler: EventListenerOrEventListenerObject,
        options: boolean | AddEventListenerOptions = false,
        label = ""
    ): number | null {
        if (!target || typeof target.addEventListener !== "function") {
            Log.warn(`[EventListenerManager.${this.name}] Invalid target for addEventListener`);
            return null;
        }

        const id = this._nextId++;

        target.addEventListener(event, handler, options);

        this.listeners.push({
            id,
            target,
            event,
            handler,
            // `false` and absence are equivalent for addEventListener: the key is
            // omitted rather than set to `undefined`.
            ...(options !== false && options !== undefined && { options }),
            label,
            createdAt: Date.now(),
        });

        Log.debug(`[EventListenerManager.${this.name}] Listener added:`, id, event, label);
        return id;
    }

    addEmitterListener(
        target: { on?: (e: string, h: () => void) => void } | null,
        event: string,
        handler: () => void,
        label = ""
    ): number | null {
        if (!target || typeof target.on !== "function") {
            Log.warn(`[EventListenerManager.${this.name}] Invalid emitter target`);
            return null;
        }

        const id = this._nextId++;

        target.on(event, handler);

        this.listeners.push({
            id,
            target,
            event,
            handler,
            label,
            type: "emitter",
            createdAt: Date.now(),
        });

        Log.debug(`[EventListenerManager.${this.name}] Emitter listener added:`, id, event, label);
        return id;
    }

    removeListener(id: number): boolean {
        const index = this.listeners.findIndex((l) => l.id === id);
        if (index === -1) return false;

        const listener = this.listeners[index];
        if (!listener) return false;
        _detachListener(listener);
        this.listeners.splice(index, 1);

        Log.debug(`[EventListenerManager.${this.name}] Listener removed:`, id, listener.label);
        return true;
    }

    removeListenersForTarget(
        target: EventTarget | { off?: (e: string, h: () => void) => void }
    ): number {
        const matchingListeners = this.listeners.filter((l) => l.target === target);

        matchingListeners.forEach(_detachListener);

        this.listeners = this.listeners.filter((l) => l.target !== target);

        if (matchingListeners.length > 0) {
            Log.info(
                `[EventListenerManager.${this.name}] Removed ${matchingListeners.length} listener(s) for target`
            );
        }

        return matchingListeners.length;
    }

    removeAll(): void {
        const count = this.listeners.length;

        this.listeners.forEach((listener) => {
            try {
                _detachListener(listener);
            } catch (error) {
                Log.warn(`[EventListenerManager.${this.name}] Error removing listener:`, error);
            }
        });

        this.listeners = [];

        if (count > 0) {
            Log.info(`[EventListenerManager.${this.name}] Removed ${count} listener(s)`);
        }
    }

    getCount(): number {
        return this.listeners.length;
    }

    listActiveListeners(): Array<{
        id: number;
        event: string;
        label: string;
        type: string;
        age: number;
    }> {
        return this.listeners.map((l) => ({
            id: l.id,
            event: l.event,
            label: l.label,
            type: l.type ?? "dom",
            age: Date.now() - l.createdAt,
        }));
    }

    destroy(): void {
        this.removeAll();
        Log.info(`[EventListenerManager.${this.name}] Destroyed`);
    }
}

const globalEventManager = new EventListenerManager("global");

if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
        const count = globalEventManager.getCount();
        if (count > 0) {
            Log.warn(`[EventListenerManager] ${count} listener(s) still active at page unload`);
            globalEventManager.removeAll();
        }
    });
}

/**
 * Module-level singleton of {@link EventListenerManager}, for listeners with no owner object.
 */
export const events = {
    on: (
        target: EventTarget | null,
        event: string,
        handler: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
        label?: string
    ) => globalEventManager.addEventListener(target, event, handler, options ?? false, label ?? ""),

    onEmitter: (
        target: { on?: (e: string, h: () => void) => void } | null,
        event: string,
        handler: () => void,
        label?: string
    ) => globalEventManager.addEmitterListener(target, event, handler, label ?? ""),

    off: (id: number) => globalEventManager.removeListener(id),

    offTarget: (target: EventTarget | { off?: (e: string, h: () => void) => void }) =>
        globalEventManager.removeListenersForTarget(target),

    offAll: () => globalEventManager.removeAll(),

    getCount: () => globalEventManager.getCount(),

    listActive: () => globalEventManager.listActiveListeners(),

    createManager: (name: string) => new EventListenerManager(name),
};

export { globalEventManager };
