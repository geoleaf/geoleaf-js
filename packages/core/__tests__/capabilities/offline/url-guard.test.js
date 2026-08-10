/**
 * Unit tests — url-guard (CAPACITÉS S1)
 *
 * `validateFetchUrl` is the scheme guard standing in front of every cache fetch
 * (`cache/storage.ts:47`, `cache/metrics.ts:50`, `cache/fetch-manager.ts:49` and `:306`),
 * and it had NO direct test — the only file of the capability in that situation, and the
 * one where it matters most. The cases below are the ones its own JSDoc documents.
 *
 * ⚠️ Scope note: this is a SCHEME allowlist, not an SSRF filter. It deliberately admits
 * `http://127.0.0.1` and `http://169.254.169.254`; the tests pin that, so nobody later
 * mistakes this guard for private-network protection it never claimed to offer.
 */

import { validateFetchUrl } from "../../../src/capabilities/offline/cache/url-guard.js";

describe("validateFetchUrl", () => {
    describe("accepts", () => {
        test("an absolute https URL", () => {
            expect(() => validateFetchUrl("https://tiles.example.org/1/2/3.png")).not.toThrow();
        });

        test("an absolute http URL", () => {
            expect(() => validateFetchUrl("http://tiles.example.org/1/2/3.png")).not.toThrow();
        });

        test("a relative URL — the browser resolves it same-origin", () => {
            expect(() => validateFetchUrl("../profiles/tourism/profile.json")).not.toThrow();
            expect(() => validateFetchUrl("/profiles/tourism/profile.json")).not.toThrow();
            expect(() => validateFetchUrl("layers.json")).not.toThrow();
        });
    });

    describe("blocks", () => {
        test.each([
            ["javascript:", "javascript:alert(1)"],
            ["file:", "file:///etc/passwd"],
            ["data:", "data:text/html,<h1>x</h1>"],
            ["blob:", "blob:https://example.org/1234"],
            ["ftp:", "ftp://example.org/f.txt"],
        ])("the %s scheme", (_label, url) => {
            expect(() => validateFetchUrl(url)).toThrow(/scheme .* is not allowed/);
        });
    });

    describe("rejects unusable input", () => {
        test.each([
            ["an empty string", ""],
            ["whitespace only", "   "],
        ])("%s", (_label, url) => {
            expect(() => validateFetchUrl(url)).toThrow(/non-empty string/);
        });

        test.each([
            ["null", null],
            ["undefined", undefined],
            ["a number", 42],
            ["an object", {}],
        ])("%s", (_label, value) => {
            expect(() => validateFetchUrl(value)).toThrow(/non-empty string/);
        });
    });

    // Documents the boundary rather than asserting a protection that does not exist.
    describe("does NOT filter by host — scheme allowlist only", () => {
        test.each([
            ["loopback", "http://127.0.0.1:8080/x"],
            ["link-local metadata", "http://169.254.169.254/latest/meta-data/"],
            ["private range", "https://192.168.1.1/admin"],
        ])("%s passes", (_label, url) => {
            expect(() => validateFetchUrl(url)).not.toThrow();
        });
    });
});
