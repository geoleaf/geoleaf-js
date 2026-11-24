/**
 * The configuration of the `"pair"` contract and of the object form of `auth.ui`.
 *
 * A setting written for one contract and silently ignored by the other is refused: an
 * integrator who sets `refreshEndpoint` under `"token"` believes a renewal is configured that
 * goes elsewhere.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { validateConfig, ConfigError, loginUiOf, isPairContract } from "../config.js";
import type { ConnectorConfig } from "../config.js";

const BASE = "https://api.example.com";
const PAIR: ConnectorConfig = {
    baseUrl: BASE,
    auth: {
        endpoint: `${BASE}/auth/token`,
        contract: "pair",
        refreshEndpoint: `${BASE}/auth/refresh`,
        revokeEndpoint: `${BASE}/auth/revoke`,
    },
};

const withAuth = (auth: Record<string, unknown>): ConnectorConfig =>
    ({ baseUrl: BASE, auth: { endpoint: `${BASE}/auth/token`, ...auth } }) as ConnectorConfig;

afterEach(() => {
    vi.restoreAllMocks();
});

describe("auth.contract", () => {
    it("accepte une configuration pair complète", () => {
        expect(() => validateConfig(PAIR)).not.toThrow();
        expect(isPairContract(PAIR)).toBe(true);
    });

    it("le défaut reste le contrat token", () => {
        expect(isPairContract(withAuth({}))).toBe(false);
        expect(() => validateConfig(withAuth({}))).not.toThrow();
    });

    it("refuse un contrat inconnu", () => {
        expect(() => validateConfig(withAuth({ contract: "oauth" }))).toThrow(ConfigError);
    });

    it("pair exige refreshEndpoint ; revokeEndpoint est facultatif", () => {
        expect(() => validateConfig(withAuth({ contract: "pair" }))).toThrow(/refreshEndpoint/);
        expect(() =>
            validateConfig(withAuth({ contract: "pair", refreshEndpoint: `${BASE}/r` }))
        ).not.toThrow();
    });

    it("🛑 refreshEndpoint et revokeEndpoint sont refusés sous le contrat token", () => {
        expect(() => validateConfig(withAuth({ refreshEndpoint: `${BASE}/r` }))).toThrow(
            /belongs to contract "pair"/
        );
        expect(() => validateConfig(withAuth({ revokeEndpoint: `${BASE}/v` }))).toThrow(
            /belongs to contract "pair"/
        );
    });

    it("🛑 les deux routes portent un secret : https://, comme endpoint", () => {
        expect(() =>
            validateConfig(
                withAuth({ contract: "pair", refreshEndpoint: "http://api.example.com/r" })
            )
        ).toThrow(/auth.refreshEndpoint must use HTTPS/);
        expect(() =>
            validateConfig(
                withAuth({
                    contract: "pair",
                    refreshEndpoint: `${BASE}/r`,
                    revokeEndpoint: "http://api.example.com/v",
                })
            )
        ).toThrow(/auth.revokeEndpoint must use HTTPS/);
    });
});

describe("auth.ui — forme objet", () => {
    it("true vaut {} ; false et l'absence valent null", () => {
        expect(loginUiOf(withAuth({ ui: true }))).toEqual({});
        expect(loginUiOf(withAuth({ ui: false }))).toBeNull();
        expect(loginUiOf(withAuth({}))).toBeNull();
    });

    it("accepte un élément ou une fonction comme point de montage", () => {
        const el = document.createElement("div");
        expect(() => validateConfig(withAuth({ ui: { mount: el } }))).not.toThrow();
        expect(() => validateConfig(withAuth({ ui: { mount: () => el } }))).not.toThrow();
    });

    it("refuse un point de montage qui n'est ni l'un ni l'autre", () => {
        expect(() => validateConfig(withAuth({ ui: { mount: "#panel" } }))).toThrow(
            /auth.ui.mount/
        );
    });

    it("refuse un onDismiss qui n'est pas une fonction, un notice qui n'est pas un texte", () => {
        expect(() => validateConfig(withAuth({ ui: { onDismiss: "close" } }))).toThrow(/onDismiss/);
        expect(() => validateConfig(withAuth({ ui: { notice: 42 } }))).toThrow(/notice/);
    });

    it("refuse une valeur qui n'est ni un booléen ni un objet", () => {
        expect(() => validateConfig(withAuth({ ui: "modal" }))).toThrow(/auth.ui/);
    });
});
