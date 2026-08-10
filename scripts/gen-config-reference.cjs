#!/usr/bin/env node
/*!
 * GeoLeaf — Générateur du tableau HTML de référence des paramètres de config
 * © 2026 Mattieu Pottier — MIT
 *
 * Config-contract roadmap, sprint S16 (Phase D). Source UNIQUE de vérité =
 * docs/reference/inventaire_config_parametres.md (familles B1→B7,
 * code-sourcées en Phase B, testées en Phase C). Ce script parse ses tables
 * Markdown et émet un tableau HTML autonome (aucune dépendance externe),
 * filtrable par famille / fichier / statut + recherche plein-texte.
 *
 * ## Modes
 *
 *   node scripts/gen-config-reference.cjs           # écrit le HTML
 *   node scripts/gen-config-reference.cjs --check   # exit 1 si l'artefact commité est périmé
 *
 * Le parseur mappe les colonnes PAR MOT-CLÉ de l'en-tête (Fichier/Clé/Type/
 * Valeurs/Défaut/Consommateur/Statut/Effet/Testé) → robuste aux variations de
 * libellé entre sections. Les pipes littéraux échappés `\|` sont préservés.
 *
 * ## Pourquoi `--check` existe (refonte documentaire V3, §2.3bis)
 *
 * La chaîne `profiles/schemas/*.json` → inventaire → HTML n'était gatée qu'à MOITIÉ : le
 * premier maillon a `check-config-coverage.cjs`, bidirectionnel et bloquant ; le second
 * n'avait rien. Un inventaire modifié sans régénération laissait un HTML périmé, commité,
 * et **muet** — le régime documentaire qui a échoué partout ailleurs dans ce dépôt.
 *
 * ⚠️ **Le préalable a été de rendre la sortie DÉTERMINISTE.** Elle embarquait `new Date()` :
 * un artefact qui contient « maintenant » n'est comparable à rien, et une gate de fraîcheur
 * bâtie dessus rougirait chaque matin sans raison — donc serait désarmée en une semaine.
 * La date et la version sont désormais lues DANS le bandeau de l'inventaire
 * (`readSourceStamp`), ce qui fait de la sortie une fonction pure de son entrée. C'est la
 * condition d'existence de `docs:tree:check`, prise ici au même endroit.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const docsPaths = require("./lib/docs-paths.cjs");

const ROOT = path.resolve(__dirname, "..");
const SRC = docsPaths.reference("inventaire_config_parametres.md");
const OUT = docsPaths.reference("reference_parametres_config.html");
const SRC_REL = path.relative(ROOT, SRC);
const CHECK = process.argv.includes("--check");

// ─── Grille de statuts (figée S0, cf. §Grille de statuts de l'inventaire) ─────
const STATUS_DEFS = [
    { sym: "✅", key: "used", label: "utilisé" },
    { sym: "🟡", key: "partial", label: "partiel" },
    { sym: "⚪", key: "orphan", label: "orphelin (schéma-only)" },
    { sym: "🟥", key: "dead", label: "consommateur-mort" },
    { sym: "🔁", key: "alias", label: "alias/duplicata" },
    { sym: "🕯", key: "legacy", label: "légacy-déprécié" }, // base codepoint (sans VS16)
    { sym: "❌", key: "broken", label: "cassé (no-mapping)" },
    { sym: "🔗", key: "ref", label: "renvoi (autre famille)" },
];

/** First canonical status symbol appearing in the cell (earliest index wins). */
function detectStatus(cell) {
    let best = null;
    let bestIdx = Infinity;
    for (const d of STATUS_DEFS) {
        const i = cell.indexOf(d.sym);
        if (i >= 0 && i < bestIdx) {
            bestIdx = i;
            best = d;
        }
    }
    return best || { sym: "", key: "unknown", label: "—" };
}

/** Map a header cell's text to a canonical column id by keyword. */
function columnIdOf(header) {
    const h = header.toLowerCase();
    if (h.includes("fichier")) return "fichier";
    if (h.includes("clé") || h.includes("cle")) return "cle";
    if (h.includes("type")) return "type";
    if (h.includes("valeur")) return "valeurs";
    if (h.includes("défaut") || h.includes("defaut")) return "defaut";
    if (h.includes("consommateur")) return "consommateur";
    if (h.includes("statut")) return "statut";
    if (h.includes("effet")) return "effet";
    if (h.includes("testé") || h.includes("teste")) return "teste";
    return null;
}

/** Split a Markdown table row on UNescaped pipes; trim the outer empties. */
function splitRow(line) {
    const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
    // A well-formed row starts and ends with `|` → first/last are empty.
    if (cells.length && cells[0] === "") cells.shift();
    if (cells.length && cells[cells.length - 1] === "") cells.pop();
    return cells.map((c) => c.replace(/\\\|/g, "|"));
}

function isSeparatorRow(line) {
    return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

// ─── Parse the inventory Markdown → flat records ──────────────────────────────
function parseInventory(md) {
    const lines = md.split(/\r?\n/);
    const records = [];
    let family = null; // { code: "B1", label: "..." }
    let fileGroup = null; // last `### ` heading text
    let cols = null; // column-id → index for the current table

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const mFam = line.match(/^##\s+(B\d)\s+—\s+(.*)$/);
        if (mFam) {
            family = { code: mFam[1], label: mFam[2].trim() };
            fileGroup = null;
            cols = null;
            continue;
        }
        const mSub = line.match(/^###\s+(.*)$/);
        if (mSub) {
            fileGroup = mSub[1].trim();
            cols = null;
            continue;
        }

        // Table header row: starts the param table only when it carries "Fichier".
        if (/^\s*\|/.test(line) && /\bFichier\b/i.test(line) && !cols) {
            const headers = splitRow(line);
            const next = lines[i + 1] || "";
            if (!isSeparatorRow(next)) continue; // not a real table header
            const map = {};
            headers.forEach((h, idx) => {
                const id = columnIdOf(h);
                if (id && !(id in map)) map[id] = idx;
            });
            if ("cle" in map && family) {
                cols = map;
                i++; // skip the separator row
            }
            continue;
        }

        // Data row of the current table.
        if (cols && /^\s*\|/.test(line)) {
            if (isSeparatorRow(line)) continue;
            const c = splitRow(line);
            const get = (id) => (id in cols && cols[id] < c.length ? c[cols[id]] : "");
            const cle = get("cle");
            if (!cle) continue; // skip stray rows
            const statutRaw = get("statut");
            records.push({
                family: family.code,
                familyLabel: family.label,
                fileGroup: fileGroup || family.label,
                fichier: get("fichier"),
                cle,
                type: get("type"),
                valeurs: get("valeurs"),
                defaut: get("defaut"),
                consommateur: get("consommateur"),
                statutRaw,
                status: detectStatus(statutRaw),
                effet: get("effet"),
                teste: get("teste"),
            });
            continue;
        }

        // Any non-table line closes the current table.
        if (cols && !/^\s*\|/.test(line)) cols = null;
    }
    return records;
}

// ─── Minimal, safe Markdown → HTML for cell content ───────────────────────────
function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function mdCell(s) {
    let out = esc(s);
    // inline code `…`
    out = out.replace(/`([^`]+)`/g, (_m, x) => `<code>${x}</code>`);
    // bold **…**
    out = out.replace(/\*\*([^*]+)\*\*/g, (_m, x) => `<strong>${x}</strong>`);
    // links [t](u)
    out = out.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_m, t, u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${t}</a>`
    );
    return out;
}

// ─── HTML emission ────────────────────────────────────────────────────────────
function buildHtml(records, meta) {
    const byFamily = {};
    const byStatus = {};
    const fichiers = new Set();
    for (const r of records) {
        byFamily[r.family] = (byFamily[r.family] || 0) + 1;
        byStatus[r.status.key] = (byStatus[r.status.key] || 0) + 1;
        if (r.fichier) fichiers.add(r.fichier);
    }
    const families = Object.keys(byFamily).sort();
    const fichierOptions = [...fichiers].sort();

    // `.replace(/</g, "\\u003c")` keeps a stray "</script>" in any cell from
    // closing the inline <script> that embeds this payload.
    const rowsJson = JSON.stringify(
        records.map((r) => ({
            fam: r.family,
            famLabel: r.familyLabel,
            grp: r.fileGroup,
            fichier: r.fichier,
            cle: mdCell(r.cle),
            type: mdCell(r.type),
            valeurs: mdCell(r.valeurs),
            defaut: mdCell(r.defaut),
            statusKey: r.status.key,
            statusSym: r.status.sym,
            statusLabel: r.status.label,
            effet: mdCell(r.effet),
            conso: mdCell(r.consommateur),
            teste: esc(r.teste),
            s: [r.fichier, r.cle, r.type, r.valeurs, r.defaut, r.effet, r.consommateur]
                .join(" · ")
                .toLowerCase(),
        }))
    ).replace(/</g, "\\u003c");

    const statusLegend = STATUS_DEFS.map(
        (d) =>
            `<span class="badge st-${d.key}" title="${esc(d.label)}">${d.sym} ${esc(d.label)}${
                byStatus[d.key] ? ` (${byStatus[d.key]})` : ""
            }</span>`
    ).join("");

    const familyButtons = ['<button class="fbtn active" data-fam="">Toutes</button>']
        .concat(
            families.map(
                (f) => `<button class="fbtn" data-fam="${f}">${f} (${byFamily[f]})</button>`
            )
        )
        .join("");

    const statusOptions = ['<option value="">Tous les statuts</option>']
        .concat(
            STATUS_DEFS.map((d) => `<option value="${d.key}">${d.sym} ${esc(d.label)}</option>`)
        )
        .join("");

    const fichierSelect = ['<option value="">Tous les fichiers</option>']
        .concat(fichierOptions.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`))
        .join("");

    return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GeoLeaf — Référence des paramètres de configuration</title>
<style>
  :root{--bg:#fff;--fg:#1f2430;--muted:#667085;--line:#e4e7ec;--head:#f4f6f8;--accent:#1769aa;--code:#f2f4f7;}
  *{box-sizing:border-box;}
  body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg);}
  header{padding:18px 22px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5;}
  h1{margin:0 0 4px;font-size:19px;}
  .meta{color:var(--muted);font-size:12px;}
  .bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 22px;border-bottom:1px solid var(--line);position:sticky;top:62px;background:var(--bg);z-index:4;}
  .fbtn{border:1px solid var(--line);background:#fff;border-radius:16px;padding:4px 11px;cursor:pointer;font-size:12px;color:var(--fg);}
  .fbtn.active{background:var(--accent);color:#fff;border-color:var(--accent);}
  select,input[type=search]{padding:6px 9px;border:1px solid var(--line);border-radius:7px;font-size:13px;background:#fff;color:var(--fg);}
  input[type=search]{min-width:230px;flex:1;}
  .legend{display:flex;flex-wrap:wrap;gap:6px;padding:10px 22px;border-bottom:1px solid var(--line);}
  .badge{font-size:11px;padding:2px 8px;border-radius:12px;border:1px solid var(--line);white-space:nowrap;}
  .count{padding:8px 22px;color:var(--muted);font-size:12px;}
  .wrap{padding:0 22px 60px;}
  table{border-collapse:collapse;width:100%;font-size:12.5px;}
  thead th{position:sticky;top:150px;background:var(--head);text-align:left;padding:8px 9px;border-bottom:2px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);}
  td{padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:top;}
  tbody tr:hover{background:#fafbfc;}
  code{background:var(--code);padding:1px 5px;border-radius:4px;font:12px/1.4 "SFMono-Regular",Consolas,Menlo,monospace;word-break:break-word;}
  .fam{font-weight:700;color:var(--accent);white-space:nowrap;}
  .st{white-space:nowrap;font-size:12px;}
  .key{min-width:180px;}
  .effet{color:#344054;}
  .conso{color:var(--muted);}
  .teste{text-align:center;white-space:nowrap;}
  td.valeurs,td.defaut{color:#344054;}
  .hide{display:none;}
  .st-used{background:#e7f6ec;}.st-partial{background:#fff7e0;}.st-orphan{background:#f2f4f7;}
  .st-dead{background:#fde8e8;}.st-alias{background:#eaf2fb;}.st-legacy{background:#f6efe5;}.st-broken{background:#fde8e8;}
  .st-ref{background:#eef0fd;}.st-unknown{background:#f2f4f7;}
</style>
</head>
<body>
<header>
  <h1>GeoLeaf — Référence des paramètres de configuration JSON</h1>
  <div class="meta">${meta.count} paramètres · familles B1→B7 · source unique : <code>${esc(meta.src)}</code> v${esc(meta.version)} du ${esc(meta.date)} · <strong>tableau régénérable</strong> (<code>npm run gen:config-reference</code>)</div>
</header>
<div class="bar">
  <span style="font-weight:600">Famille :</span> ${familyButtons}
  <select id="fFichier">${fichierSelect}</select>
  <select id="fStatut">${statusOptions}</select>
  <input type="search" id="fSearch" placeholder="Rechercher (clé, fichier, consommateur, effet…)" />
</div>
<div class="legend">${statusLegend}</div>
<div class="count" id="count"></div>
<div class="wrap">
<table>
  <thead><tr>
    <th>Fam.</th><th>Fichier</th><th>Clé</th><th>Type</th><th>Valeurs possibles</th>
    <th>Défaut</th><th>Statut</th><th>Résultat attendu / effet</th><th>Consommateur</th><th>Testé</th>
  </tr></thead>
  <tbody id="tb"></tbody>
</table>
</div>
<script>
const DATA = ${rowsJson};
const tb = document.getElementById('tb');
const countEl = document.getElementById('count');
let famFilter = '';
function render(){
  const fich = document.getElementById('fFichier').value;
  const stat = document.getElementById('fStatut').value;
  const q = document.getElementById('fSearch').value.trim().toLowerCase();
  let html = '', n = 0;
  for(const r of DATA){
    if(famFilter && r.fam !== famFilter) continue;
    if(fich && r.fichier !== fich) continue;
    if(stat && r.statusKey !== stat) continue;
    if(q && !r.s.includes(q)) continue;
    n++;
    html += '<tr>'
      + '<td class="fam" title="'+r.famLabel.replace(/"/g,'&quot;')+'">'+r.fam+'</td>'
      + '<td><code>'+r.fichier+'</code></td>'
      + '<td class="key">'+r.cle+'</td>'
      + '<td>'+r.type+'</td>'
      + '<td class="valeurs">'+r.valeurs+'</td>'
      + '<td class="defaut">'+r.defaut+'</td>'
      + '<td class="st st-'+r.statusKey+'">'+r.statusSym+' '+r.statusLabel+'</td>'
      + '<td class="effet">'+r.effet+'</td>'
      + '<td class="conso">'+r.conso+'</td>'
      + '<td class="teste">'+(r.teste||'☐')+'</td>'
      + '</tr>';
  }
  tb.innerHTML = html;
  countEl.textContent = n + ' / ' + DATA.length + ' paramètre(s) affiché(s)';
}
document.querySelectorAll('.fbtn').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.fbtn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); famFilter = b.dataset.fam; render();
}));
['fFichier','fStatut','fSearch'].forEach(id=>document.getElementById(id).addEventListener('input',render));
render();
</script>
</body>
</html>
`;
}

// ─── Contrôle de complétude ───────────────────────────────────────────────────
/**
 * Fails if a table inside a `## B<n>` family section was not recognised as a parameter table.
 *
 * Why this exists (27/07/2026). The parser skips silently in two places — a row whose key
 * cell is empty (`parseInventory`, `if (!cle) continue`) and a table whose header carries no
 * recognised `Clé` column (`if ("cle" in map …)`). Until now the ONLY failure mode was
 * `records.length === 0`: lose one table out of the 42 and the HTML came out short, exit 0,
 * nothing red. That is the exact class of defect `probe-gate-visibility.cjs` watches
 * elsewhere in this repo — a gate going green on a corpus it never scanned.
 *
 * ⚠️ A ROW-COUNT comparison does NOT work here, and the first version of this guard proved it
 * the hard way: any counter that resolves columns through `columnIdOf()` shares the parser's
 * blindness, so a renamed header makes BOTH sides drop the same table and they agree. Seen
 * green on a mutation that should have been red. The check therefore asserts a STRUCTURE the
 * parser cannot argue with: inside a family section, every table must expose a key column.
 */
function findUnparsedFamilyTables(md) {
    const lines = md.split(/\r?\n/);
    const offenders = [];
    let family = null;
    let heading = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const mFam = line.match(/^##\s+(B\d)\s+—\s+(.*)$/);
        if (mFam) {
            family = mFam[1];
            heading = mFam[2].trim();
            continue;
        }
        // Any other `## ` heading leaves the family sections.
        if (/^##\s+/.test(line) && !mFam) family = null;
        const mSub = line.match(/^###\s+(.*)$/);
        if (mSub) heading = mSub[1].trim();

        if (!family) continue;
        // Struck-through sub-sections are migration archives: excluded by design, exactly as
        // `check-config-coverage.cjs` excludes them from both directions.
        if (heading && /^~~.*~~$/.test(heading)) continue;

        // A table header is a pipe row immediately followed by a separator row.
        if (!/^\s*\|/.test(line)) continue;
        if (isSeparatorRow(line)) continue;
        if (!isSeparatorRow(lines[i + 1] || "")) continue;

        const headers = splitRow(line);
        const hasKey = headers.some((h) => columnIdOf(h) === "cle");
        if (!hasKey) {
            offenders.push({
                line: i + 1,
                family,
                heading: heading || "(section sans titre)",
                headers: headers.join(" | "),
            });
        }
    }
    return offenders;
}

function assertParsedEverything(md, records) {
    const offenders = findUnparsedFamilyTables(md);
    if (offenders.length === 0) return;
    console.error(
        `✗ Complétude : ${offenders.length} table(s) d'une section de famille B* sans colonne ` +
            `« Clé » reconnue — leurs lignes ne sont PAS dans le HTML (${records.length} parsées).`
    );
    for (const o of offenders) {
        console.error(`    ${SRC_REL}:${o.line} — [${o.family}] ${o.heading}`);
        console.error(`      en-tête : ${o.headers}`);
    }
    console.error(
        "  Corriger l'en-tête de la table (colonnes reconnues : Fichier/Clé/Type/Valeurs/Défaut/" +
            "Consommateur/Statut/Effet/Testé) ou `columnIdOf()`. Ne pas contourner : sans ce " +
            "contrôle, un HTML court sortait en exit 0."
    );
    process.exit(1);
}

/**
 * Lit la version et la date que l'inventaire déclare LUI-MÊME dans son bandeau de tête
 * (`> **Version :** 1.19.1 — 2026-07-27`).
 *
 * ⚠️ **C'est ce qui rend `--check` possible, et c'est la seule raison d'être de cette
 * fonction.** La sortie embarquait `new Date()` : un artefact généré qui contient « maintenant »
 * n'est comparable à rien — il diverge de lui-même à chaque jour qui passe, et toute gate de
 * fraîcheur bâtie dessus rougirait tous les matins pour rien, donc serait désarmée en une
 * semaine. En lisant la date DANS la source, la sortie redevient une **fonction pure de son
 * entrée**, ce qui est la condition d'existence de `docs:tree:check` et de toute gate du même
 * genre.
 *
 * ⚠️ **Aucun repli silencieux.** Un bandeau absent ou reformaté fait ÉCHOUER le script plutôt
 * que retomber sur la date du jour : le repli réintroduirait exactement la non-déterminisme
 * qu'on vient de retirer, et il le ferait sans que personne ne le voie.
 *
 * ⚠️ **La recherche est BORNÉE À L'EN-TÊTE, et la première version ne l'était pas — la mutation
 * de contrôle l'a prouvé.** L'inventaire porte DEUX bandeaux `> **Version :** X — date` : le
 * sien, en tête, et un second dans son historique de révisions (`1.19.0 — 2026-07-21`). Un
 * `/m` sur tout le document trouvait le bon par simple ordre d'apparition ; en retirant la date
 * du premier, le script est allé lire **le second**, sans rien dire — le repli silencieux que le
 * paragraphe ci-dessus prétendait avoir supprimé. La recherche s'arrête donc au premier titre
 * `## `, ce qui délimite l'en-tête **par construction** et non par un nombre de lignes.
 */
function readSourceStamp(md) {
    const head = md.split(/^##\s/m)[0];
    const m = /^>\s*\*\*Version\s*:\*\*\s*([0-9]+(?:\.[0-9]+)*)\s*—\s*(\d{4}-\d{2}-\d{2})/m.exec(
        head
    );
    if (!m) {
        console.error(
            `✗ Bandeau de version introuvable dans ${SRC_REL}.\n` +
                "  Attendu, en tête du document : `> **Version :** X.Y.Z — AAAA-MM-JJ`\n" +
                "  Ne pas contourner par la date du jour : la sortie cesserait d'être une fonction\n" +
                "  pure de son entrée, et `--check` deviendrait ininterprétable."
        );
        process.exit(1);
    }
    return { version: m[1], date: m[2] };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
    if (!fs.existsSync(SRC)) {
        console.error(`✗ Inventaire introuvable : ${SRC}`);
        process.exit(1);
    }
    const md = fs.readFileSync(SRC, "utf8");
    const records = parseInventory(md);
    if (records.length === 0) {
        console.error("✗ Aucune ligne de paramètre parsée — format d'inventaire inattendu ?");
        process.exit(1);
    }
    assertParsedEverything(md, records);
    const stamp = readSourceStamp(md);
    const html = buildHtml(records, {
        count: records.length,
        date: stamp.date,
        version: stamp.version,
        src: SRC_REL,
    });

    if (CHECK) {
        const rel = path.relative(ROOT, OUT);
        if (!fs.existsSync(OUT) || fs.readFileSync(OUT, "utf8") !== html) {
            console.error(`ERROR [CONFIG-REFERENCE]: ${rel} — PÉRIMÉ.`);
            console.error(
                `  ${SRC_REL} a bougé depuis la dernière génération (ou le générateur a changé).`
            );
            console.error("  Run: npm run gen:config-reference — puis commiter le résultat.");
            process.exit(1);
        }
        console.log(
            `✅ [CONFIG-REFERENCE] à jour — ${records.length} paramètres, ` +
                `source v${stamp.version} du ${stamp.date}.`
        );
        return;
    }

    fs.writeFileSync(OUT, html, "utf8");

    const perFam = {};
    for (const r of records) perFam[r.family] = (perFam[r.family] || 0) + 1;
    console.log(`✓ ${records.length} paramètres → ${path.relative(ROOT, OUT)}`);
    console.log(
        "  par famille : " +
            Object.keys(perFam)
                .sort()
                .map((f) => `${f}=${perFam[f]}`)
                .join(" · ")
    );
}

main();
