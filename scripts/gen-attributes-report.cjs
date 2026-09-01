/**
 * The profiles' attribute model, in ONE flat table — generated and gated.
 *
 * It answers a need that a standing decision explicitly refused to satisfy with
 * a file: Mattieu wanted "a single file to open, one line per field, to hand a
 * client". The model is good; its LOCATION was settled otherwise, for three hard
 * reasons — the A14 write guard becomes a pure schema rule when the block lives
 * in the layer, an orphan line is structurally impossible there, and
 * `check-config-coverage` already derives its layer family from the layer
 * schema.
 *
 * 🛑 **Flat-table readability is a READING need, not a storage one.** A derived
 * view cannot diverge from its source; a competing file can. That is the whole
 * difference between this report and the discarded global `attributes.json` —
 * and why this script carries a `--check` wired into `ci:local`: regenerated,
 * the report is true by construction; forgotten, it reddens.
 *
 * Same regime as `generate-docs-tree.cjs` and `gen-profile-schema-reference.cjs`.
 *
 * Usage :
 *   node scripts/gen-attributes-report.cjs            → writes the report
 *   node scripts/gen-attributes-report.cjs --check    → fails if it drifted
 */

const fs = require("node:fs");
const path = require("node:path");

const docsPaths = require("./lib/docs-paths.cjs");

const ROOT = path.resolve(__dirname, "..");
const OUT = docsPaths.reference("MODELE_ATTRIBUTAIRE.md");
const OUT_REL = docsPaths.rel(OUT);
const SURFACES = ["tooltip", "popup", "sidepanel"];

/**
 * Collects the profiles' layer configs.
 *
 * @returns {string[]} Absolute paths of the `*_config.json`.
 */
function layerConfigs() {
    const out = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith("_config.json")) out.push(full);
        }
    })(path.join(ROOT, "profiles"));
    return out.sort();
}

/**
 * The profile a config belongs to, deduced from its path.
 *
 * @param {string} file - Absolute path of the config.
 * @returns {string} Profile identifier.
 */
function profileOf(file) {
    return path.relative(path.join(ROOT, "profiles"), file).split(path.sep)[0];
}

/** Escapes a pipe, which would cut the markdown table cell in two. */
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|");

/** Renders the surfaces as three aligned markers, readable diagonally. */
function surfaceMarks(surfaces) {
    return SURFACES.map((s) => (surfaces?.includes(s) ? s[0].toUpperCase() : "·")).join(" ");
}

/** Renders the presentation modifiers as a compact list. */
function presentationMarks(presentation) {
    if (!presentation) return "—";
    const on = [];
    if (presentation.emphasis) on.push(presentation.emphasis);
    if (presentation.hero) on.push("hero");
    if (presentation.accordion) on.push(presentation.defaultOpen ? "accordéon+" : "accordéon");
    return on.length ? on.join(", ") : "—";
}

function build() {
    const rows = [];
    const perProfile = new Map();
    let layersWithBlock = 0;
    let layersWithout = 0;

    for (const file of layerConfigs()) {
        const json = JSON.parse(fs.readFileSync(file, "utf8"));
        const layer = path.basename(file, "_config.json");
        const profile = profileOf(file);

        if (!json.attributes) {
            layersWithout++;
            // ⚠️ A layer still on the legacy block is flagged, not silenced: it is
            // the migration counter, and it must be readable here.
            if (json.capabilities?.["feature-info"]) {
                rows.push({
                    profile,
                    layer,
                    field: "⚠️ NON MIGRÉE",
                    label: "—",
                    primitive: "—",
                    widget: "—",
                    surfaces: "· · ·",
                    mode: "—",
                    presentation: "—",
                    edit: "—",
                });
            }
            continue;
        }

        layersWithBlock++;
        perProfile.set(profile, (perProfile.get(profile) ?? 0) + 1);
        const titleField = json.attributes.titleField;

        for (const f of json.attributes.fields) {
            rows.push({
                profile,
                layer,
                field: f.field + (f.field === titleField ? " ★" : ""),
                label: f.label,
                primitive: f.primitive,
                widget: f.widget,
                surfaces: surfaceMarks(f.display?.surfaces),
                mode: f.display?.mode ?? (f.display ? "rendered" : "—"),
                presentation: presentationMarks(f.display?.presentation),
                edit: f.edit ? (f.edit.required ? "requis" : "oui") : "—",
            });
        }
    }

    const header = [
        "| Profil | Couche | Champ | Libellé | primitive | widget | I B P | mode | présentation | edit |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ];
    const body = rows.map(
        (r) =>
            `| ${cell(r.profile)} | ${cell(r.layer)} | \`${cell(r.field)}\` | ${cell(r.label)} | ` +
            `\`${cell(r.primitive)}\` | \`${cell(r.widget)}\` | \`${r.surfaces}\` | ${cell(r.mode)} | ` +
            `${cell(r.presentation)} | ${cell(r.edit)} |`
    );

    const notMigrated = rows.filter((r) => r.field === "⚠️ NON MIGRÉE").length;

    return `# Modèle attributaire des profils — vue dérivée

> 🛑 **GÉNÉRÉ — ne pas éditer à la main.** Régénérer par \`npm run gen:attributes-report\`.
> Gaté par \`gen:attributes-report:check\` dans \`npm run ci:local\` : une édition manuelle,
> ou un profil modifié sans régénération, fait rougir la CI.

C'est la **lisibilité en tableau plat** que la décision **Q1** a refusé de satisfaire par un
fichier de configuration global — un \`attributes.json\` par profil aurait pu pointer une couche
supprimée, et la garde d'écriture **A14** y serait redevenue un script maison au lieu d'une règle
de schéma pure. Le besoin de LECTURE est réel ; il se sert par une vue dérivée, qui ne peut pas
diverger de sa source.

## Comment lire ce tableau

- **\`I B P\`** — les trois surfaces de lecture : **I**nfobulle, **B**ulle, **P**anneau. Un \`·\`
  signifie que le champ n'y apparaît pas.
- **★** marque le champ désigné par \`attributes.titleField\` de sa couche.
- **\`primitive\`** dit ce que la valeur **EST** dans le GeoJSON ; **\`widget\`** dit comment on la
  montre. Le couple est contraint par une liste blanche que \`validate:profiles\` oppose au build.
- ⚠️ Une colonne **\`uses\`** a figuré ici du 02/08 au 06/08/2026 — bloc de liaisons vers les
  sous-systèmes secondaires, **retiré** parce qu'il ajoutait une 4ᵉ liste de noms de champs sans en
  remplacer aucune (décision **A3‴**).

## Décompte

| Mesure | Valeur |
| --- | --- |
| Couches portant un bloc \`attributes\` | ${layersWithBlock} |
| Champs déclarés | ${rows.length - notMigrated} |
| Couches **non migrées** (bloc legacy restant) | ${notMigrated} |
| Couches sans aucune déclaration de lecture | ${layersWithout - notMigrated} |

${
    notMigrated === 0
        ? "✅ **Aucune couche ne reste sur le bloc legacy.** Le compteur de migration de la tâche 2.10 est à zéro."
        : `⚠️ **${notMigrated} couche(s) restent sur le bloc legacy** — voir les lignes « NON MIGRÉE » ci-dessous.`
}

⚠️ Les couches sans aucune déclaration n'ont **rien à migrer** : elles n'entrent jamais dans le
chemin de rendu, et le retrait du mode \`"all"\` ne les touche donc pas.

## Le tableau

${header.concat(body).join("\n")}

---

_Généré par \`scripts/gen-attributes-report.cjs\`._
`;
}

const wanted = build();
const check = process.argv.includes("--check");

if (check) {
    const actual = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (actual !== wanted) {
        console.error(
            `\n❌ [ATTR-REPORT] \`${OUT_REL}\` a dérivé de\n` +
                "   ce que les profils déclarent.\n\n" +
                "   Régénérer : npm run gen:attributes-report\n"
        );
        process.exit(1);
    }
    console.log("✅ [ATTR-REPORT] modèle attributaire à jour.");
} else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, wanted);
    const lines = wanted.split("\n").length;
    console.log(`✅ [ATTR-REPORT] ${OUT_REL} — ${lines} lignes.`);
}
