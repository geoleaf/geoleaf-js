/*!
 * GeoLeaf Core — test helper: fully-wired Config singleton
 * © 2026 Mattieu Pottier — MIT License
 */

/**
 * Test-only replacement for the former `src/modules/geoleaf.config.ts` facade
 * (removed in Sprint 2 — it was dead in production and carried impure
 * self-registration, violating the "facade = API only" rule).
 *
 * It loads the bare `Config` singleton from `config-core` plus the three
 * side-effect siblings that graft the accessor / loader / validation methods
 * onto it, then mirrors the B4 namespace registration performed at runtime by
 * `globals.config.ts`. This lets tests obtain a fully-wired `GeoLeaf.Config`
 * (both as the named export and as `global.GeoLeaf.Config`) without booting the
 * full globals chain.
 *
 * Import order MUST match `globals.config.ts` (B4): core first, then the three
 * side-effect siblings.
 */

import { Config } from "../../src/kernel/config/geoleaf-config/config-core.js";
// Side-effect imports: mutate the Config singleton with additional methods.
import "../../src/kernel/config/geoleaf-config/config-loaders.js";
import "../../src/kernel/config/geoleaf-config/config-accessors.js";
import "../../src/kernel/config/geoleaf-config/config-validation.js";

// Mirror the runtime namespace registration (globals.config.ts, B4) so tests
// that read `global.GeoLeaf.Config` still see the wired singleton.
const _gl = (globalThis.GeoLeaf ??= {});
if (!_gl.Config) _gl.Config = Config;
Object.assign(_gl.Config, Config);

export { Config };
