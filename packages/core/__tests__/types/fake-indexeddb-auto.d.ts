/**
 * `fake-indexeddb/auto` — a side-effect module whose types the resolver cannot reach.
 *
 * 🛑 THE TYPES EXIST AND ARE UNREACHABLE, WHICH IS NOT THE SAME AS ABSENT.
 * `node_modules/fake-indexeddb/auto.d.ts` is right there; the package's `exports` map does
 * not point at it, so `moduleResolution: bundler` refuses to resolve it and every suite that
 * installs the fake database earns a `TS7016`. One such error is FROZEN in
 * `scripts/.baselines/test-ts-dormant.json` (`routes-store.test.ts:TS7016`), and every new
 * IndexedDB suite would add one more — a baseline that can only shrink, growing.
 *
 * This declaration is the fix rather than a suppression: the module has no API worth typing
 * (importing it installs `indexedDB` on `globalThis` and returns nothing), so declaring it
 * empty says exactly what is true. ⚠️ It is NOT `declare module "fake-indexeddb"` — the root
 * entry point ships real types and must keep them.
 */
declare module "fake-indexeddb/auto";
