import { describe, it, expect } from "vitest";
import { resolveProfileUrl } from "../url-resolver.js";

describe("resolveProfileUrl", () => {
    const BASE = "./profiles";
    const PID = "france-rail";

    it("leaves http(s) URLs untouched", () => {
        expect(resolveProfileUrl("https://proxy.example/feed", PID, BASE)).toBe(
            "https://proxy.example/feed"
        );
        expect(resolveProfileUrl("http://x/y", PID, BASE)).toBe("http://x/y");
    });

    it("leaves protocol-relative and data/blob URIs untouched", () => {
        expect(resolveProfileUrl("//cdn/x.pb", PID, BASE)).toBe("//cdn/x.pb");
        expect(resolveProfileUrl("data:application/octet-stream;base64,AAAA", PID, BASE)).toBe(
            "data:application/octet-stream;base64,AAAA"
        );
        expect(resolveProfileUrl("blob:abc-123", PID, BASE)).toBe("blob:abc-123");
    });

    it("leaves root-absolute paths untouched", () => {
        expect(resolveProfileUrl("/data/x.pb", PID, BASE)).toBe("/data/x.pb");
    });

    it("resolves a profile-relative path against the profile root", () => {
        expect(resolveProfileUrl("data/gares_snapshot.pb", PID, BASE)).toBe(
            "./profiles/france-rail/data/gares_snapshot.pb"
        );
    });

    it("strips leading ./ and ../ segments (profile-root relative)", () => {
        expect(resolveProfileUrl("./data/x.pb", PID, BASE)).toBe(
            "./profiles/france-rail/data/x.pb"
        );
        expect(resolveProfileUrl("../data/x.pb", PID, BASE)).toBe(
            "./profiles/france-rail/data/x.pb"
        );
        expect(resolveProfileUrl("../../data/x.pb", PID, BASE)).toBe(
            "./profiles/france-rail/data/x.pb"
        );
    });

    it("defaults the base path to 'profiles' when empty", () => {
        expect(resolveProfileUrl("data/x.pb", PID, "")).toBe("profiles/france-rail/data/x.pb");
    });

    it("trims a trailing slash on the base path", () => {
        expect(resolveProfileUrl("data/x.pb", PID, "./profiles/")).toBe(
            "./profiles/france-rail/data/x.pb"
        );
    });

    it("treats a relative path whose colon follows a slash as relative", () => {
        // A ":" after a "/" is not a scheme — resolve, don't pass through.
        expect(resolveProfileUrl("data/a:b.pb", PID, BASE)).toBe(
            "./profiles/france-rail/data/a:b.pb"
        );
    });

    it("returns the input unchanged when the profile id is unknown", () => {
        expect(resolveProfileUrl("data/x.pb", undefined, BASE)).toBe("data/x.pb");
    });

    it("returns falsy input unchanged", () => {
        expect(resolveProfileUrl("", PID, BASE)).toBe("");
    });
});
