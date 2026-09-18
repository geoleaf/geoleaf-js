/**
 * Witness — what leaves the application in a diagnostic carries no secret.
 *
 * The failure screen copies and downloads a diagnostic that a technician sends to support, by
 * mail or chat. Log lines carry URLs, headers and payloads: a tile key, a bearer token, a signed
 * query, a password field. `redactSecrets` is applied when entries are READ, so what is recorded
 * stays cheap and nothing that leaves is raw.
 *
 * ⚠️ The `t` cache token is KEPT on purpose: it names the deployment that answered, and it is not
 * a credential.
 */
import { describe, it, expect } from "vitest";

const { redactSecrets } = await import("../../src/utils/log/redact.ts");

describe("redactSecrets", () => {
    it("removes the credentials of a URL, and keeps its host", () => {
        const out = redactSecrets("GET https://alice:p4ssw0rd@tiles.example.test/a.png");
        expect(out).not.toContain("p4ssw0rd");
        expect(out).not.toContain("alice");
        expect(out).toContain("@tiles.example.test/a.png");
    });

    it("redacts secret query parameters, and keeps the `t` cache token", () => {
        const out = redactSecrets("GET https://tiles.example.test/0/0/0.png?key=ABC123&t=42");
        expect(out).not.toContain("ABC123");
        expect(out).toContain("key=[redacted]");
        expect(out).toContain("t=42");
    });

    it("redacts tokens carried in a fragment", () => {
        const out = redactSecrets("callback #access_token=s3cr3t&expires_in=3600");
        expect(out).not.toContain("s3cr3t");
        expect(out).toContain("expires_in=3600");
    });

    it("redacts Bearer and Basic credentials", () => {
        expect(redactSecrets("Authorization: Bearer abc.def-ghi_jkl")).not.toContain("abc.def");
        expect(redactSecrets("Authorization: Basic dXNlcjpwYXNz")).not.toContain("dXNlcjpwYXNz");
    });

    it("redacts a JWT wherever it appears", () => {
        const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";
        expect(redactSecrets(`token was ${jwt} then`)).not.toContain(jwt);
    });

    it("redacts sensitive keys in JSON, and leaves the other keys alone", () => {
        const out = redactSecrets('{"password":"hunter2","user":"bob","apiKey":"k-123"}');
        expect(out).not.toContain("hunter2");
        expect(out).not.toContain("k-123");
        expect(out).toContain('"user":"bob"');
    });

    it("redacts e-mail addresses", () => {
        expect(redactSecrets("sync failed for jane.doe@example.org")).not.toContain("jane.doe");
    });

    it("leaves a message without any secret untouched", () => {
        const text = "[GeoLeaf.Core] Map initialised at zoom 12 — profiles/demo/profile.json?t=0";
        expect(redactSecrets(text)).toBe(text);
    });
});
