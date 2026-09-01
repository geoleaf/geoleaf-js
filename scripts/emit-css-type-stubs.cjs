/*!
 * GeoLeaf Core — build tooling
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Emits a `<name>.css.d.ts` stub next to each CSS import present in the PUBLISHED
 * `.d.ts`.
 *
 * ## The defect this script closes
 *
 * `tsc` copies the source's `import "./css/x.css"` into the `.d.ts` it emits, and **no
 * `.d.ts` declares those modules**. An integrator compiling with
 * `skipLibCheck: false` thus gets one `TS2882` error per import — measured on
 * 2026-08-17: **23 across the monorepo**, and **3 on an `npm install` of
 * `@geoleaf-plugins/offline-ui` from npmjs, in a pristine directory**. 🛑 So this is
 * no workshop artifact: the defect is **in the published tarball**, and it reaches a
 * consumer who has nothing of this repo.
 *
 * ## Why a stub PER FILE, and not an ambient `declare module "*.css"`
 *
 * The ambient fits in one line, and it is the solution one finds first — it is also
 * the wrong one. A published `declare module "*.css"` **LEAKS to the integrator**: it
 * would silence *their* own CSS imports there, including those they would have wanted
 * to see fail. We would trade a defect visible at ours for a defect **invisible at
 * someone else's**.
 *
 * The relative stub, for its part, resolves **by path**: `import "./css/x.css"` finds
 * `./css/x.css.d.ts` laid next to it, and **nothing** is declared globally. No effect
 * outside the package.
 *
 * ## What a stub contains, and why it is empty
 *
 * These imports are **side effects** — they bring no value to the code. The stub thus
 * carries `export {};`: enough to make the file a module and satisfy resolution,
 * while promising nothing about the shape of what is imported. ⚠️ Do not put
 * `declare const _: string; export default _;` in it "just in case": that would allow
 * an `import css from "./x.css"` the build cannot honour.
 *
 * ## Idempotence
 *
 * The script rewrites the stubs at each pass and deletes none it did not write. It
 * runs **after** declaration emission, on `dist/types/` — never on `src/`.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const packages = require("./lib/packages.cjs");

/** Spots a side-effect CSS import in a `.d.ts`: `import "…/x.css";` */
const CSS_IMPORT_RE = /^\s*import\s+["']([^"']+\.css)["']\s*;?\s*$/gm;

const STUB_BODY =
    "// Généré par scripts/emit-css-type-stubs.cjs — ne pas éditer.\n" +
    "// Stub de résolution pour un import CSS d'effet de bord. Volontairement vide :\n" +
    "// l'import n'apporte aucune valeur, et déclarer un export par défaut autoriserait un\n" +
    '// `import css from "..."` que le build ne sait pas honorer.\n' +
    "export {};\n";

/**
 * The packages that emit NO declarations, by construction — hence the only ones
 * whose missing `dist/types/` is not the sign of an unfinished build.
 *
 * `@geoleaf/app` is the deployable application (`private`, neither `files[]` nor a
 * types build); `@geoleaf/build-config` is the shared build configuration (`.mjs`,
 * private, nothing to declare). ⚠️ `@geoleaf/host-runtime` is private TOO yet emits
 * its declarations: the boundary is not "private", it is "emits nothing". Do not
 * conflate the two.
 */
const SANS_DECLARATIONS = new Set(["@geoleaf/app", "@geoleaf/build-config"]);

/** Recursive list of a directory's `.d.ts` files. */
function declarationFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...declarationFiles(full));
        else if (entry.name.endsWith(".d.ts") && !entry.name.endsWith(".css.d.ts")) out.push(full);
    }
    return out;
}

function main() {
    let scanned = 0;
    let imports = 0;
    let written = 0;
    const perPackage = [];

    for (const pkg of packages.all()) {
        // ⚠️ `absDir`, NEVER `dir`. This script is launched from TWO different
        // working directories — the root (root build) and `packages/core/` (core
        // build, via turbo) — and `dir` is root-relative. Using it made the script
        // look for `packages/core/packages/core/dist/types`, hence scan ZERO files
        // from the core. 🛑 Without the anti-empty-gate assertion below, the script
        // would have come out GREEN having read nothing, and the stubs would never
        // have been written by the build that produces them.
        const dir = pkg.absDir;
        if (!dir) continue;
        const typesDir = path.join(dir, "dist", "types");
        const files = declarationFiles(typesDir);
        if (files.length === 0) continue;

        let pkgImports = 0;
        let pkgWritten = 0;

        for (const file of files) {
            scanned += 1;
            const text = fs.readFileSync(file, "utf8");
            for (const match of text.matchAll(CSS_IMPORT_RE)) {
                pkgImports += 1;
                // The specifier is relative TO THE IMPORTING FILE: that is where the stub goes.
                const target = path.resolve(path.dirname(file), match[1]) + ".d.ts";
                fs.mkdirSync(path.dirname(target), { recursive: true });
                const already =
                    fs.existsSync(target) && fs.readFileSync(target, "utf8") === STUB_BODY;
                if (!already) {
                    fs.writeFileSync(target, STUB_BODY);
                    pkgWritten += 1;
                }
            }
        }

        imports += pkgImports;
        written += pkgWritten;
        if (pkgImports > 0) perPackage.push(`${pkg.name}: ${pkgImports} import(s)`);
    }

    // 🛑 Anti-empty-gate — and the first wording was TOO WEAK, which cost a CI red
    // and, worse, incomplete published tarballs for a day.
    //
    // It tested `scanned === 0`: "no declaration read". Yet the script was called
    // from the CORE's build, which turbo runs BEFORE the plugins' (they depend on
    // it). At that instant the core's `dist/types/` exists and the plugins' do not:
    // `scanned` is several hundred, the assertion passes, and the 11 CSS imports of
    // the libs and 6 plugins NEVER get their stub. The script came out green having
    // covered only 21 imports out of 32 — exactly the false green it claimed to
    // forbid, one layer down.
    //
    // ⚠️ Measured on 2026-08-18, on a fresh clone: 8 `TS2882` in CI
    // (`typecheck:consumer`), invisible locally because a workshop `dist/` keeps the
    // stubs of an earlier root build. `ci:local` structurally CANNOT see this class.
    //
    // The right assertion thus bears on FLEET COMPLETENESS, not a total: every
    // registry package must have delivered its declarations, except those that emit
    // none by construction — the deployable app and the shared build config, which
    // have neither a types `files[]` nor a `tsconfig.declarations`. The list is
    // derived from the disk, never copied: a new package without declarations will go
    // red here, and that is intended — one will have to say why it has none.
    const attendus = packages.all().filter((pkg) => !SANS_DECLARATIONS.has(pkg.name));
    const manquants = attendus.filter(
        (pkg) => !fs.existsSync(path.join(pkg.absDir, "dist", "types"))
    );
    if (manquants.length > 0) {
        console.error(
            `❌ [CSS-STUBS] ${manquants.length} paquet(s) sans \`dist/types/\` — ce script a tourné\n` +
                `   AVANT la fin des builds, et ne peut couvrir que ce qui existe déjà :\n` +
                manquants.map((pkg) => `     • ${pkg.name}`).join("\n") +
                `\n\n   Il doit être lancé APRÈS \`npx turbo run build\` COMPLET, jamais depuis le build\n` +
                `   d'un paquet : turbo bâtit le core avant les plugins qui en dépendent, donc un\n` +
                `   appel depuis le core ne verra jamais les leurs. Sortir vert ici publierait des\n` +
                `   \`.d.ts\` dont les imports CSS ne résolvent pas — chez l'intégrateur, pas ici.`
        );
        process.exitCode = 1;
        return;
    }

    console.log(
        `✅ [CSS-STUBS] ${imports} import(s) CSS dans ${scanned} déclaration(s) — ` +
            `${written} stub(s) écrit(s), ${imports - written} déjà à jour.`
    );
    if (perPackage.length > 0) console.log(`   ${perPackage.join(" · ")}`);
}

main();
