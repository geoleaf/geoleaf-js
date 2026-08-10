/*!
 * @geoleaf/field-renderer — ComponentRegistry
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Module singleton shared by every host plugin. Hosts should fill it via
 * `registerBuiltinComponents()` (see `builtins.ts`) rather than by hand, so the set of
 * available field types does not depend on which plugins happen to be loaded.
 * https://geoleaf.dev
 */
import type { ComponentDefinition } from "./contract.js";

class ComponentRegistryImpl {
    private readonly _defs = new Map<string, ComponentDefinition<unknown>>();

    /** Register a component definition. Overwrites any existing one with the same id. */
    register<TValue>(def: ComponentDefinition<TValue>): void {
        this._defs.set(def.id, def as ComponentDefinition<unknown>);
    }

    /** Returns the definition for the given type id, or undefined. */
    get<TValue = unknown>(typeId: string): ComponentDefinition<TValue> | undefined {
        return this._defs.get(typeId) as ComponentDefinition<TValue> | undefined;
    }

    /** Returns true if a definition is registered for the given type id. */
    has(typeId: string): boolean {
        return this._defs.has(typeId);
    }

    /** Returns all registered type ids. */
    list(): string[] {
        return Array.from(this._defs.keys());
    }
}

/** Singleton registry shared across the plugin lifecycle. */
export const ComponentRegistry = new ComponentRegistryImpl();
