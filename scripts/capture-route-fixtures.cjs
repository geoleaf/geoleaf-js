#!/usr/bin/env node
/**
 * @file capture-route-fixtures.cjs
 * @description Captures the routing-provider fixture corpus. Run BY HAND, never in CI.
 *
 * ## Why this file exists, and why nothing calls it
 *
 * The normalisation contract of `@geoleaf-plugins/routing` is only worth what the responses it
 * was frozen against are worth. Freezing a model first and inventing fixtures to match it proves
 * that the fixtures match the model — which is not the question. So the corpus is captured from
 * real providers, once, and versioned.
 *
 * 🛑 **No test ever calls a provider, and this script is the only code in the repository that
 * touches the network.** That is not caution, it is the only shape that stays green unattended:
 * a test hitting a public instance is subject to a fair-use quota, and it makes the run
 * non-reproducible — a red would mean "the internet moved", which nobody can act on.
 *
 * **It is therefore deliberately absent from `ci-local.cjs` and from `ci.yml`.** If you find
 * yourself wiring it in, the thing to change is the reasoning, not the wiring.
 *
 * ## The trip, and why this one
 *
 * Three waypoints across Réunion — Saint-Denis, Saint-Paul, Saint-Pierre. Three, because two
 * would yield a single leg and the invariant that matters ("the legs sum to the total") is
 * vacuous on one leg. This island, because its road network is dense enough to produce a real
 * manoeuvre list and small enough that the capture stays a few tens of kilobytes.
 *
 * ## Why both providers answer the SAME trip
 *
 * A corpus of two unrelated trips would let a normaliser look correct while mapping two
 * different journeys onto two different shapes. Same waypoints on both sides is what makes the
 * two normalised results comparable — and comparing them is the only way to see that the shared
 * model is genuinely shared and not two models with one name.
 *
 * ## Why polyline geometry on BOTH sides
 *
 * OSRM can answer GeoJSON (`geometries=geojson`); Valhalla only ever emits an encoded polyline.
 * Asking OSRM for GeoJSON would therefore buy a second decoding path for the one provider that
 * does not need it, while the other still requires the decoder. Measured on this very trip:
 * 95 780 bytes in GeoJSON against 34 137 in polyline, for the same legs, the same steps and the
 * same totals. One path, and a third of the weight.
 *
 * ## No credentials, and nothing to configure
 *
 * Both instances are public and unauthenticated. If a future provider needs a key, it does NOT
 * come here: a captured fixture is committed, and a key that reaches a committed file has left
 * the machine.
 *
 * ## This script is the ONLY formatter of the corpus
 *
 * The fixtures are written pretty-printed and listed in `.prettierignore`. That is not a
 * style preference: these files exist so that a RE-capture answers « did the provider change
 * its answer? », and a second formatter in the loop turns every such diff into noise the
 * first time the two disagree. Same class as the generated artefacts already listed there.
 *
 * Usage:  node scripts/capture-route-fixtures.cjs [--force]
 * Exit codes: 0 captured · 1 a provider refused or answered something unusable · 2 tooling error.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const registry = require("./lib/packages.cjs");
const ROOT = registry.ROOT;

/**
 * Where the corpus lands.
 *
 * ⚠️ At the package ROOT and NOT under `src/`, deliberately: the manifest ships `src/`
 * (`files: ["dist/", "src/", "LICENSE"]`), so a fixture placed there would travel to every npm
 * consumer for no reason. The tests reach it by a relative path; npm never sees it.
 */
const OUT_DIR = path.join(registry.requireByDirName("routing").absDir, "fixtures");

/** The trip. Longitude first in URLs, latitude first in Valhalla's JSON — see below. */
const WAYPOINTS = [
    { name: "Saint-Denis", lat: -20.8823, lon: 55.4504 },
    { name: "Saint-Paul", lat: -21.0096, lon: 55.2708 },
    { name: "Saint-Pierre", lat: -21.3393, lon: 55.4781 },
];

/**
 * The two captures.
 *
 * ⚠️ The coordinate ORDER differs between the two, and it is the classic way to capture a trip
 * that is not the one you meant: OSRM takes `lon,lat` in its path, Valhalla takes `{lat, lon}`
 * in its body. Both are derived from the same `WAYPOINTS` here so they cannot drift apart.
 */
const CAPTURES = [
    {
        id: "osrm",
        file: "osrm-reunion-3-waypoints.json",
        describe() {
            const coords = WAYPOINTS.map((w) => `${w.lon},${w.lat}`).join(";");
            return {
                method: "GET",
                url:
                    `https://router.project-osrm.org/route/v1/driving/${coords}` +
                    `?steps=true&overview=full&geometries=polyline`,
                body: null,
            };
        },
        /**
         * @param {any} json Parsed response.
         * @returns {string|null} Why it is unusable, or null.
         */
        reject(json) {
            if (json?.code !== "Ok") return `code = ${JSON.stringify(json?.code)}`;
            const route = json?.routes?.[0];
            if (!route) return "aucune route";
            if (!Array.isArray(route.legs) || route.legs.length < 2)
                return `${route.legs?.length ?? 0} tronçon(s) — il en faut au moins 2`;
            if (route.legs.some((/** @type {any} */ l) => !l.steps?.length))
                return "un tronçon sans manœuvre";
            return null;
        },
    },
    {
        id: "valhalla",
        file: "valhalla-reunion-3-waypoints.json",
        describe() {
            return {
                method: "POST",
                url: "https://valhalla1.openstreetmap.de/route",
                body: {
                    locations: WAYPOINTS.map((w) => ({ lat: w.lat, lon: w.lon })),
                    costing: "auto",
                    // The narrative is asked of the SERVER in the interface language rather than
                    // translated client-side: it is free, already written, and it spares the
                    // plugin a corpus of turn phrases to maintain in every locale.
                    directions_options: { units: "kilometers", language: "fr-FR" },
                },
            };
        },
        /**
         * @param {any} json Parsed response.
         * @returns {string|null} Why it is unusable, or null.
         */
        reject(json) {
            const trip = json?.trip;
            if (!trip) return "aucun `trip`";
            if (trip.status !== 0) return `status = ${trip.status} (${trip.status_message})`;
            if (!Array.isArray(trip.legs) || trip.legs.length < 2)
                return `${trip.legs?.length ?? 0} tronçon(s) — il en faut au moins 2`;
            if (trip.legs.some((/** @type {any} */ l) => !l.maneuvers?.length))
                return "un tronçon sans manœuvre";
            // The point of choosing this provider is that it localises. A capture that silently
            // came back in English would freeze the contract against the wrong thing.
            if (trip.language !== "fr-FR") return `language = ${JSON.stringify(trip.language)}`;
            return null;
        },
    },
];

const force = process.argv.includes("--force");

/** @returns {Promise<void>} */
async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    /** @type {string[]} */
    const problems = [];

    for (const capture of CAPTURES) {
        const req = capture.describe();
        const out = path.join(OUT_DIR, capture.file);
        const rel = path.relative(ROOT, out);

        if (fs.existsSync(out) && !force) {
            console.log(
                `⏭️  ${capture.id} — ${rel} existe déjà, non réécrit (--force pour rejouer).`
            );
            console.log(`    requête gelée : ${req.method} ${req.url}`);
            continue;
        }

        console.log(`── ${capture.id} ──`);
        console.log(`   ${req.method} ${req.url}`);
        if (req.body) console.log(`   body: ${JSON.stringify(req.body)}`);

        let json;
        try {
            const res = await fetch(req.url, {
                method: req.method,
                headers: req.body ? { "Content-Type": "application/json" } : undefined,
                body: req.body ? JSON.stringify(req.body) : undefined,
            });
            if (!res.ok) {
                problems.push(`${capture.id} — HTTP ${res.status}`);
                continue;
            }
            json = await res.json();
        } catch (err) {
            problems.push(`${capture.id} — ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }

        const why = capture.reject(json);
        if (why) {
            // Refusing beats writing: a fixture that does not carry what the contract is frozen
            // against would make every assertion below it vacuously true.
            problems.push(`${capture.id} — réponse inexploitable : ${why}`);
            continue;
        }

        fs.writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`, "utf8");
        console.log(`   ✅ ${rel} — ${fs.statSync(out).size} octets, non retouché.`);
    }

    if (problems.length > 0) {
        console.error("");
        console.error("ERROR [ROUTE-FIXTURES]: capture incomplète —");
        for (const p of problems) console.error(`  ${p}`);
        console.error("");
        console.error(
            "  Rien n'a été écrit pour ces fournisseurs. Un corpus partiel ferait passer les\n" +
                "  tests de normalisation sur le seul côté capturé, ce qui est précisément la\n" +
                "  comparaison que ce corpus existe pour rendre possible."
        );
        process.exit(1);
    }

    console.log("");
    console.log(
        `✅ [ROUTE-FIXTURES] corpus dans ${path.relative(ROOT, OUT_DIR)} — ` +
            `${CAPTURES.length} fournisseur(s), même trajet à ${WAYPOINTS.length} étapes ` +
            `(${WAYPOINTS.map((w) => w.name).join(" → ")}).`
    );
}

main().catch((err) => {
    console.error(`ERROR [ROUTE-FIXTURES]: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(2);
});
