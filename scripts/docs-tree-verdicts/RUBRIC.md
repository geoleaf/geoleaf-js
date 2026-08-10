# Grille de qualification de l'arborescence

> Référence normative de la passe « arborescence qualifiée ». **Lue par chaque agent de lot avant
> tout verdict.** Elle existe pour qu'une trentaine d'inspections indépendantes produisent **une**
> norme et non trente. Un verdict qui ne cite pas une règle de ce fichier est rejeté.

---

## 0. Posture — lire avant tout

**Ce dépôt n'est pas en désordre.** Mesures : 3 arêtes d'import inverses sur 2 451, un seul cycle,
aucun fichier source au-dessus de 700 lignes, ~25 gates d'architecture actives, `contracts/` +
`adapters/maplibre/` formant un ports & adapters réellement verrouillé.

Conséquence directe : **`justifié` est le verdict par défaut**, et la charge de la preuve pèse
entièrement sur le verdict non trivial. Un dossier de 219 fichiers bien rangés produit 219
`justifié` — c'est un **résultat**, pas un échec d'inspection. Un agent qui rend 40 % de verdicts
actionnables sur un périmètre sain n'a pas été perspicace : il a produit du bruit, et ce bruit
coûtera plus cher à trier que la dette qu'il prétend révéler.

**Cadre décisionnel.** Breaking change déjà engagé, aucun client, aucune API à préserver. Aucun
verdict ne doit être adouci au nom de la compatibilité. Si la bonne réponse est « déplacer 40
fichiers », c'est la réponse.

---

## 1. Les sept règles non négociables

1. **Un identifiant de règle par verdict** (`N3`, `E2`, `X2e`…). Sans identifiant → verdict rejeté.
2. **Une mesure par justification.** LOC, nombre d'importeurs, hash, citation d'en-tête. Jamais un
   adjectif seul. « 9 lignes, 1 consommateur » ✅ — « pas très clair » ❌.
3. **Lire l'en-tête avant de condamner.** Ce dépôt documente ses décisions dans les en-têtes de
   fichier (`ORDER IS LOAD-BEARING`, « Extracted from X to keep it within the 700-line limit »,
   etc.). Contredire une décision documentée est **permis** et doit être argumenté. L'**ignorer**
   invalide le verdict.
4. **Préséance** : `supprimer > fusionner > déplacer > renommer > justifié`. Un artefact reçoit
   **un seul** verdict d'existence. Si un fichier est mort, on ne discute pas son nom.
5. **Toute destination est nommée.** `déplacer` sans cible et `renommer` sans nouveau nom ne
   comptent pas.
6. **Ne pas juger** la qualité du code, les bugs, la performance, la couverture de tests. La passe
   porte sur **nom / emplacement / existence**, rien d'autre.
7. **Les gates et les 10 ADR sont des faits, pas des opinions.** Un verdict qui contredit
   `verify-core-standalone`, `check-contracts-pure`, `check-facade-purity`,
   `verify-plugin-core-boundary`, `verify-seam-drift` ou l'ordre de boot B1→B11 doit l'énoncer
   explicitement **et** proposer la modification de la gate dans le même mouvement.

**Règle d'abstention.** Si l'agent n'a pas lu le fichier (au minimum : en-tête + imports +
exports), il écrit `existence: "?"` et `description: null`. Une phrase inventée sur un fichier non
lu est indiscernable d'une phrase juste — c'est précisément le principe que
`docs-tree-annotations.json` applique déjà en rendant `*non documenté*` plutôt qu'une prose
plausible.

---

## 2. Colonne **NOM**

> **En lisant ce nom seul, sans ouvrir le fichier, un nouvel arrivant peut-il prédire ce qu'il
> contient — et se tromper serait-il coûteux ?**

### Conventions réellement en vigueur (à faire respecter, pas à réinventer)

| Famille             | Forme                                                                                                | Occurrences | Statut                                |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ----------: | ------------------------------------- |
| Défaut              | `kebab-case.ts`                                                                                      |        ~740 | **Canonique**                         |
| Contrats de type    | `<nom>.contract.ts`                                                                                  |          15 | Canonique, gaté type-only             |
| Wrappers de boot    | `<id>.module.ts`                                                                                     |           6 | Canonique                             |
| Façades publiques   | `geoleaf.<Namespace>.ts`                                                                             |          28 | Canonique, gaté `check-facade-purity` |
| Bridges globaux     | `globals.<domaine>.ts`                                                                               |           7 | Canonique                             |
| Gabarit de capacité | `install.ts` (18) · `lifecycle.ts` (17) · `public-api.ts` (25) · `config.ts` (20) · `module.ts` (13) |           — | Canonique                             |
| Seams runtime       | `<nom>-seam.ts`                                                                                      |           3 | Canonique, **sous-appliqué**          |
| i18n                | `lang_xx.ts` (**snake_case**)                                                                        |          37 | **Violation isolée**                  |

### Règles

| #       | Règle                            | Déclencheur mesurable                                                                                                                                                  | Verdict                                                                 |
| ------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **N1**  | Casse et séparateur              | Basename hors `^[a-z0-9]+(-[a-z0-9]+)*(\.(contract\|module\|types\|transport\|primitive))?$`, hors familles `geoleaf.*` / `globals.*`                                  | `renommer`, mineur. Cas connu : 37 `lang_xx.ts` → `lang-xx.ts`          |
| **N2**  | **Le nom ment sur le contenu**   | L'en-tête `@module`/`@description` ou les exports réels contredisent le nom                                                                                            | `renommer`, **bloquant**                                                |
| **N3**  | Fourre-tout                      | Nom ∈ {`general`, `helpers`, `misc`, `utils`, `common`, `shared`, `core`, `internal`} **et** ≥ 3 responsabilités sans lien                                             | `renommer` + `déplacer`                                                 |
| **N4**  | `index.ts` non-barrel            | `index.ts` > 40 LOC contenant des déclarations exportées, pas uniquement des `export … from`                                                                           | `renommer`, majeur                                                      |
| **N5**  | Homonymie **accidentelle**       | Deux basenames identiques **hors** famille déclarée. Appartenir au gabarit (`install.ts`, `config.ts`, `types.ts`…) → `ok`                                             | `renommer` en `<domaine>-<nom>.ts`                                      |
| **N6**  | Homonymie de **dossier**         | Deux dossiers de même nom, à des niveaux différents, aux rôles distincts                                                                                               | `renommer`, majeur                                                      |
| **N7**  | Suffixe de rôle creux            | `-manager`, `-handler`, `-orchestrator`, `-helper`, `-service` **sans** objet/classe éponyme exporté                                                                   | `renommer`. **Ne pas condamner en bloc** — vérifier fichier par fichier |
| **N8**  | Singulier/pluriel indiscernables | Deux artefacts **publics** ne différant que par un `s`                                                                                                                 | `renommer`, **bloquant** (API publique)                                 |
| **N9**  | Namespace ≠ dossier              | Façade `geoleaf.X.ts` pour une capacité nommée `y`                                                                                                                     | `renommer`                                                              |
| **N10** | `@module` faux ou absent         | `@module` désignant un chemin disparu → **majeur** (publie une fausse doc, la colonne description le lit). Absent et hors baseline `check-module-headers.cjs` → mineur | `renommer`/signalement                                                  |
| **N11** | `internal.ts`                    | Toléré **uniquement** si seam unique documenté du package **et** < 120 LOC                                                                                             | sinon `renommer`                                                        |

### Ce qui **n'est pas** un défaut de nom — ne pas signaler

- Le préfixe `geoleaf.` des façades : correspondance 1:1 avec le namespace runtime (`GeoLeaf.Scale`).
- Les basenames répétés du gabarit de capacité (`install.ts`, `lifecycle.ts`, `config.ts`…) : la
  répétition est **prédictible**, donc elle informe. Le coût sur le fuzzy-find est assumé et
  partagé par tout le feature-folder moderne.
- Le préfixe `maplibre-` dans `adapters/maplibre/` : redondant avec le dossier, mais il marque une
  frontière verrouillée et protège le fuzzy-find.

---

## 3. Colonne **EMPLACEMENT**

> **Si je modifie ce fichier, quels autres fichiers dois-je ouvrir — et sont-ils dans le même
> dossier ?**

| #       | Règle                         | Déclencheur mesurable                                                                                                                                                                                                    | Verdict                                   |
| ------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **E1**  | Cohésion par consommateur     | ≥ 80 % des importeurs sont hors du dossier du fichier **et** concentrés dans un seul autre dossier                                                                                                                       | `déplacer` vers ce dossier                |
| **E2**  | Niveau d'abstraction          | Un fichier de `utils/` porte de la connaissance **métier** (carto, POI, profil, thème). **Test décisif : un fichier de `utils/` doit être publiable tel quel sur npm sans mentionner GeoLeaf ni MapLibre**               | `déplacer` vers `kernel/<sous-système>/`  |
| **E3**  | Direction des dépendances     | Import « vers le haut » : `utils/ → kernel/`, `utils/ → api/`, `kernel/ → capabilities/`. Liste exhaustive connue : **12 arêtes**                                                                                        | `déplacer` le symbole partagé vers le bas |
| **E4**  | Frontière core / plugin / lib | (a) plugin redéfinissant un symbole canonique de `host-runtime` — déjà gaté ; (b) helper dupliqué entre plugins — **non gaté**, à signaler ; (c) capacité in-core plus lourde qu'un plugin moyen et sans couplage kernel | `déplacer`                                |
| **E5**  | Contrat vs seam               | `*-contract.ts` hors de `contracts/`. **Type-only** → rejoindre `contracts/`. **Accesseur runtime gardé** → rester près du consommateur, renommer `*-seam.ts`                                                            | `déplacer` ou `renommer`                  |
| **E6**  | Colocalisation des assets     | CSS / icônes / dictionnaires d'une feature doivent vivre dans son dossier. ⚠️ Contre-argument à peser : la cascade `@layer` de `geoleaf-main.css` impose un ordre                                                        | `déplacer`                                |
| **E7**  | Profondeur                    | > 5 niveaux sous `src/` → trop profond. Dossier à **1 fichier** → profondeur inutile                                                                                                                                     | `déplacer`/`fusionner`                    |
| **E8**  | Racine de package             | Un fichier à la racine de `src/` doit être un point d'entrée ou une déclaration globale                                                                                                                                  | `déplacer`                                |
| **E9**  | Tests                         | La convention de placement doit être **unique dans le dépôt**                                                                                                                                                            | `déplacer`, majeur                        |
| **E10** | Racine du dépôt               | Un dossier racine doit être : source, config d'outil, doc, ou données de démo                                                                                                                                            | `déplacer`                                |

---

## 4. Colonne **EXISTENCE** — évaluer dans l'ordre, s'arrêter au premier déclencheur

### ➊ `supprimer`

| #       | Déclencheur                                                                                          | Preuve exigée                                                                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **X1a** | **Mort** — 0 importeur dans `packages/**/src`, `scripts/`, `e2e/`, absent des `exports` du manifeste | `graph.json#importers` **+** un grep. ⚠️ Ne jamais conclure sur le seul grep : les `exports` en glob (`./facades/*`) rendent des fichiers atteignables sans import nommé |
| **X1b** | **Redondant** — deux fichiers identiques, l'un subordonné                                            | hash                                                                                                                                                                     |
| **X1c** | **Remplaçable par une dépendance**                                                                   | ⚠️ **Défaut = `justifié`.** Ajouter une dépendance est un coût de bundle (budget dur 300 KB gz) et de sécurité, pas un gain automatique                                  |
| **X1d** | **Artefact généré versionné** sans nécessité                                                         | —                                                                                                                                                                        |

### ➋ `fusionner`

| #       | Déclencheur                  | Seuil                                                                                                                                                                                                                                                                                                             |
| ------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **X2a** | Indirection pure             | < 25 LOC, corps uniquement `export … from` / `export const X = f()`, **et** ≤ 1 consommateur. ⚠️ **Fusionner ≠ supprimer la façade** : `public-api.ts` est le contrat de nom qui rend les 13 plugins interchangeables. La fusion consiste à renommer `<x>-api.ts` en `public-api.ts` et supprimer l'intermédiaire |
| **X2b** | Responsabilités recouvrantes | Deux fichiers du même dossier dont on ne peut **pas énoncer en une phrase** la règle disant lequel ouvrir                                                                                                                                                                                                         |
| **X2c** | Dossier sous-critique        | 1–2 fichiers, < 150 LOC au total, sans perspective de croissance                                                                                                                                                                                                                                                  |
| **X2d** | Package sous-critique        | Package npm < 250 LOC **et** privé **et** ≤ 3 consommateurs internes                                                                                                                                                                                                                                              |
| **X2e** | **Fork inter-plugins**       | Même helper défini dans ≥ 2 plugins. **Non couvert par les gates actuelles.** Cible : `host-runtime`                                                                                                                                                                                                              |

### ➌ `déplacer` — déclenché par E1–E10. Nommer la destination.

### ➍ `renommer` — déclenché par N1–N11. Nommer le nouveau nom.

### ➎ `justifié` — défaut

À écrire quand aucun déclencheur ne s'active, **ou** qu'un déclencheur s'active mais est surclassé
par un invariant explicite du dépôt — auquel cas **citer l'invariant** (`INV-FACADE`,
`no-plugin-in-core`, `sideEffects`, ordre B1→B11, `ORDER IS LOAD-BEARING`, table `SEAMS`).

> ⚠️ **Une copie listée dans la table `SEAMS` de `verify-seam-drift.cjs` est `justifié`, pas
> `fusionner`.** Ce sont des duplications **délibérées**, à hash épinglé des deux côtés, imposées
> par `verify-plugin-core-boundary` (un plugin ne peut pas importer les sources du core).

---

## 5. Sévérité

| Sévérité     | Critère                                                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **bloquant** | Le nom ou l'emplacement **ment** (N2, N6, N8) · une frontière d'architecture est franchie (E3, E4) · la dette grossit mécaniquement (X2e : chaque nouveau plugin ajoute une copie) |
| **majeur**   | Coût de repérage réel et récurrent : deux conventions concurrentes (E9), fourre-tout (N3), `index.ts` non-barrel (N4)                                                              |
| **mineur**   | Cosmétique, traitable en un commit mécanique : casse (N1), homonymie accidentelle (N5), `@module` absent (N10)                                                                     |

---

## 6. Écarté d'office — ne pas recommander

Ces propositions sonnent « moderne » et sont **fausses ici**. Un agent qui les propose sera corrigé
en passe de cohérence.

- **`src/` plat** — argument valable sous 50 fichiers. À 816, absurde. La profondeur actuelle
  (max 5) est correcte ; le seuil de douleur est à 6+.
- **Barrels `index.ts` partout** — le consensus va dans l'autre sens (coût de tree-shaking, cycles,
  résolution TS). 17 barrels pour 816 fichiers est le **bon** ratio. Ne pas en ajouter.
- **Découper `core` en N packages npm** — le core partage un namespace global mutable assemblé par
  l'ordre B1→B11 ; le découper transformerait un ordre d'import interne en contrat de versions
  inter-packages. Coût énorme, gain nul tant que le tree-shaking par entrée composée fonctionne.
- **Renommer `capabilities/` en `features/`** — le terme est porté par un contrat
  (`ICapabilityDeclaration`), un registre (`CapabilityRegistry`), une API publique
  (`getAllCapabilities()`) et le manifeste. Churn pur.
- **Layout `apps/` + `packages/`** — il n'y a pas d'app dans ce dépôt.
- **Outillage de release (changesets…)** — hors périmètre « structure de dossiers ».

---

## 7. Schéma de sortie

Un shard JSON par lot. Périmètres disjoints par construction → fusion par `Object.assign`.

```jsonc
{
    "schemaVersion": 2,
    "lot": "C3",
    "scope": ["packages/core/src/capabilities/filter"],
    "verdicts": {
        "packages/core/src/capabilities/filter/apply.ts": {
            "kind": "file", // "file" | "dir"
            "name": "ok", // "ok" | "KO"
            "nameTarget": null, // OBLIGATOIRE si name === "KO"
            "location": "ok", // "ok" | "KO"
            "locationTarget": null, // OBLIGATOIRE si location === "KO"
            "existence": "justifie", // justifie|renommer|deplacer|fusionner|supprimer|?
            "existenceTarget": null, // OBLIGATOIRE si renommer/deplacer/fusionner
            "rule": "N/A", // id de règle — OBLIGATOIRE si existence !== "justifie"
            "severity": null, // bloquant|majeur|mineur — si existence !== "justifie"
            "description": "Applique le prédicat de filtre aux sources MapLibre.",
            "confidence": "haute", // haute|moyenne|basse
            "rationale": "Un seul export, consommé par binding.ts et panel/state.ts.",
        },
    },
}
```

### Contraintes validées par `validateVerdicts()` — donc contraignantes pour l'agent

1. Toute clé doit exister dans l'inventaire. Sinon → **throw** (clé morte).
2. Tout fichier du périmètre doit être présent. Absent → rendu `?`, **visible, non bloquant**.
3. `nameTarget` / `locationTarget` / `existenceTarget` obligatoires selon le verdict.
4. Un `locationTarget` doit désigner un répertoire existant **ou** être préfixé `new:`.
5. **Cohérence croisée** : `name: "KO"` ⇒ `existence ∈ {renommer, fusionner, supprimer}` ;
   `location: "KO"` ⇒ `existence ∈ {deplacer, fusionner, supprimer}`. Un « nom incorrect » avec
   « existence justifiée » est une contradiction — c'est le verdict de complaisance rendu impossible.
6. `description` : **français**, une phrase, ≤ 240 caractères, sans point final superflu.
7. `confidence: "basse"` **exige** un `rationale` non vide.

### Consigne de rédaction des descriptions

Reprise mot pour mot de `docs-tree-annotations.json` :
**dire ce que le fichier EST et ce qu'il CONTIENT, pas ce qu'on aimerait qu'il soit.**
Français, quelques mots, pas de reprise verbatim d'un en-tête anglais.

---

_MP-i — Mattieu Pottier Indépendant_
