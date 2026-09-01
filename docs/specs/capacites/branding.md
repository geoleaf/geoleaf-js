---
type: spec-capacite
title: branding — la ligne de marque posée en surimpression sur la carte
capability_id: branding
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 5535694b
date: 27 juillet 2026
---

# branding — la ligne de marque posée en surimpression sur la carte

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/branding/` ·
**Vérifié contre :** `5535694b` (27/07/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa
>    place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.
>    Cette fiche renvoie, elle ne recopie pas.

---

## Périmètre

### Ce que la capacité fait

Elle affiche un **texte personnalisable en surimpression de la carte**, monté comme un contrôle
natif via l'adaptateur, et en expose le pilotage impératif (`show` / `hide` / `setText`).

### Ce qu'elle ne fait pas

- **Elle n'affiche pas l'attribution cartographique.** L'attribution MapLibre est désactivée à
  la source (`adapters/maplibre/maplibre-adapter.ts`) ; le texte par défaut de branding _mentionne_
  MapLibre, mais ce n'est pas un mécanisme d'attribution.
- **Elle n'a pas de contenu riche.** Le texte est posé en `textContent`, jamais en HTML : pas de
  lien, pas d'image, pas de balise.
- **Elle ne dit pas non plus « configure-moi ».** L'ancienne boîte de rappel affichée quand la clé
  `branding` était absente **a été supprimée** : une capacité non configurée ne rend rien, en
  silence.
- **Elle ne possède pas le conteneur où elle s'affiche.** `.maplibregl-ctrl-bottom-left` est
  **partagé** avec `legend`, `scale` et `coordinates` — voir §Dépendances et frontières, c'est le
  point d'attention le plus concret de cette capacité.

---

## Fonctionnalités

| ID    | Fonctionnalité                    | Entrée                                                     | Sortie observable                                                                                                   | Code                                         |
| ----- | --------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| BR-01 | Surimpression montée sur la carte | `BrandingModule.init(adapter)`                             | Contrôle `.gl-branding` contenant `.gl-branding__content`, ajouté via `addControl` à `position`                     | `branding.ts` → `init` puis `_createControl` |
| BR-02 | Texte configurable                | `modules.branding.text`                                    | Le texte remplace le libellé par défaut                                                                             | `branding.ts` → `init`                       |
| BR-03 | Texte par défaut traduit          | Aucun `text` configuré                                     | Libellé `ui.branding.default_text` de la langue active (fichiers `src/lang/lang-*.ts`)                              | `branding.ts` → graine `_options`            |
| BR-04 | Texte vide = silence assumé       | `modules.branding.text` valant la chaîne vide              | **Aucun contrôle créé**, un `Log.info` le dit — ce n'est pas une erreur                                             | `branding.ts` → `init`, sortie anticipée     |
| BR-05 | Position configurable             | `modules.branding.position`                                | Le contrôle est ajouté à la position demandée                                                                       | `branding.ts` → `_createControl`             |
| BR-06 | Injection HTML impossible         | Texte contenant du balisage                                | Rendu littéral — `textContent` sur les deux chemins d'écriture (création et `setText`)                              | `branding.ts` → `_createControl`, `setText`  |
| BR-07 | Neutralisation de la propagation  | Interaction sur la surimpression                           | Ni pan ni zoom parasite de la carte dessous                                                                         | `branding.ts` → `blockMapPropagation`        |
| BR-08 | Affichage / masquage à chaud      | `GeoLeaf.Branding.show()` / `.hide()`                      | `style.display` du conteneur remis à sa valeur naturelle, ou `"none"`                                               | `branding.ts` → `show`, `hide`               |
| BR-09 | Changement de texte à chaud       | `GeoLeaf.Branding.setText("…")`                            | Le contenu de `.gl-branding__content` est remplacé (inerte si rien n'est monté)                                     | `branding.ts` → `setText`                    |
| BR-10 | Montage idempotent                | Plusieurs appels au montage                                | Un seul contrôle ; les appels suivants sont inertes                                                                 | `lifecycle.ts` → drapeau `_started`          |
| BR-11 | Démontage complet                 | `BrandingModule.destroy()` ou `BrandingLifecycle._reset()` | Contrôle retiré, écouteurs de propagation détachés, références internes remises à `null`                            | `branding.ts` → `destroy`                    |
| BR-12 | Aucune exception ne remonte       | Carte absente, DOM indisponible                            | Le message part dans `Log.error`, la méthode rend la main — chaque méthode publique est enveloppée d'un `try/catch` | `branding.ts`                                |
| BR-13 | Déclaration introspectable        | —                                                          | `getAllCapabilities()` la liste, `getCapabilitySchema("branding")` rend son schéma sans `loader`                    | `branding-capability.ts`                     |

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/branding/` (déclaration,
contrôle, cycle de vie).

---

## Configuration

Bloc `modules.branding` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre  | Type      | Défaut         | Où c'est lu                                                                                                |
| ---------- | --------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| `enabled`  | `boolean` | `false`        | `constants.ts` → `brandingConfigDefaults()` ; **le gate de déclaration** décide l'enregistrement du module |
| `text`     | `string`  | —              | `branding.ts` → `init`. **Aucun défaut de configuration** : la graine vient de l'i18n, voir ci-dessous     |
| `position` | `string`  | `"bottomleft"` | `constants.ts` → `DEFAULT_BRANDING_POSITION`, appliqué par `_createControl`                                |

### Les trois copies du défaut, et le fichier qui les a réunies

`constants.ts` n'existe pas pour ranger : il **répare une divergence mesurée** (B.24). La position
par défaut vivait en littéral nu à **trois endroits que rien ne tenait ensemble** — le schéma
d'introspection l'annonçait, le lecteur de configuration ne la matérialisait pas, et la valeur
réellement appliquée venait d'une troisième copie dans le contrôle. Un auteur de profil qui lisait
`getCapabilitySchema("branding")` se voyait promettre un défaut qu'aucun accesseur ne rendait.

Depuis, la déclaration (valeur **annoncée**), le lecteur (valeur **appliquée**) et la graine
`_options` du contrôle importent **la même fabrique**, `brandingConfigDefaults()` — les trois sont
égales _par construction_. Le gardien code↔code de cette égalité est
`__tests__/capabilities/config-schema-defaults.test.js`, dont l'en-tête cite justement branding
comme l'instance qui l'a motivé.

C'est une fabrique, pas une constante partagée : aucun appelant ne peut muter les défauts du
suivant.

### Pourquoi `text` n'a pas de défaut de configuration

Ni le `configSchema` ni `brandingConfigDefaults()` ne déclarent de **défaut** pour `text` —
délibérément. ⚠️ Cette phrase a écrit « ne déclarent `text` » jusqu'au 19/08/2026, et c'était faux
de la première moitié : le `configSchema` déclare bien le **champ** `text` (`type: "string"`,
description), il ne lui donne simplement pas de `default`, là où `enabled` et `position` en ont
un. La nuance n'est pas cosmétique — un champ absent du schéma et un champ sans défaut ne se
comportent pas pareil : le premier n'est reconnu par rien, le second est reconnu et laissé vide.
Le texte
affiché en l'absence de configuration vient de l'**i18n** (`ui.branding.default_text`), pas de la
configuration : le mettre dans les défauts figerait une langue.

⚠️ **Conséquence à connaître** : cette graine est évaluée **à l'évaluation du module**, à l'import.
Un changement de langue après l'import ne réécrit pas le texte par défaut d'un contrôle déjà monté.

### Gate d'activation

Un seul étage, contrairement à [`theme-toggle`](theme-toggle.md) : `gate: { configPath: "modules.branding.enabled" }`,
**sans** `enableWhenAbsent` — donc opt-in franc, absent ⇒ désactivé. C'est possible parce que
branding est **app-global** (bloc porté par le `profiles/geoleaf.config.json` de base) : le gate pré-fusion
lit déjà la bonne valeur, il n'y a pas d'opt-in tardif à préserver. Le cycle de vie ne re-teste
donc pas `enabled` — il ne tourne que si la capacité est activée.

Migré de l'ancienne clé racine app-globale `branding`.

---

## Contrat exposé

### API publique

`GeoLeaf.Branding`, construit par `public-api.ts` → `buildPublicApi()`, monté par `install.ts` →
`registerGlobals(gl)`, re-exporté par la façade ESM `src/api/geoleaf.branding.ts`.

Sa forme est **le contrôle runtime augmenté** (`Object.assign(Branding, { … })`), pas un objet
neuf — `BrandingPublicApi = BrandingControl & BrandingReadApi` :

| Membre            | Origine            | Rend / fait                                                                |
| ----------------- | ------------------ | -------------------------------------------------------------------------- |
| `init(map, opts)` | contrôle           | Monte la surimpression (appelé par le cycle de vie, pas par l'intégrateur) |
| `destroy()`       | contrôle           | Démonte et nettoie                                                         |
| `show()`          | contrôle           | Réaffiche le conteneur                                                     |
| `hide()`          | contrôle           | Masque le conteneur                                                        |
| `setText(text)`   | contrôle           | Remplace le texte affiché                                                  |
| `isEnabled()`     | helper de capacité | `true` quand `modules.branding.enabled === true`                           |
| `getConfig()`     | helper de capacité | Le bloc `modules.branding` fusionné sur les défauts                        |

C'est la différence de forme avec `theme-toggle`, dont l'API publique est un objet neuf en lecture
seule : branding **a** un état à piloter (un conteneur monté), et l'expose.

Typage publié : `src/global.d.ts`, section des capacités (`Branding?:` → `BrandingPublicApi`). Ne
pas citer de numéro de ligne pour ce fichier — il est réécrit au fil du typage du namespace.

### Événements

**Aucun.** La capacité n'émet ni n'écoute d'événement du bus : son état ne dépend que de sa
configuration et des appels impératifs de son API publique.

---

## Décisions de conception

| Décision                                                             | Pourquoi                                                                                                                                                                                    | Alternative écartée                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Une fabrique de défauts partagée** (`constants.ts`)                | Trois copies indépendantes du même littéral avaient déjà divergé : annoncé ≠ matérialisé ≠ appliqué. Les faire importer la même fabrique rend l'égalité structurelle, pas surveillée        | Trois littéraux plus un test qui les compare — le test aurait dit _qu'elles_ divergent, pas empêché la divergence                     |
| **La capacité tire sa propre feuille de style**, depuis `install.ts` | `install.ts` est le seul module qu'un consommateur doit importer pour embarquer la capacité : y accrocher la CSS la fait entrer dans le graphe **avec** le code, et se tree-shaker avec lui | Une CSS globale listant toutes les capacités — c'est le régime d'avant le S6, celui qui rendait les capacités indétachables du bundle |
| **Gate à un seul étage**, sans `enableWhenAbsent`                    | branding est app-global : son bloc est déjà présent dans la configuration de base au moment du gate pré-fusion, donc rien ne se décide plus tard                                            | Un gate tardif comme celui de `theme-toggle` — inutile ici, et il ferait croire à un opt-in tardif qui n'existe pas                   |
| **Texte par défaut pris dans l'i18n**, pas dans les défauts          | Un défaut de configuration est une valeur unique ; un libellé affiché doit suivre la langue                                                                                                 | `text: "Powered by …"` dans `brandingConfigDefaults()` — aurait figé l'anglais pour tout le monde                                     |
| **`textContent` sur les deux chemins d'écriture**                    | Le texte vient d'un profil, donc d'une source que le core ne contrôle pas. `textContent` rend l'injection impossible par construction, sans dépendre d'un assainissement correct            | `innerHTML` + assainissement — un chemin de plus à ne jamais oublier                                                                  |
| **La boîte « branding non configuré » supprimée**                    | Elle transformait une absence de configuration en avertissement visible pour l'utilisateur final, alors que la capacité est opt-in : ne rien configurer est un choix valide                 | La conserver                                                                                                                          |
| **Chaque méthode publique enveloppée d'un `try/catch`**              | Une surimpression décorative ne doit jamais empêcher la carte de fonctionner. L'échec part dans `Log.error` et la carte vit                                                                 | Laisser remonter — un DOM indisponible aurait fait échouer le boot pour un ornement                                                   |
| Pas de `loader`                                                      | Inline, chargée avec le bundle UI ; le gate de configuration décide                                                                                                                         | Un `import()` paresseux                                                                                                               |

---

## Dépendances et frontières

### Dépendance de cycle de vie

`module.ts` → `BrandingModule` : `id = "branding"`, `dependencies = ["geojson"]` — monte après la
carte et les couches. Sa position dans `presets/manifest.full.ts` n'est pas libre : l'ordre
d'enregistrement est observable par introspection et sert de départage au tri topologique.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

Un seul accès kernel : `kernel/config/config-primitives.js`, **exception nommée par la règle**
elle-même (avec les hubs de types et les seams). Tout le reste passe par `utils/` :
`utils/log`, `utils/i18n`, `utils/general/dom-helpers` (`domCreate`),
`utils/controls/propagation-blocker` (`blockMapPropagation`).

### Contrats

`contracts/map-adapter.contract.js` — `GeoLeafControl`, `IMapAdapter`. La capacité ne consomme du
contrat que ce dont elle a besoin, via un type local **structurel** : `types.ts` → `BrandingMapLike`
(une seule méthode, `addControl`). `module.ts` transtype l'adaptateur reçu vers ce type au point de
passage. La capacité ne touche jamais MapLibre directement — une règle ESLint interdit à
`capabilities/**` d'importer `adapters/maplibre/*`.

**Aucun seam**, et **aucune référence à un plugin** (règle `no-plugin-in-core`, vérifiée par
`scripts/verify-core-standalone.cjs`).

### ⚠️ Le conteneur partagé — le vrai point d'attention

`css/branding.css` **possède la mise en page de `.maplibregl-ctrl-bottom-left`**, un conteneur
qu'elle partage avec `legend`, `scale` et `coordinates`. Toute déclaration ajoutée là les affecte.
L'en-tête du fichier porte cet avertissement et **le mesure** : le nombre de `!important` y est
passé de 34 à 2 (B.3), après vérification qu'aucune autre capacité ne déclare sur ce conteneur, et
que les contrôles GeoLeaf sont ajoutés sans enveloppe — donc sans la classe `.maplibregl-ctrl` sur
laquelle MapLibre déclare. Les six cas vivants (panneau ouvert/fermé × desktop/mobile, plus le
relevé de coordonnées) ont été repris un par un. **Ne pas rouvrir cette réduction sans refaire ces
six vérifications.**

La feuille est portée par la couche `@layer gl.capabilities` ; les variables de thème viennent de
`css/geoleaf-theme.css`, chargée plus tôt dans la cascade de `packages/core/src/css/geoleaf-main.css` — la feuille ne les
réimporte pas.
