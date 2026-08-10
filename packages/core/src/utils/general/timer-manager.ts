/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview TimerManager - Gestion centralizede des timers
 */

import { Log } from "../log/index.js";

interface TimerEntry {
    timerId: ReturnType<typeof setTimeout>;
    label: string;
    type: "timeout";
    createdAt: number;
    delay: number;
}

interface IntervalEntry {
    intervalId: ReturnType<typeof setInterval>;
    label: string;
    type: "interval";
    createdAt: number;
    interval: number;
}

/**
 * Tracks timeouts and intervals so a module can clear all of them at once.
 *
 * The timer counterpart of {@link EventListenerManager}: an interval that outlives its module
 * keeps firing against torn-down state, and nothing in the platform reclaims it.
 */
export class TimerManager {
    name: string;
    private timers: Map<number, TimerEntry>;
    private intervals: Map<number, IntervalEntry>;
    private _nextId: number;

    constructor(name = "default") {
        this.name = name;
        this.timers = new Map();
        this.intervals = new Map();
        this._nextId = 1;
    }

    setTimeout(callback: () => void, delay: number, label = ""): number {
        const id = this._nextId++;
        const timerId = setTimeout(() => {
            try {
                callback();
            } finally {
                this.timers.delete(id);
            }
        }, delay);

        this.timers.set(id, {
            timerId,
            label,
            type: "timeout",
            createdAt: Date.now(),
            delay,
        });

        Log.debug(`[TimerManager.${this.name}] setTimeout created:`, id, label);
        return id;
    }

    setInterval(callback: () => void, interval: number, label = ""): number {
        const id = this._nextId++;
        const intervalId = setInterval(() => {
            try {
                callback();
            } catch (error) {
                Log.error(`[TimerManager.${this.name}] Error in interval ${id}:`, error);
            }
        }, interval);

        this.intervals.set(id, {
            intervalId,
            label,
            type: "interval",
            createdAt: Date.now(),
            interval,
        });

        Log.debug(`[TimerManager.${this.name}] setInterval created:`, id, label);
        return id;
    }

    clearTimeout(id: number): boolean {
        const timer = this.timers.get(id);
        if (timer) {
            clearTimeout(timer.timerId);
            this.timers.delete(id);
            Log.debug(`[TimerManager.${this.name}] setTimeout cleared:`, id, timer.label);
            return true;
        }
        return false;
    }

    clearInterval(id: number): boolean {
        const interval = this.intervals.get(id);
        if (interval) {
            clearInterval(interval.intervalId);
            this.intervals.delete(id);
            Log.debug(`[TimerManager.${this.name}] setInterval cleared:`, id, interval.label);
            return true;
        }
        return false;
    }

    clearAll(): void {
        for (const [, timer] of this.timers.entries()) {
            clearTimeout(timer.timerId);
        }
        for (const [, interval] of this.intervals.entries()) {
            clearInterval(interval.intervalId);
        }

        const totalCleared = this.timers.size + this.intervals.size;
        this.timers.clear();
        this.intervals.clear();

        if (totalCleared > 0) {
            Log.info(`[TimerManager.${this.name}] Cleared ${totalCleared} timer(s)`);
        }
    }

    getStats(): { timeouts: number; intervals: number; total: number } {
        return {
            timeouts: this.timers.size,
            intervals: this.intervals.size,
            total: this.timers.size + this.intervals.size,
        };
    }

    listActiveTimers(): Array<{
        id: number;
        type: string;
        label: string;
        age: number;
        delay?: number;
        interval?: number;
    }> {
        const list: Array<{
            id: number;
            type: string;
            label: string;
            age: number;
            delay?: number;
            interval?: number;
        }> = [];

        for (const [id, timer] of this.timers.entries()) {
            list.push({
                id,
                type: "timeout",
                label: timer.label,
                age: Date.now() - timer.createdAt,
                delay: timer.delay,
            });
        }

        for (const [id, interval] of this.intervals.entries()) {
            list.push({
                id,
                type: "interval",
                label: interval.label,
                age: Date.now() - interval.createdAt,
                interval: interval.interval,
            });
        }

        return list;
    }

    destroy(): void {
        this.clearAll();
        Log.info(`[TimerManager.${this.name}] Destroyed`);
    }
}

const globalTimerManager = new TimerManager("global");

if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
        const stats = globalTimerManager.getStats();
        if (stats.total > 0) {
            Log.warn(`[TimerManager] ${stats.total} timer(s) still active at page unload`);
            globalTimerManager.clearAll();
        }
    });
}
