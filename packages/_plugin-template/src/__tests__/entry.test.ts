/**
 * __PLUGIN_PKG__ — starter tests
 *
 * They hold what the scaffold actually does: the façade delegates, the configuration is read
 * from the plugin's own branch of the profile, and `enabled: false` switches the plugin off.
 * Replace them as the plugin grows — but keep the coverage threshold met: the two files the
 * measure excludes (`entry.ts`, `public-api.ts`) are not where the logic lives.
 */
import { afterEach, describe, expect, it } from "vitest";

import { getPluginConfig } from "../config.js";
import { buildPublicApi } from "../public-api.js";
/* <i18n> */
import langEn from "../lang/lang-en.js";
import langFr from "../lang/lang-fr.js";
/* </i18n> */

const previous = globalThis.GeoLeaf;

/** Installs a partial namespace: only `Config.get` is read by the code under test. */
function withProfileBranch(branch: Record<string, unknown>): void {
    (globalThis as { GeoLeaf?: unknown }).GeoLeaf = {
        Config: {
            get: (key: string, fallback: unknown) =>
                key === "modules.__PLUGIN_NAME__" ? branch : fallback,
        },
    };
}

afterEach(() => {
    globalThis.GeoLeaf = previous;
    document.body.replaceChildren();
});

describe("__PLUGIN_PKG__ configuration", () => {
    it("falls back on the built-in defaults when the profile says nothing", () => {
        expect(getPluginConfig().enabled).toBe(true);
    });

    it("lets the profile override a default, from the plugin's own branch", () => {
        withProfileBranch({ enabled: false });
        expect(getPluginConfig().enabled).toBe(false);
    });
});

describe("__PLUGIN_PKG__ public API", () => {
    it("opens when the plugin is enabled", () => {
        expect(buildPublicApi().open()).toBe(true);
        /* <ui> */
        expect(document.querySelectorAll(".gl-__PLUGIN_NAME__")).toHaveLength(1);
        /* </ui> */
    });

    /* <ui> */
    it("builds its root element once, however many times it is opened", () => {
        const api = buildPublicApi();
        api.open();
        api.open();
        expect(document.querySelectorAll(".gl-__PLUGIN_NAME__")).toHaveLength(1);
    });
    /* </ui> */

    it("stays closed when the profile switches the plugin off", () => {
        withProfileBranch({ enabled: false });
        expect(buildPublicApi().open()).toBe(false);
        /* <ui> */
        expect(document.querySelector(".gl-__PLUGIN_NAME__")).toBeNull();
        /* </ui> */
    });
});
/* <i18n> */

describe("__PLUGIN_PKG__ dictionaries", () => {
    it("carry the same keys in every language", () => {
        expect(Object.keys(langEn).sort()).toEqual(Object.keys(langFr).sort());
    });
});
/* </i18n> */
