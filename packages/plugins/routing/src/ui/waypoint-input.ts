/*!
 * @geoleaf-plugins/routing — Adding a stop
 *
 * The field that was missing: type an address or a pair of coordinates, or pick on the map.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { Waypoint } from "../model.js";
import { parseTypedPoint, type ParseRefusal } from "../parse-point.js";
import { searchAddress, geocodingAvailable, type AddressHit } from "../geocode-seam.js";

/**
 * ## 🛑 Why this file exists: the model could compose N stops and nothing fed it
 *
 * `addWaypoint`, `moveWaypoint`, `roleAt` and `maxWaypoints` were delivered, exposed on the public
 * API and tested. **Nothing in the repository called them with a new point.** The panel carried
 * five controls and not one field, so the only stops that could ever enter were the destination a
 * POI opened with and the origin the geolocation button filled — two points, on a plugin whose
 * whole premise is a route with stops.
 *
 * The list operations were the sinks. This is the source.
 *
 * ## Why coordinates are tried BEFORE the address search
 *
 * The search costs a network round trip and a provider quota; parsing costs nothing. And a string
 * that parses as a coordinate pair is never an address — nobody searches for `-21.09, 55.47`
 * expecting a street. Trying the cheap, certain path first is not an optimisation, it is the only
 * order that does not spend a quota unit to learn what the string already said.
 *
 * ## Why the field works with `geocoding` ABSENT
 *
 * The CDC calls that integration optional, and optional has to mean something. With the plugin
 * missing, the field still accepts coordinates and says so — the flow degrades to something
 * usable. A field that refused everything without a plugin the profile never promised would be a
 * dead control, and this package already has a doctrine about those: it does not draw them.
 */

/** What the input calls back into. */
export interface WaypointInputHandlers {
    /** A stop was resolved and should be appended. */
    onAdd(waypoint: Waypoint): void;
    /** The user asked to pick on the map instead. */
    onPickOnMap(): void;
}

/** Every string the input renders. */
export interface WaypointInputLabels {
    /** Accessible name and placeholder of the field. */
    readonly field: string;
    /** The add button. */
    readonly add: string;
    /** The "pick on the map" button. */
    readonly pickOnMap: string;
    /** Shown while the map is waiting for a click. */
    readonly picking: string;
    /** A refusal, worded by the caller. */
    refusal(reason: InputRefusal): string;
}

/** Why an entry produced no stop. */
export type InputRefusal =
    | ParseRefusal
    /** The address search found nothing. */
    | "no-match"
    /** The address search could not be reached. */
    | "search-failed";

/** A live input. */
export interface WaypointInput {
    /** The element, for the caller to place. */
    readonly element: HTMLElement;
    /** Reflects whether the map is currently waiting for a click. */
    setPicking(picking: boolean): void;
    /** Empties the field and any results. */
    reset(): void;
}

/**
 * Builds the stop input.
 *
 * @param labels Every string it renders.
 * @param handlers What it calls back into.
 * @returns The live input.
 */
export function createWaypointInput(
    labels: WaypointInputLabels,
    handlers: WaypointInputHandlers
): WaypointInput {
    const element = document.createElement("div");
    element.className = "gl-routing-add";

    const field = document.createElement("input");
    field.type = "text";
    field.className = "gl-routing-add__field";
    field.placeholder = labels.field;
    // A placeholder is not a label: it disappears the moment someone types, and a screen reader
    // may or may not announce it. Both, and the accessible name survives the first keystroke.
    field.setAttribute("aria-label", labels.field);

    const addBtn = button("gl-routing-add__submit", labels.add);
    const pickBtn = button("gl-routing-add__pick", labels.pickOnMap);

    const results = document.createElement("ul");
    results.className = "gl-routing-add__results";
    results.hidden = true;

    const message = document.createElement("p");
    message.className = "gl-routing-add__message";
    message.setAttribute("aria-live", "polite");

    element.append(field, addBtn, pickBtn, results, message);

    /** Guards against a stale search overwriting a newer one. */
    let generation = 0;

    /**
     * Shows a refusal, or clears the message when passed `null`.
     *
     * @param reason The refusal, or `null`.
     */
    function say(reason: InputRefusal | null): void {
        message.textContent = reason ? labels.refusal(reason) : "";
    }

    /** Empties the results list and hides it. */
    function clearResults(): void {
        results.replaceChildren();
        results.hidden = true;
    }

    /**
     * Appends `waypoint` and returns the field to its resting state.
     *
     * @param waypoint The resolved stop.
     */
    function accept(waypoint: Waypoint): void {
        handlers.onAdd(waypoint);
        field.value = "";
        clearResults();
        say(null);
    }

    /** Resolves whatever is typed, coordinates first. */
    async function submit(): Promise<void> {
        const text = field.value.trim();
        if (text === "") return;
        clearResults();

        const parsed = parseTypedPoint(text);
        if (parsed.ok) {
            accept(parsed.waypoint);
            return;
        }
        // ⚠️ Out of range is NOT handed to the search. `200, 500` is a pair someone mistyped, not
        // a place name, and searching for it would answer with something plausible and wrong —
        // the worst of the three outcomes.
        if (parsed.reason === "out-of-range" || !geocodingAvailable()) {
            say(parsed.reason);
            return;
        }

        const mine = ++generation;
        let hits: readonly AddressHit[];
        try {
            hits = await searchAddress(text);
        } catch {
            if (mine === generation) say("search-failed");
            return;
        }
        // A slower earlier search must not overwrite a newer one's results — the user would be
        // choosing from answers to a question they have already replaced.
        if (mine !== generation) return;
        if (hits.length === 0) {
            say("no-match");
            return;
        }
        showHits(hits);
    }

    /**
     * Renders the address matches as a choosable list.
     *
     * @param hits What the search answered.
     */
    function showHits(hits: readonly AddressHit[]): void {
        results.replaceChildren(...hits.map((hit) => hitRow(hit, accept)));
        results.hidden = false;
        say(null);
    }

    addBtn.addEventListener("click", () => void submit());
    field.addEventListener("keydown", (e) => {
        // Enter submits. Without it the field needs a mouse to be useful, which is the same
        // accessibility failure the step list's move buttons exist to avoid.
        if (e.key === "Enter") {
            e.preventDefault();
            void submit();
        }
    });
    pickBtn.addEventListener("click", () => handlers.onPickOnMap());

    return {
        element,
        setPicking(picking: boolean): void {
            pickBtn.textContent = picking ? labels.picking : labels.pickOnMap;
            pickBtn.setAttribute("aria-pressed", picking ? "true" : "false");
            element.classList.toggle("gl-routing-add--picking", picking);
        },
        reset(): void {
            field.value = "";
            clearResults();
            say(null);
        },
    };
}

/**
 * One button.
 *
 * @param className Its class.
 * @param label Its text and accessible name.
 * @returns The button.
 */
function button(className: string, label: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = label;
    return b;
}

/**
 * One address match, as a row the user can choose.
 *
 * @param hit The match.
 * @param onChoose Called with the resolved stop.
 * @returns The list item.
 */
function hitRow(hit: AddressHit, onChoose: (waypoint: Waypoint) => void): HTMLLIElement {
    const li = document.createElement("li");
    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "gl-routing-add__result";
    // `textContent`: the label comes from a geocoding provider — data from outside this package
    // and outside the integrator's control.
    choose.textContent = hit.label;
    choose.addEventListener("click", () => {
        onChoose({ coordinates: [hit.lng, hit.lat], name: hit.label });
    });
    li.append(choose);
    return li;
}
