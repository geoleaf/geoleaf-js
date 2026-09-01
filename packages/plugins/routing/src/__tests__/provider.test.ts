/**
 * @geoleaf-plugins/routing — provider contract and endpoint policy
 *
 * The seam every routing engine plugs into. What is pinned here is not the plumbing but the two
 * refusals: a non-HTTPS endpoint, and a provider the caller did not choose.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@geoleaf/host-runtime", () => ({
    coreConfigGet: () => ({}),
    // `provider.ts` warns before refusing a provider without a legal notice.
    Log: { warn: () => {}, error: () => {}, info: () => {} },
}));

const { createProvider, resolveEndpoint, registerProvider, registeredProviders } =
    await import("../provider.js");

/** A minimal configuration, since only two of its keys matter here. */
function cfg(over: Record<string, unknown> = {}) {
    return {
        enabled: true,
        showButton: false,
        provider: "valhalla",
        endpoint: "",
        ...over,
    } as never;
}

const stub = (id: string) => (endpoint: string) => ({
    id,
    // 🛑 Required: `createProvider` REFUSES a provider without a legal notice.
    // This double declares one because a real one must — a double more
    // permissive than the contract exercises code nobody will ever run.
    attribution: "© Test contributors",
    route: async () => ({ ok: false, reason: "no-route" }) as const,
    endpoint,
});

// ⚠️ The double WITHOUT a legal notice lives in `attribution.test.ts`, with
// the guards it exercises. Keeping it here too would make two definitions of
// one case, only one of which would be maintained.

beforeEach(() => {
    for (const id of registeredProviders()) registerProvider(id, stub(id));
});

describe("resolveEndpoint — the HTTPS refusal", () => {
    it("accepts an explicit https:// endpoint", () => {
        expect(resolveEndpoint(cfg({ endpoint: "https://routing.example.org" }))).toBe(
            "https://routing.example.org"
        );
    });

    it("REFUSES http://, and does not quietly fall back to the default", () => {
        // 🛑 The fallback is the dangerous part, not the acceptance. Answering the provider's
        // default endpoint here would produce a route that works, so nobody would ever discover
        // that the endpoint they configured was ignored — and a routing request carries where
        // someone is and where they are going.
        expect(resolveEndpoint(cfg({ endpoint: "http://routing.example.org" }))).toBeNull();
    });

    it("refuses anything else that is not https — including a bare host", () => {
        for (const bad of ["routing.example.org", "ftp://x", "//x", "javascript:alert(1)"]) {
            expect(resolveEndpoint(cfg({ endpoint: bad }))).toBeNull();
        }
    });

    it("uses the provider's default endpoint when none is configured", () => {
        expect(resolveEndpoint(cfg({ provider: "valhalla" }))).toMatch(/^https:\/\//);
        expect(resolveEndpoint(cfg({ provider: "osrm" }))).toMatch(/^https:\/\//);
    });

    it("has no default for an unknown provider", () => {
        expect(resolveEndpoint(cfg({ provider: "not-an-engine" }))).toBeNull();
    });
});

describe("createProvider", () => {
    it("answers null while no adapter is registered", () => {
        // The registry is empty at this stage, and that is a fact to read rather than a
        // placeholder: a factory that answered a fabricated provider would make every
        // assertion around it pass against nothing.
        expect(createProvider(cfg())).toBeNull();
    });

    it("answers the registered adapter, bound to the resolved endpoint", () => {
        registerProvider("valhalla", stub("valhalla"));
        const p = createProvider(cfg()) as { id: string; endpoint: string } | null;
        expect(p?.id).toBe("valhalla");
        expect(p?.endpoint).toMatch(/^https:\/\//);
    });

    it("answers null on a refused endpoint EVEN when the adapter exists", () => {
        registerProvider("valhalla", stub("valhalla"));
        expect(createProvider(cfg({ endpoint: "http://insecure.example.org" }))).toBeNull();
    });

    it("does NOT substitute another engine for an unknown one", () => {
        // ⚠️ This is where the decalque from `geocoding` deliberately stops. That plugin falls
        // back to its default provider, which is right for a search box: a wrong result is
        // visibly wrong and the user retypes. Routing someone through an engine they did not
        // choose, because the one they chose was misconfigured, is a silent substitution on a
        // decision that belongs to them.
        registerProvider("valhalla", stub("valhalla"));
        expect(createProvider(cfg({ provider: "not-an-engine" }))).toBeNull();
    });

    it("lets a registration under an existing id replace it", () => {
        registerProvider("osrm", stub("osrm"));
        registerProvider("osrm", () => ({
            id: "osrm-custom",
            // Required: `createProvider` REFUSES a provider without a notice.
            attribution: "© Test contributors",
            route: async () => ({ ok: false, reason: "no-route" }) as const,
        }));
        const p = createProvider(cfg({ provider: "osrm" }));
        expect(p?.id).toBe("osrm-custom");
    });
});
