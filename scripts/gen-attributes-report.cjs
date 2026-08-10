/**
 * Le modèle attributaire des profils, en UN tableau plat — généré et gaté.
 *
 * Tâche **2.9** de `roadmap_collecte-terrain-offline`. C'est la réponse à un besoin
 * que la décision **Q1** a explicitement refusé de satisfaire par un fichier :
 * Mattieu voulait « un seul fichier à ouvrir, une ligne par champ, à remettre à un
 * client ». Le modèle est bon ; sa LOCALISATION a été tranchée autrement, pour trois
 * raisons dures — la garde d'écriture A14 devient une règle de schéma pure quand le
 * bloc vit dans la couche, une ligne orpheline y est structurellement impossible, et
 * `check-config-coverage` dérive déjà sa famille B5 du schéma de couche.
 *
 * 🛑 **La lisibilité en tableau plat est un besoin de LECTURE, pas de stockage.** Une
 * vue dérivée ne peut pas diverger de sa source ; un fichier concurrent, si. C'est
 * toute la différence entre ce rapport et le `attributes.json` global écarté par Q1 —
 * et c'est pourquoi ce script porte un `--check` câblé dans `ci:local` : régénéré, le
 * rapport est vrai par construction ; oublié, il rougit.
 *
 * Même régime que `generate-docs-tree.cjs` et `gen-profile-schema-reference.cjs`.
 *
 * Usage :
 *   node scripts/gen-attributes-report.cjs            → écrit le rapport
 *   node scripts/gen-attributes-report.cjs --check    → échoue s'il a dérivé
 */

const fs = require("node:fs");
const path = require("node:path");

const docsPaths = require("./lib/docs-paths.cjs");

const ROOT = path.resolve(__dirname, "..");
const OUT = docsPaths.reference("MODELE_ATTRIBUTAIRE.md");
const OUT_REL = docsPaths.rel(OUT);
const SURFACES = ["tooltip", "popup", "sidepanel"];

/**
 * Collecte les configs de couche des profils.
 *
 * @returns {string[]} Chemins absolus des `*_config.json`.
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
 * Le profil auquel appartient une config, déduit de son chemin.
 *
 * @param {string} file - Chemin absolu de la config.
 * @returns {string} Identifiant du profil.
 */
function profileOf(file) {
    return path.relative(path.join(ROOT, "profiles"), file).split(path.sep)[0];
}

/** Échappe un tube, qui couperait la cellule du tableau markdown en deux. */
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|");

/** Rend les surfaces sous forme de trois marqueurs alignés, lisibles en diagonale. */
function surfaceMarks(surfaces) {
    return SURFACES.map((s) => (surfaces?.includes(s) ? s[0].toUpperCase() : "·")).join(" ");
}

/** Rend les modificateurs de présentation en liste compacte. */
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
            // ⚠️ Une couche encore sur le bloc legacy est signalée, pas tue : c'est le
            // compteur de migration de la tâche 2.10, et il doit se lire ici.
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
    console.log(
        `✅ [ATTR-REPORT] ${OUT_REL} — ${lines} lignes.`
    );
}
