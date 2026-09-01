#!/usr/bin/env node
/**
 * INSTRUCTION PROBE (throwaway, ungated): what does a DETERMINISTIC clustering
 * oracle have available, at the exact spot where
 * `06-performance-baseline.spec.js` built its clustered source?
 *
 * It reproduces the test's construction (`map.addSource(..., { cluster: true,
 * clusterMaxZoom: 14 })` + two `circle` layers) for each N, and records what an
 * oracle could assert — rendered feature count, features carrying `point_count`,
 * sum of the `point_count` — BEFORE choosing a threshold. Choosing the threshold
 * first would be the fossilised-verdict failure mode: a verdict that cannot be
 * re-measured.
 *
 * It also records the INVERSE WITNESS: the same source with `cluster: false`. An
 * oracle that does not separate the two columns guards nothing.
 *
 * Usage : node scripts/probe-cluster-oracle.mjs      (targets the nginx vhost, starts nothing)
 */

import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL } from "../e2e/helpers/base-url.js";

const URL = process.env.GEOLEAF_PROBE_URL || `${baseURL("core")}/`;

const run = async () => {
    const browser = await chromium.launch({ args: SOFTWARE_GL_ARGS });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block" });
    const page = await context.newPage();
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.waitForFunction(
        () => {
            try {
                const a = window.GeoLeaf?.Core?.getMap();
                return a && a.getNativeMap && a.getNativeMap() !== null;
            } catch {
                return false;
            }
        },
        null,
        { timeout: 20_000 }
    );

    const out = await page.evaluate(async () => {
        const map = window.GeoLeaf.Core.getMap().getNativeMap();
        const b = map.getBounds();
        const west = b.getWest(),
            east = b.getEast(),
            south = b.getSouth(),
            north = b.getNorth();
        const zoom0 = map.getZoom();
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        const mesurer = async (n, cluster) => {
            const id = "_probe_" + (cluster ? "c" : "p") + "_" + n + "_" + Date.now();
            const features = [];
            for (let i = 0; i < n; i++) {
                features.push({
                    type: "Feature",
                    geometry: {
                        type: "Point",
                        coordinates: [
                            west + Math.random() * (east - west),
                            south + Math.random() * (north - south),
                        ],
                    },
                    properties: { id: i },
                });
            }
            const src = { type: "geojson", data: { type: "FeatureCollection", features } };
            if (cluster) {
                src.cluster = true;
                src.clusterMaxZoom = 14;
            }
            map.addSource(id, src);
            map.addLayer({
                id: id + "-c",
                type: "circle",
                source: id,
                filter: ["has", "point_count"],
                paint: { "circle-radius": 10 },
            });
            map.addLayer({
                id: id + "-p",
                type: "circle",
                source: id,
                filter: ["!", ["has", "point_count"]],
                paint: { "circle-radius": 4 },
            });
            await sleep(600);

            const lire = () => {
                const f = map.querySourceFeatures(id);
                const cl = f.filter((x) => x.properties && x.properties.point_count > 0);
                const somme = cl.reduce((s, x) => s + x.properties.point_count, 0);
                return { rendues: f.length, clusters: cl.length, groupees: somme };
            };
            const auRepos = lire();
            // The test measures DURING a +2 zoom: record after the zoom too.
            map.setZoom(zoom0 + 2, { animate: false });
            await sleep(600);
            const apresZoom = lire();
            map.setZoom(zoom0, { animate: false });
            await sleep(200);

            map.removeLayer(id + "-c");
            map.removeLayer(id + "-p");
            map.removeSource(id);
            return { n, cluster, auRepos, apresZoom };
        };

        const res = [];
        for (const n of [100, 1000, 5000, 10000]) {
            res.push(await mesurer(n, true));
            res.push(await mesurer(n, false));
        }
        return { zoom0, maxZoomCarte: map.getMaxZoom(), res };
    });

    console.log(
        `\nzoom initial de la carte : ${out.zoom0.toFixed(2)}  (clusterMaxZoom du test = 14)`
    );
    console.log(
        `zoom du test pendant la mesure : ${out.zoom0.toFixed(2)} → ${(out.zoom0 + 2).toFixed(2)}\n`
    );
    console.log(
        "  N      cluster | au repos: rendues clusters groupées | après zoom+2: rendues clusters groupées"
    );
    for (const r of out.res) {
        const f = (o) =>
            String(o.rendues).padStart(8) +
            String(o.clusters).padStart(9) +
            String(o.groupees).padStart(10);
        console.log(
            "  " +
                String(r.n).padEnd(7) +
                (r.cluster ? "OUI    " : "non    ") +
                "|" +
                f(r.auRepos) +
                "        |" +
                f(r.apresZoom)
        );
    }
    console.log(
        "\n  « clusters » = features portant point_count > 0 ; « groupées » = somme des point_count."
    );
    console.log(
        "  Une ligne cluster=non à clusters=0 est le TÉMOIN INVERSE : c'est ce qu'un oracle doit voir rouge.\n"
    );

    await browser.close();
};

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
