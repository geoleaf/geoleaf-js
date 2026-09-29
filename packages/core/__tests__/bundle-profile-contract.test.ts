/**
 * @vitest-environment node
 *
 * The profile contract the package SHIPS: a profile validates against the schemas the tarball
 * carries, and types against the declarations it carries.
 *
 * ## Why this test exists
 *
 * The JSON Schemas of a profile lived in `profiles/schemas/` and in no tarball: an integrator
 * could not validate a profile with what npm gave them, and no type described the format of a
 * profile file. `scripts/emit-profile-schemas.cjs` now ships both under `dist/schemas/`. This
 * test judges the ARTEFACT — the file list `npm pack` would send — never the source tree:
 *
 *  1. the tarball carries exactly what `render()` produces from today's schemas — no more (a
 *     schema deleted at the source would otherwise survive in a stale `dist/`), no less, and
 *     byte for byte (a `dist/` restored from turbo's cache ships types of older schemas);
 *  2. the declarations are self-contained: a script that only validates profiles must not pull
 *     the global `GeoLeaf` namespace, nor `maplibre-gl`, into its program;
 *  3. the public entry exports the ten root types, and only them — the contract, pinned;
 *  4. each `@geoleaf/core/schemas/<name>.schema.json` resolves through the exports map, from a
 *     directory OUTSIDE the monorepo, as an integrator resolves it;
 *  5. every file of every profile of the repo validates against the SHIPPED schemas, with the
 *     options the documentation teaches — and a profile with an unknown key does not;
 *  6. every one of those files type-checks against the SHIPPED declarations (the upper-bound
 *     promise), under the repo's compiler settings and under a plain `strict` + `nodenext`
 *     program — and a typo is refused on each of the ten root types, and below the root in an
 *     attribute field, where a presence-only branch would reopen the object.
 *
 * Point 6 is the one a reading cannot replace: rendered raw, the generator typed
 * `styleCondition.value` (any value) as an object, and 262 diagnostics came out of the repo's
 * own profiles.
 *
 * Reads `dist/` — requires a prior build, hence `vitest.bundle.config.ts`.
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { Ajv } from "ajv";

const require = createRequire(import.meta.url);
const CORE_DIR = path.resolve(__dirname, "..");
const REPO = path.resolve(CORE_DIR, "../..");
const SHIPPED_PREFIX = "dist/schemas/";

const { packEntry } = require(path.join(REPO, "scripts/lib/npm-registry.cjs"));
const schemasLib = require(path.join(REPO, "scripts/lib/profile-schemas.cjs"));
const { render } = require(path.join(REPO, "scripts/emit-profile-schemas.cjs"));

/** The public surface of `@geoleaf/core/schemas`, pinned: a renamed `title` is a breaking change. */
const ROOT_TYPES: Record<string, string> = {
    basemaps: "GeoLeafBasemaps",
    features: "GeoLeafCoreFeatures",
    "geoleaf-config": "GeoLeafRootConfig",
    "layer-config": "GeoLeafLayerConfig",
    layers: "GeoLeafLayersIndex",
    mapping: "GeoLeafDataMapping",
    profile: "GeoLeafProfile",
    style: "GeoLeafLayerStyle",
    themes: "GeoLeafThemes",
    ui: "GeoLeafUIConfig",
};

/**
 * A minimal VALID literal per root type, and the key a typo adds to it. The pair matters: a
 * `@ts-expect-error` is satisfied by ANY error on its line, so the typo is only proven refused if
 * the same literal without it compiles. For `mapping`, any root key is a source id — the typo
 * goes inside a source block.
 */
const MINIMAL: Record<string, { ok: string; ko: string }> = {
    basemaps: { ok: `{ basemaps: {} }`, ko: `{ basemaps: {}, basemapz: {} }` },
    features: { ok: `{}`, ko: `{ mapOption: {} }` },
    "geoleaf-config": { ok: `{}`, ko: `{ debugg: true }` },
    "layer-config": { ok: `{ id: "x" }`, ko: `{ id: "x", labell: "x" }` },
    layers: { ok: `{}`, ko: `{ layerz: [] }` },
    mapping: {
        ok: `{ src: { mapping: { id: "id" } } }`,
        ko: `{ src: { mapping: { id: "id" }, mappin: {} } }`,
    },
    profile: { ok: `{ id: "x" }`, ko: `{ id: "x", lable: "x" }` },
    style: { ok: `{}`, ko: `{ stlye: {} }` },
    themes: { ok: `{}`, ko: `{ themez: [] }` },
    ui: { ok: `{}`, ko: `{ showLegnd: true }` },
};

/**
 * The same proof BELOW the root, where a presence-only branch lives: `attributeField` requires
 * `display` or `edit` through an `anyOf`, and names each key there for ajv's `strictRequired`.
 * Rendered with that marker, the branch has a shape and the generator reopens the field to any
 * key (header of `scripts/emit-profile-schemas.cjs`, point 2) — the root typos above stay
 * refused while this one goes through.
 */
const FIELD_KEYS = `field: "properties.nom", label: "Nom", primitive: "string", widget: "text", display: { surfaces: ["popup"] }`;
const NESTED: { schema: string; label: string; ok: string; ko: string }[] = [
    {
        schema: "layer-config",
        label: "attribute_field",
        ok: `{ id: "x", attributes: { fields: [{ ${FIELD_KEYS} }] } }`,
        ko: `{ id: "x", attributes: { fields: [{ ${FIELD_KEYS}, displai: {} }] } }`,
    },
];

/** Every profile file of the repo a schema judges, plus the root configuration. */
function corpus(): { abs: string; label: string; schema: string }[] {
    const out = [
        {
            abs: path.join(schemasLib.PROFILES_DIR, "geoleaf.config.json"),
            label: "profiles/geoleaf.config.json",
            schema: "geoleaf-config",
        },
    ];
    for (const dir of schemasLib.listDirs(schemasLib.PROFILES_DIR) as string[]) {
        if (dir === "schemas") continue;
        const profileDir = path.join(schemasLib.PROFILES_DIR, dir);
        for (const [rel, schema] of schemasLib.collectTargets(profileDir) as [string, string][]) {
            out.push({ abs: path.join(profileDir, rel), label: `profiles/${dir}/${rel}`, schema });
        }
    }
    return out;
}

let shipped: string[];
let expected: Map<string, Buffer | string>;
let integrator: string;

beforeAll(async () => {
    // `--ignore-scripts`: a pack must never rebuild what it is asked to list. A failed pack
    // throws here — a red, never a skip.
    const stdout = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
        cwd: CORE_DIR,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    const files: { path: string }[] = packEntry(JSON.parse(stdout)).files;
    shipped = files
        .map((f) => f.path)
        .filter((p) => p.startsWith(SHIPPED_PREFIX))
        .map((p) => p.slice(SHIPPED_PREFIX.length))
        .sort();
    expected = await render();

    // An integrator's project: its own directory, `@geoleaf/core` in its node_modules.
    integrator = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-profile-contract-"));
    fs.mkdirSync(path.join(integrator, "node_modules", "@geoleaf"), { recursive: true });
    fs.symlinkSync(CORE_DIR, path.join(integrator, "node_modules", "@geoleaf", "core"), "dir");
    fs.writeFileSync(path.join(integrator, "package.json"), '{ "type": "module" }\n');
}, 120_000);

afterAll(() => {
    if (integrator) fs.rmSync(integrator, { recursive: true, force: true });
});

const shippedPath = (rel: string) => path.join(CORE_DIR, SHIPPED_PREFIX, rel);

/**
 * Resolves `@geoleaf/core/schemas/<name>.schema.json` from the integrator's project.
 *
 * ⚠️ Node's resolution error is wrapped in a plain `Error` (kept as its `cause`), and that is
 * not cosmetic: thrown as is, it trips vitest's stack parser (`SyntaxError` in
 * `convert-source-map`), and the test then counts as NEITHER passed nor failed — measured on the
 * red run, where three tests vanished from the tally while the file still exited 1. Wrapped, the
 * same failure is counted and named.
 */
function resolveShipped(name: string): string {
    const spec = `@geoleaf/core/schemas/${name}.schema.json`;
    try {
        return createRequire(path.join(integrator, "package.json")).resolve(spec);
    } catch (err) {
        const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
        throw new Error(`${spec} ne résout pas depuis un projet intégrateur — ${reason}`, {
            cause: err,
        });
    }
}

describe("contrat de profil livré — ce que le tarball emporte", () => {
    test("dist/schemas/ du tarball = ce que render() produit des schémas d'aujourd'hui", () => {
        expect(shipped, "le tarball n'emporte aucun fichier de dist/schemas/").not.toHaveLength(0);
        expect(shipped).toEqual([...expected.keys()].sort());
    });

    test("chaque schéma livré est le fichier source, octet pour octet", () => {
        const names: string[] = schemasLib.listSchemaNames();
        for (const name of names) {
            const file = `${name}${schemasLib.SCHEMA_SUFFIX}`;
            expect(shipped, `${file} absent du tarball`).toContain(file);
            const source = fs.readFileSync(path.join(schemasLib.SCHEMAS_DIR, file));
            expect(
                fs.readFileSync(shippedPath(file)).equals(source),
                `${file} diverge de la source`
            ).toBe(true);
        }
    });

    test("chaque déclaration livrée est celle que les schémas d'aujourd'hui produisent", () => {
        for (const [rel, content] of expected) {
            if (!rel.endsWith(".d.ts")) continue;
            expect(fs.readFileSync(shippedPath(rel), "utf8"), `${rel} est périmé`).toBe(content);
        }
    });

    test("les déclarations livrées sont autonomes — aucune référence, aucun import hors de dist/schemas/", () => {
        const declarations = shipped.filter((f) => f.endsWith(".d.ts"));
        // Floor: over zero declarations, the loop below would pass having read nothing.
        expect(declarations, "aucune déclaration livrée").toContain("index.d.ts");
        for (const rel of declarations) {
            const text = fs.readFileSync(shippedPath(rel), "utf8");
            expect(text, `${rel} tire une référence ambiante`).not.toMatch(/\/\/\/\s*<reference/);
            for (const m of text.matchAll(
                /\bfrom\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g
            )) {
                const spec = m[1] ?? m[2];
                expect(spec, `${rel} importe « ${spec} »`).toMatch(/^\.\//);
            }
        }
    });

    test("l'entrée publique exporte les dix types racines, et eux seuls", () => {
        const index = fs.readFileSync(shippedPath("index.d.ts"), "utf8");
        const exported = [
            ...index.matchAll(/^export type \{ (\w+) \} from "\.\/types\/([\w-]+)\.js";$/gm),
        ].map((m) => [m[2], m[1]]);
        expect(Object.fromEntries(exported)).toEqual(ROOT_TYPES);
        expect(index.match(/^export /gm)).toHaveLength(Object.keys(ROOT_TYPES).length);
    });

    test("chaque schéma résout par la carte exports, depuis un projet hors du monorepo", () => {
        for (const name of Object.keys(ROOT_TYPES)) {
            const resolved = resolveShipped(name);
            expect(fs.realpathSync(resolved)).toBe(
                fs.realpathSync(shippedPath(`${name}.schema.json`))
            );
        }
    });
});

describe("contrat de profil livré — un profil validé contre ce que le paquet livre", () => {
    /** The recipe the documentation teaches — keep the two identical. */
    function shippedValidators() {
        const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
        const validators: Record<string, ReturnType<Ajv["compile"]>> = {};
        for (const name of Object.keys(ROOT_TYPES)) {
            validators[name] = ajv.compile(
                JSON.parse(fs.readFileSync(resolveShipped(name), "utf8"))
            );
        }
        return validators;
    }

    test("chaque fichier de chaque profil du dépôt se valide contre les schémas livrés", () => {
        const validators = shippedValidators();
        const judged = new Map<string, number>();
        const failures: string[] = [];
        const files = corpus();
        for (const { abs, label, schema } of files) {
            judged.set(schema, (judged.get(schema) ?? 0) + 1);
            const validate = validators[schema];
            if (!validate) throw new Error(`${label} : aucun schéma livré nommé « ${schema} »`);
            if (!validate(JSON.parse(fs.readFileSync(abs, "utf8")))) {
                for (const e of validate.errors ?? [])
                    failures.push(`${label} ${e.instancePath || "(racine)"} ${e.message}`);
            }
        }
        expect(failures).toEqual([]);
        // The criterion names a shipped profile; the rest of the corpus widens it.
        expect(files.some((f) => f.label.startsWith("profiles/tourism/"))).toBe(true);
        // A shipped schema that judges nothing is an orphan: the illusion of a contract.
        for (const name of Object.keys(ROOT_TYPES)) {
            expect(
                judged.get(name) ?? 0,
                `${name}.schema.json n'a jugé aucun fichier`
            ).toBeGreaterThan(0);
        }
    });

    test("le validateur livré mord : une clé inconnue à la racine d'un profil est refusée", () => {
        const validate = shippedValidators().profile;
        if (!validate) throw new Error("aucun schéma livré nommé « profile »");
        const profile = JSON.parse(
            fs.readFileSync(path.join(schemasLib.PROFILES_DIR, "tourism", "profile.json"), "utf8")
        );
        expect(validate(profile)).toBe(true);
        expect(validate({ ...profile, notAProfileKey: true })).toBe(false);
        expect(validate.errors?.map((e) => e.keyword)).toContain("additionalProperties");
    });
});

describe("contrat de profil livré — un profil typé par les déclarations que le paquet livre", () => {
    const CONFIGS: Record<string, ts.CompilerOptions> = {
        // The repo's settings, as `examples/consumer` compiles.
        repo: {
            strict: true,
            exactOptionalPropertyTypes: true,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            target: ts.ScriptTarget.ES2022,
            skipLibCheck: false,
            noEmit: true,
        },
        // A plain integrator's settings: without `exactOptionalPropertyTypes`, an optional
        // property beside an index signature is where TS2411 lives.
        nodenext: {
            strict: true,
            module: ts.ModuleKind.NodeNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            target: ts.ScriptTarget.ES2022,
            skipLibCheck: false,
            noEmit: true,
        },
    };

    function writeProgram(): string {
        const names = Object.values(ROOT_TYPES);
        const lines = [`import type { ${names.join(", ")} } from "@geoleaf/core/schemas";`];
        corpus().forEach(({ abs, label, schema }, i) => {
            lines.push(
                `// ${label}`,
                `export const file${i}: ${ROOT_TYPES[schema]} = ${fs.readFileSync(abs, "utf8")};`
            );
        });
        for (const [schema, { ok, ko }] of Object.entries(MINIMAL)) {
            const T = ROOT_TYPES[schema];
            const id = schema.replace(/-/g, "_");
            lines.push(`export const ok_${id}: ${T} = ${ok};`);
            lines.push(`// @ts-expect-error — a typo must be refused by ${T}`);
            lines.push(`export const ko_${id}: ${T} = ${ko};`);
        }
        for (const { schema, label, ok, ko } of NESTED) {
            const T = ROOT_TYPES[schema];
            lines.push(`export const ok_${label}: ${T} = ${ok};`);
            lines.push(`// @ts-expect-error — a typo below the root must be refused by ${T}`);
            lines.push(`export const ko_${label}: ${T} = ${ko};`);
        }
        const file = path.join(integrator, "corpus.ts");
        fs.writeFileSync(file, lines.join("\n") + "\n");
        return file;
    }

    for (const [name, options] of Object.entries(CONFIGS)) {
        test(`tout fichier que les schémas acceptent se type, et une faute de frappe est refusée (${name})`, () => {
            const program = ts.createProgram([writeProgram()], options);
            const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => {
                const where =
                    d.file && d.start !== undefined
                        ? d.file.getLineAndCharacterOfPosition(d.start)
                        : null;
                return `${d.file ? path.basename(d.file.fileName) : "?"}:${where ? where.line + 1 : "?"} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
            });
            expect(diagnostics).toEqual([]);
        }, 60_000);
    }
});
