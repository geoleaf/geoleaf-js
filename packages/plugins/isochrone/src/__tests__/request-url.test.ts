/**
 * @geoleaf-plugins/isochrone — reading, composing and masking a URL
 */
import { describe, expect, it } from "vitest";

import { buildRequestUrl, maskUrl, parseEndpoint } from "../request-url.js";

/** Stands for a key: it must reach the engine, and nothing else. */
const SENTINEL = "s3nt1nel-K3Y";

describe("@geoleaf-plugins/isochrone — parseEndpoint", () => {
    it("accepts an address in https", () => {
        expect(parseEndpoint("https://engine.example/valhalla")?.hostname).toBe("engine.example");
    });

    it.each([
        ["http://engine.example"],
        ["ftp://engine.example"],
        ["//engine.example"],
        ["engine.example"],
        [""],
        ["https://"],
        [42],
        [null],
        [undefined],
    ])("refuses %s", (value) => {
        expect(parseEndpoint(value)).toBeNull();
    });

    it("refuses an address carrying credentials", () => {
        expect(parseEndpoint(`https://user:${SENTINEL}@engine.example`)).toBeNull();
        expect(parseEndpoint("https://user@engine.example")).toBeNull();
    });
});

describe("@geoleaf-plugins/isochrone — buildRequestUrl", () => {
    it("appends the action to the address, whatever its trailing slashes", () => {
        expect(buildRequestUrl("https://engine.example", "/isochrone", {})).toBe(
            "https://engine.example/isochrone"
        );
        expect(buildRequestUrl("https://engine.example/valhalla//", "/isochrone", {})).toBe(
            "https://engine.example/valhalla/isochrone"
        );
    });

    it("writes the parameters through the URL API, so nothing is escaped by hand", () => {
        const url = buildRequestUrl("https://engine.example", "/isochrone", {
            json: '{"a":"b & c"}',
            api_key: SENTINEL,
        });
        const parsed = new URL(url ?? "");
        expect(parsed.searchParams.get("json")).toBe('{"a":"b & c"}');
        expect(parsed.searchParams.get("api_key")).toBe(SENTINEL);
    });

    it("replaces a parameter the address already carries", () => {
        const url = buildRequestUrl("https://engine.example/?json=old&keep=1", "/isochrone", {
            json: "new",
        });
        const parsed = new URL(url ?? "");
        expect(parsed.searchParams.getAll("json")).toEqual(["new"]);
        expect(parsed.searchParams.get("keep")).toBe("1");
    });

    it("answers null for an address that is refused", () => {
        expect(buildRequestUrl("http://engine.example", "/isochrone", {})).toBeNull();
        expect(buildRequestUrl("not a url", "/isochrone", {})).toBeNull();
    });
});

describe("@geoleaf-plugins/isochrone — maskUrl", () => {
    it("keeps the origin and the path, and drops the query", () => {
        const masked = maskUrl(`https://engine.example/valhalla/isochrone?api_key=${SENTINEL}`);
        expect(masked).toBe("https://engine.example/valhalla/isochrone");
        expect(masked).not.toContain(SENTINEL);
    });

    it("does not echo a URL it cannot read", () => {
        const masked = maskUrl(`not a url ${SENTINEL}`);
        expect(masked).toBe("<unreadable url>");
        expect(masked).not.toContain(SENTINEL);
    });
});
