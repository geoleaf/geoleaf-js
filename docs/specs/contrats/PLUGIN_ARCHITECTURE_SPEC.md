# Spécification d'architecture des plugins GeoLeaf — Plugin Contract v1

**Version produit :** GeoLeaf Platform V3
**Version du document :** 1.5.0
**Numéro de contrat :** Plugin Contract v1
**Date :** 8 juin 2026 (clôture S14 : 12 juin 2026)

> ## 🔒 SPEC FIGÉE — Plugin Contract v1
>
> **Gelée le 8 juin 2026.** Ce document fait **autorité** sur l'architecture des plugins GeoLeaf.
> La **Partie I (§0 à §10)** est **immuable** : tout changement d'un invariant (`INV-*`), du contrat
> d'enregistrement ou de la gouvernance passe **obligatoirement par une RFC acceptée**
> (voir §10). La **Partie II (annexes)** est de **référence vivante** : elle renvoie aux documents
> descriptifs qui suivent le code et s'éditent sans RFC.
>
> **Clôture S14 (12 juin 2026) — convergence terminée, contrat exécutoire.** Les plugins sont **tous conformes** (0 violation, 0 dérogation).
> ⚠️ _Annotation du 27/07/2026 : ce bandeau annonçait « 11/11 ». Mesuré ce jour,
> `node scripts/verify-plugin-contract.cjs` rend **12/12** (13 → 12 : `addpoi` a fusionné dans
> `editor` au Sprint 5). Le compte ne se recopie plus —
> il se lit dans la sortie du gate._ La conformité est désormais **exécutoire** : `verify-plugin-contract.cjs --fail`
> en CI et en pre-commit fait échouer toute régression. Le repli rétrocompatibilité S0 (clés racine legacy
> ↔ `modules.<id>`) a été **retiré en S14** : `modules.<id>` est l'unique forme supportée (§5). Plus aucune
> dérogation après ce point sans **RFC acceptée** (§10).

---

## Table des matières

**Partie I — FIGÉ (contrat normatif, modif via RFC)**

- [§0 — Statut, portée et régime figé/vivant](#0--statut-portée-et-régime-figévivant)
- [§1 — Vocabulaire normatif](#1--vocabulaire-normatif)
- [§2 — Les invariants](#2--les-invariants-le-contrat)
- [§3 — Zone d'extension libre](#3--zone-dextension-libre)
- [§4 — Contrat d'enregistrement](#4--contrat-denregistrement)
- [§5 — Configuration par module](#5--configuration-par-module-inv-config)
- [§6 — Mapping des 4 piliers → règles](#6--mapping-des-4-piliers--règles-concrètes)
- [§7 — Une seule classe de plugin](#7--une-seule-classe-de-plugin)
- [§8 — Comment développer un plugin](#8--comment-développer-un-plugin)
- [§9 — Checklist de conformité pré-merge](#9--checklist-de-conformité-pré-merge)
- [§10 — Gouvernance et immuabilité](#10--gouvernance-et-immuabilité)

**Partie II — RÉFÉRENCE / VIVANT (renvois, édition sans RFC)**

- [Annexe A — Séquence de boot B1→B11](#annexe-a--séquence-de-boot-b1b11)
- [Annexe B — API détaillée du registry](#annexe-b--api-détaillée-du-registry)
- [Annexe C — Contrats TypeScript](#annexe-c--contrats-typescript)
- [Annexe D — Helpers de sécurité et événements](#annexe-d--helpers-de-sécurité-et-événements)

---

# Partie I — Contrat figé

## §0 — Statut, portée et régime figé/vivant

### Portée

Cette spécification définit l'**interface** entre un plugin GeoLeaf et le cœur (`@geoleaf/core`). Elle s'applique à **tout** plugin, sans exception — voir §7. Elle ne contraint **jamais** la logique interne d'un plugin (voir §3).

Un **plugin** au sens de ce contrat est un module ESM distinct, chargé séparément du bundle core, qui s'auto-enregistre auprès du `PluginRegistry` et enrichit le namespace public `GeoLeaf.*`. Une **bibliothèque partagée** consommée par plusieurs plugins via une dépendance npm (ex. `@geoleaf-plugins/form-renderer`) n'est **pas** un plugin : elle n'appelle pas `register()` et n'est pas soumise aux invariants `INV-REG`/`INV-NS`/`INV-EXT`.

### Bibliothèques partagées internes (hors contrat)

Une **bibliothèque partagée interne** est un module ESM publié sur npm, importé par **un ou plusieurs plugins** via une dépendance déclarée, qui factorise du code commun (rendu, helpers, types) sans être elle-même un point d'entrée runtime. Elle est **hors du périmètre du Plugin Contract v1**.

**Critères objectifs d'exclusion** — une bibliothèque est hors contrat si elle satisfait **tous** les points suivants :

- elle **n'appelle pas** `register()` (ni `registerLazy()`) ;
- elle **n'enrichit pas** le namespace public `GeoLeaf.*` (pas de `entry.ts` montant un namespace) ;
- sa sortie de build est un **bundle importable** (ex. `geoleaf-<nom>.js`), **jamais** un bundle de plugin auto-chargé (`*.plugin.js`) ;
- elle est tirée par un `import` d'un plugin consommateur, **non** par une balise `<script>` séparée dans la page hôte.

**Invariants non applicables :** `INV-REG`, `INV-NS`, `INV-EXT` (une telle bibliothèque ne s'enregistre pas, n'accède pas au core par namespace et n'a pas de budget de bundle propre au sens plugin). Les invariants `INV-ESM` (ESM pur), `INV-SEC` (helpers de sécurité), `INV-CSS` (injection CSS via le CSSOM) et `INV-FILE` (≤ 700 lignes) **restent de bonnes pratiques recommandées** mais ne sont **pas audités** par le contrat pour ces bibliothèques.

**Liste actuelle :** `@geoleaf/field-renderer` (catalogue de composants de formulaire, modal responsive, bridge, validateurs ; consommée par `editor`). ⚠️ Cette ligne nommait **deux** consommateurs, `editor` et `addpoi`, jusqu'au 08/08/2026 (RFC-003) — `addpoi` a fusionné dans `editor` au Sprint 5 et n'existe plus.

> ⚠️ **Annotation du 27/07/2026 — le paquet cité plus haut n'a jamais porté ce nom.** La
> Portée nomme `@geoleaf-plugins/form-renderer`, qui **n'existe pas** : le paquet s'appelle
> `@geoleaf/field-renderer` et vit sous `packages/libs/`, pas sous `packages/plugins/`. Son
> consommateur `storage` s'appelle `offline-ui` depuis son renommage. Vérifié :
> `node -p "require('./packages/libs/field-renderer/package.json').name"`.

**Enforcement :** ces bibliothèques sont **exclues par construction** du scan `scripts/verify-plugin-contract.cjs` (liste `EXCLUDED_LIBS` + assertion empêchant toute réintroduction dans la table `PLUGINS`).

### Chargement depuis une origine tierce (hors contrat) — RFC-003

Le chargement d'un plugin depuis une **origine tierce, au runtime** — un `import()` visant un
domaine autre que celui de l'application — est **hors du périmètre du Plugin Contract v1**. Le
contrat suppose que tout plugin est servi depuis `'self'`, installé au **build**.

**Ce n'est pas une préférence, c'est une propriété du contrat lui-même** — quatre motifs, chacun
vérifiable :

- **Aucun sandbox, autorité totale.** `INV-REG`/`INV-NS` donnent au plugin l'accès au cœur
  « exclusivement via `globalThis.GeoLeaf.*` », c'est-à-dire **tout** `GeoLeaf.*`, dont `Storage`
  et les jetons du Connector. Une origine tierce hérite de l'autorité d'un plugin du dépôt.
- **SRI est inapplicable.** L'intégrité de sous-ressource se déclare sur une balise
  (`<script integrity>`), jamais sur l'`import()` dynamique par lequel les plugins paresseux se
  chargent.
- **Le registre n'a aucune notion d'origine.** `registerLazy(name, resolver)` prend un
  `LazyResolver`, soit `() => Promise<void>` — une **closure**, jamais une URL. Il n'existe aucun
  point où une origine pourrait être déclarée, vérifiée ou refusée.
- **Coût net au boot.** Un descripteur récupéré au runtime ajoute **une requête sérialisée par
  plugin avant `boot()`** ; un descripteur de build n'en coûte aucune.

⚠️ **Ce qui reste possible, et ne doit pas se lire comme interdit** : installer un plugin tiers.
C'est un **acte de build** — copie du bundle, réécriture de la région bornée, lockfile en
substitut build-time à SRI — après quoi le plugin est servi depuis `'self'` et relève du contrat
comme n'importe quel autre.

**Aucun invariant `INV-*` ne porte cette clause, délibérément** : un invariant énonce une
obligation **vérifiable** sur un plugin, et il n'y a ici rien à vérifier — le registre n'ayant pas
de notion d'origine, aucune gate ne pourrait porter la règle, et elle naîtrait invérifiable. Une
clarification de périmètre dit la même chose sans promettre une garde qui ne peut pas exister.

### Public

- **Auteurs de plugins** (internes ou tiers) — §2 à §9 sont la référence.
- **Mainteneurs du core** — §10 régit l'évolution du contrat.
- **Intégrateurs** — §7 et l'Annexe A décrivent le chargement et le boot.

### Régime figé vs vivant

| Régime     | Sections                                             | Évolution                   |
| ---------- | ---------------------------------------------------- | --------------------------- |
| **FIGÉ**   | §0–§10 (invariants, contrat, gouvernance, checklist) | **RFC obligatoire** (§10)   |
| **VIVANT** | Annexes A–D                                          | Édition libre, suit le code |

La distinction est délibérée : les **schémas, tables de chunks lazy et diagrammes** évoluent à chaque release et n'ont pas vocation à être gelés — seuls les **invariants** le sont. Les annexes **renvoient** aux documents de référence existants plutôt que de les recopier, pour éviter toute divergence.

---

## §1 — Vocabulaire normatif

Les mots-clés **DOIT**, **NE DOIT PAS**, **DEVRAIT**, **NE DEVRAIT PAS**, **PEUT** suivent la convention RFC 2119 (équivalents français de MUST / MUST NOT / SHOULD / SHOULD NOT / MAY).

| Terme              | Définition                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Core**           | Bundle `geoleaf.esm.js` (`@geoleaf/core`, MIT). Toujours chargé. Expose le namespace `globalThis.GeoLeaf.*`.                                                       |
| **Module core**    | Unité interne du core implémentant `ICoreModule`, orchestrée par le `ModuleRegistry` (tri topologique).                                                            |
| **Extension lazy** | Chunk `dist/chunks/*.js` chargé à la demande via `GeoLeaf._loadModule()` / `GeoLeaf.plugins.load()`. Dépend du core uniquement.                                    |
| **Plugin**         | Module ESM distinct (`geoleaf-<nom>.plugin.js`), chargé avant `GeoLeaf.boot()`, qui s'auto-enregistre via `PluginRegistry.register()` et enrichit `GeoLeaf.<Nom>`. |
| **Façade**         | Fichier `geoleaf.*.ts` exposant l'API publique d'un plugin, **sans** logique métier.                                                                               |
| **Namespace**      | Surface publique d'un plugin sur `globalThis.GeoLeaf` (ex. `GeoLeaf.Print`, `GeoLeaf.Storage`).                                                                    |
| **Licence**        | Tout plugin est MIT et publié sur npmjs.org en accès public (`publishConfig.access: "public"`). Le contrat ne connaît qu'une seule classe de plugin — voir §7.     |
| **PluginRegistry** | Registre runtime des plugins (`GeoLeaf.plugins.*`). Source : `built-in/api/plugin-registry.ts`.                                                                    |
| **ModuleRegistry** | Orchestrateur du cycle de vie des modules core (`GeoLeaf.registry`). Source : `app/module-registry.ts`.                                                            |

---

## §2 — Les invariants (le contrat)

Ce sont les **règles immuables**. Chaque invariant porte un identifiant stable, citable en revue de code et en RFC, et indique les piliers qu'il sert.

| ID             | Énoncé normatif                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Piliers                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **INV-REG**    | Un plugin **DOIT** s'auto-enregistrer via `globalThis.GeoLeaf.plugins.register(name, meta)` (voir §4). `name` **DOIT** être unique et stable dans le temps. `meta` **DOIT** porter `version`, `label`, `healthCheck` ; `requires`/`optional` **DOIVENT** être déclarés dès qu'il existe une dépendance.                                                                                                                                                                                               | Maintenabilité, Évolution           |
| **INV-ESM**    | Un plugin **DOIT** être un module ESM pur (`"type": "module"`). Il **NE DOIT PAS** contenir de `require()`, `module.exports` ni aucune syntaxe CommonJS dans `src/`.                                                                                                                                                                                                                                                                                                                                  | Performance, Maintenabilité         |
| **INV-NS**     | Un plugin **DOIT** accéder au cœur **exclusivement** via `globalThis.GeoLeaf.*` et enrichir un namespace dédié `GeoLeaf.<Nom>`. Il **NE DOIT PAS** importer statiquement l'implémentation concrète d'un module core (seuls les **types** des contrats `src/contracts/` PEUVENT être importés en `import type`).                                                                                                                                                                                       | Maintenabilité, Évolution           |
| **INV-BOOT**   | Un plugin **DOIT** être chargé **après** `geoleaf.esm.js` et **avant** `GeoLeaf.boot()`, ou enregistré en lazy (`registerLazy`). Il **NE DOIT PAS** appeler `GeoLeaf.boot()` lui-même.                                                                                                                                                                                                                                                                                                                | Performance, Maintenabilité         |
| **INV-SEC**    | Tout HTML / SVG / URL issu de données externes ou de saisie utilisateur **DOIT** passer par `GeoLeaf.Security.*` ou `GeoLeaf.DOMSecurity.*`. Un plugin **NE DOIT JAMAIS** écrire `innerHTML` brut, ni injecter une URL non validée dans un `href`/`src`.                                                                                                                                                                                                                                              | Sécurité                            |
| **INV-CSS**    | Un plugin **DOIT** injecter sa CSS de façon compatible avec une CSP `style-src` stricte (`'self'`, sans `'unsafe-inline'`) : via le **CSSOM** — constructable stylesheets (`new CSSStyleSheet().replaceSync(css)` + `document.adoptedStyleSheets`) ou `element.style.setProperty` / `GeoLeaf.Helpers.applyCssText`. Il **NE DOIT JAMAIS** créer un `<style>` (`document.createElement("style")`, ni le `styleInject` du bundler via `postcss({ inject: true })`) ni poser un attribut `style` inline. | Sécurité                            |
| **INV-FRONT**  | Le core (`packages/core/src/`) et `plugin-connector` **NE DOIVENT JAMAIS** référencer un plugin (`@geoleaf-plugins/*`) **ni déclarer/valider/défaut-er sa configuration**. Frontière d'**architecture**, pas de licence : le core reste autonome et tree-shakeable quelle que soit la licence des plugins. Vérifiée en CI, en pre-commit et dans `ci:local`.                                                                                                                                          | Architecture, Évolution             |
| **INV-CONFIG** | La configuration d'un plugin **DOIT** vivre sous `modules.<pluginId>` dans le profil et être lue via `GeoLeaf.Config.get("modules.<pluginId>.<clé>")`. Le core **NE DOIT PAS** connaître les clés de config d'un plugin (voir §5).                                                                                                                                                                                                                                                                    | Maintenabilité, Évolution, Sécurité |
| **INV-DEP**    | Un plugin **DOIT** déclarer ses dépendances (`requires`/`optional`). Il **NE DOIT PAS** s'activer si un `requires` est absent (`GeoLeaf.plugins.canActivate()`), et **DOIT** dégrader gracieusement l'absence d'un `optional` (guard runtime).                                                                                                                                                                                                                                                        | Maintenabilité, Évolution           |
| **INV-EVT**    | Un plugin **DOIT** communiquer avec le cœur et les autres plugins via les événements publics typés (`GeoLeafEventMap`, dispatchés sur `document`). Il **NE DOIT PAS** dépendre d'événements internes non documentés.                                                                                                                                                                                                                                                                                  | Évolution                           |
| **INV-FILE**   | Tout fichier source d'un plugin (`.ts` / `.js` / `.css`) **DOIT** rester ≤ **700 lignes** (cible souple 500).                                                                                                                                                                                                                                                                                                                                                                                         | Maintenabilité                      |
| **INV-FACADE** | L'API publique d'un plugin **DOIT** être exposée par une façade (`geoleaf.<nom>.ts` / `public-api.ts`) séparée de l'implémentation. La façade **NE DOIT PAS** contenir de logique métier.                                                                                                                                                                                                                                                                                                             | Maintenabilité, Évolution           |
| **INV-EXT**    | Un plugin **DOIT** externaliser MapLibre GL JS (peer dependency, hors bundle) lorsqu'il l'utilise. Il **NE DOIT PAS** le bundler. Aucune dépendance lourde **NE DEVRAIT** entrer dans le bundle sans contrôle de budget.                                                                                                                                                                                                                                                                              | Performance                         |

> **Règle de lecture :** un invariant énonce une obligation **interface**. Tout ce qui n'est pas explicitement gelé ici relève de la **zone d'extension libre** (§3).

---

## §3 — Zone d'extension libre

La spec contraint l'**interface** avec le cœur, **jamais l'intérieur** du plugin. Tant que les invariants du §2 sont respectés, un plugin développe **librement** :

- **Logique métier** : algorithmes, formats de données, intégrations backend, dialectes de requêtes (REST, OGC, WebSocket…).
- **Structure interne** : découpage en sous-modules, gestion d'état (`StateManager`), renderers, helpers privés.
- **UI** : modales, boutons toolbar (descripteurs `mobileIcon`/`desktopTabButton`), styles CSS, internationalisation (`GeoLeaf.I18n.registerDict`).
- **Dépendances internes** : toute dépendance npm propre, sous réserve du budget bundle (§6, INV-EXT).
- **Versionnement** : le plugin gère son propre semver de package, **indépendant** du `Plugin Contract v1`.

> Cette zone n'est **pas** soumise à RFC. Un auteur de plugin la fait évoluer à sa guise.

---

## §4 — Contrat d'enregistrement

Source de vérité : `packages/core/src/kernel/api/plugin-registry.ts`.

> ⚠️ _Annotation du 27/07/2026 : ce chemin citait `src/modules/built-in/api/` — **`src/modules/`
> n'existe plus**, il a été éclaté en quatre racines (`kernel/`, `capabilities/`, `api/`,
> `app/`). Le contrat lui-même est inchangé ; seul son adresse l'était._

### Signature figée

```typescript
GeoLeaf.plugins.register(name: string, meta: {
    version: string;                 // version DU PLUGIN (injectée au build), JAMAIS GeoLeaf._version
    label: string;                   // nom lisible (toasts, rapports)
    healthCheck: () => boolean;       // vrai quand l'API publique du plugin est opérationnelle
    requires?: string[];             // dépendances obligatoires (ex. ["core"])
    optional?: string[];             // dépendances optionnelles (ex. ["storage"])
}): void;
```

### Squelette canonique `entry.ts` (FIGÉ pour la forme, libre pour le contenu)

```typescript
// 1. i18n d'abord (les libellés doivent être résolus avant le rendu de la toolbar)
_g.GeoLeaf?.I18n?.registerDict?.("mon-plugin", { fr: langFr, en: langEn /* … */ });

// 2. Montage de la façade publique sur un namespace dédié (INV-NS, INV-FACADE)
if (_g.GeoLeaf) _g.GeoLeaf.MonPlugin = buildPublicApi();

// 3. Auto-enregistrement (INV-REG)
_g.GeoLeaf?.plugins?.register("mon-plugin", {
    version: "__GEOLEAF_VERSION__", // remplacé au build par @rollup/plugin-replace (pkg.version)
    label: "Mon Plugin",
    requires: ["core"],
    optional: ["storage"],
    healthCheck: () => typeof _g.GeoLeaf?.MonPlugin === "object",
});
```

> ⚠️ **Correctif normatif.** Les exemples historiques utilisaient `version: globalThis.GeoLeaf._version` — c'est la version **du core**, pas du plugin : le registre rapporte alors une fausse version. La forme figée **DOIT** injecter la version du plugin via le token de build `__GEOLEAF_VERSION__` (token **unique**, identique pour tous les plugins).

### Lazy (PEUT)

Un plugin **PEUT** s'enregistrer en lazy pour ne charger son code qu'à l'activation d'une action toolbar : `GeoLeaf.plugins.registerLazy(name, resolver)`. Voir l'Annexe B.

L'événement `geoleaf:plugin:loaded` est émis après `register()`. La liste des plugins chargés est lisible via `GeoLeaf.plugins.getLoadedPlugins()`.

---

## §5 — Configuration par module (INV-CONFIG)

### Principe figé

La configuration propre à un plugin **DOIT** être isolée sous une clé `modules.<pluginId>` dans le profil, et **NE DOIT PAS** être déclarée, validée ou dotée de valeurs par défaut dans le core.

```jsonc
// profiles/<profil>/profile.json
{
    "id": "tourism",
    "map": {
        /* … cœur … */
    },
    "ui": {
        /* … cœur … */
    },

    "modules": {
        "storage": { "enableOfflineDetector": false, "cache": { "enableProfileCache": true } },
        "addpoi": {
            "enabled": true,
            "defaultPosition": "geolocation",
            "submitEndpoint": "https://…",
        },
        "print": { "enabled": true, "format": "A4", "dpi": 300 },
        "measure": { "enabled": true, "units": "metric" },
    },
}
```

### Lecture côté plugin (FIGÉ)

```typescript
const enabled = GeoLeaf.Config.get("modules.addpoi.enabled", true);
```

### Pourquoi (rationnel)

1. **Casse le couplage core → plugin.** Aujourd'hui `config-types.ts` déclare `poiAddConfig` _(plugin-addpoi)_, `printConfig`, `measureConfig`, `editorConfig`, `storage` : le core « connaît » la config de ses plugins, en violation de l'esprit d'`INV-FRONT`. `modules.*` rend chaque plugin **propriétaire** de sa config.
2. **Profils auto-documentés.** Un coup d'œil au bloc `modules` suffit à voir quels modules sont configurés et comment, au lieu de clés plates dispersées à la racine.
3. **Validation par plugin possible.** Ouvre la voie à un futur `GeoLeaf.plugins.registerConfigSchema(pluginId, schema, defaults)` : le plugin valide ses propres clés, le core n'a rien à savoir.

### Migration (cadre) — **terminée en S14**

Pendant la convergence (S0→S13), le core lisait `modules.<id>.*` avec un **repli** sur l'ancienne clé racine (miroir bidirectionnel S0, dépréciation annoncée au CHANGELOG). **En clôture S14, ce repli et les interfaces de clés racine dépréciées de `config-types.ts` (`poiAddConfig`, `printConfig`, `measureConfig`, `editorConfig`, `storage`) ont été retirés** : `modules.<id>.*` est désormais l'**unique** forme supportée, lue via `GeoLeaf.Config.getModuleConfig(id, key, default)`. Le schéma JSON reste permissif (`additionalProperties: true`) à la racine mais **décrit** la structure `modules.*`.

---

## §6 — Mapping des 4 piliers → règles concrètes

### Performance

- **INV-EXT** : MapLibre GL externalisé (peer), hors bundle.
- **Lazy loading** du code non requis au boot via `registerLazy` / `registerLazyForAction`.
- **Budget bundle** : la métrique de boot du core est le **boot payload** (l'entrée + la clôture transitive de ses imports statiques), gardé par `scripts/check-bundle-size.cjs`. La spec **ne grave aucun chiffre** — le seuil vit dans le script (**source unique**). Toute nouvelle dépendance d'un plugin est évaluée via `npm run size`.

### Sécurité

- **INV-SEC** : `GeoLeaf.Security.*` obligatoire pour tout contenu externe ; jamais d'`innerHTML` brut → `createSafeElement`, `parseHtmlSafely`, `sanitizeHTML`, `DOMSecurity.setTextContent`.
- **Adaptateur non sanitisant** : `content` de popup et `icon` de marqueur (`IMapAdapter`) **DOIVENT** être statiques ou pré-sanitisés (l'adaptateur ne sanitise pas).

### Évolution

- **INV-FRONT** : isolation d'architecture et de config — le core ignore les plugins, ce qui le laisse autonome et tree-shakeable. Vérifiée en CI, en pre-commit et dans `ci:local` (`verify-core-standalone.cjs`).
- **Versioning du contrat** (`Plugin Contract vN`) découplé du semver du package plugin.
- **INV-EVT** : les événements publics typés (`GeoLeafEventMap`) sont le **seul** canal de communication stable.
- **Politique de dépréciation** : tout champ/événement public déprécié **DOIT** être annoncé au `CHANGELOG` (section Breaking) et au guide de migration **avant** retrait.
- **INV-NS** : coder contre les contrats (`import type` depuis `src/contracts/`), jamais contre une implémentation.

### Maintenabilité

- **INV-FILE** (≤ 700 l) + **INV-FACADE** (séparation façade/implémentation).
- **Squelette canonique** (§8) et ordre d'implémentation imposé : contrats → logique → façade → tests.
- **Un CDC par plugin** (`CDC_plugin-<nom>.md`), document **vivant** distinct de cette spec figée.

---

## §7 — Une seule classe de plugin

**Il n'existe qu'une classe de plugin.** Tout plugin est **MIT**, publié sur **npmjs.org en accès public**, et suit le même contrat d'enregistrement, le même mode de chargement et le même accès au cœur. Le manifeste ne porte aucun champ de classement : `type` a été retiré du contrat d'enregistrement ([RFC-002](../rfc/RFC_002_retrait-champ-type.md)).

Le packaging est donc uniforme :

| Aspect                            | Tous les plugins                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Licence**                       | `package.json.license: "MIT"`                                                                                                                |
| **Registre**                      | `publishConfig` → npmjs.org, `access: public`                                                                                                |
| **Partage de code inter-plugins** | autorisé **via dépendance npm déclarée** (ex. `@geoleaf/field-renderer`, `@geoleaf/host-runtime`), jamais par réécriture de chemins au build |

> Un plugin **NE DOIT PAS** introduire de divergence d'architecture (build, enregistrement, accès au cœur). Toute mécanique de build spécifique au-delà du packaging — par exemple l'inline de modules core par réécriture de chemins Rollup — est une **divergence à résorber**.
>
> ✅ **Annotation du 27/07/2026 — le seul exemple connu de cette divergence est RÉSORBÉ.** Le
> plugin Rollup de réécriture de chemins qui inlinait des modules core rend **0 occurrence** sur
> `packages/` et `scripts/`. La **règle** reste en vigueur ; c'est son exemple qui a disparu.
> _(Mode d'échec n° 6 du pré-vol : re-vérifier le motif, pas seulement la cible.)_

---

## §8 — Comment développer un plugin

> Section pédagogique (régime VIVANT — peut s'enrichir sans RFC, mais sans contredire la Partie I figée).

### Structure de dossiers canonique

```
packages/plugins/<nom>/
├── package.json          # "type":"module", license, publishConfig, peerDep maplibre-gl si --map
├── tsconfig.json
├── rollup.config.mjs      # input src/entry.ts, external @geoleaf/core (+ maplibre-gl), sortie dist/geoleaf-<nom>.plugin.js
├── vitest.config.ts       # happy-dom, coverage istanbul ≥ 75 %
├── README.md
├── LICENSE
└── src/
    ├── entry.ts           # SEUL point d'entrée : i18n → façade → register()  (INV-REG)
    ├── public-api.ts      # buildPublicApi() — façade publique  (INV-FACADE)
    ├── types.ts           # types publics réexportés
    ├── <feature>/         # logique métier (zone libre §3, fichiers ≤ 700 l)
    ├── lang/              # i18n lang_fr…lang_de (si libellés)
    ├── css/              # styles (UNIQUEMENT si plugin UI)
    └── __tests__/         # tests co-localisés
```

> La présence de `css/` (plugin UI) et la profondeur du `healthCheck` (surface simple vs multi-modules) sont des **variations légitimes** selon la nature du plugin — pas des écarts.

### Étapes pas-à-pas

1. **CDC d'abord** (Gate 1) : rédiger `_docs_projet/travail/cdc/CDC_plugin-<nom>.md`.
2. **Implémenter dans l'ordre** : contrats consommés (`import type`) → logique métier → façade `public-api.ts` → tests.
3. **`entry.ts`** : enregistrer les dictionnaires i18n, monter la façade sur `GeoLeaf.<Nom>`, appeler `register()` (forme §4). Déclarer les slots UI (`registerLazyForAction` si lazy).
4. **Dégradation gracieuse** : garder chaque dépendance `optional` (mode dégradé si absente).
5. **Config** : lire via `GeoLeaf.Config.get("modules.<id>.*")` (INV-CONFIG) — jamais de clé racine ni de défaut dans le core.
6. **Valider la checklist §9**, mettre à jour CDC + CHANGELOG + DOC_TRACKER.

> ⚠️ _Annotation du 08/08/2026 (S11.4) — **deux adresses de cette liste sont mortes**, et une
> consigne qui envoie vers un fichier inexistant est pire qu'une consigne absente : elle fait
> conclure à la relecture suivante que la surface a disparu._
>
> - **Étape 1** — les CDC de plugin ne vivent plus sous `_docs_projet/travail/cdc/`, **répertoire
>   supprimé** à la refonte documentaire V3 du 27/07/2026. Adresse réelle :
>   `docs/specs/plugins/CDC_<nom>.md` (12 fiches sur 12 écrites).
> - **Étape 6** — **`DOC_TRACKER.md` n'existe plus** : supprimé le 27/07/2026, son contenu fusionné
>   dans `_docs_projet/ETAT.md` (voir `ETAT.md:9` et la ligne **B-34** du registre, soldée le
>   29/07/2026 « pour moitié par disparition »). Lire « CDC + CHANGELOG + `ETAT.md` ».
>
> _Le régime §10 interdit de réécrire la Partie I sans RFC ; **annoter n'est pas modifier un
> invariant** — même geste que les annotations du 27/07/2026 au §10 et au §7. Le processus décrit
> est inchangé, seules ses adresses l'étaient._

---

## §9 — Checklist de conformité pré-merge

Chaque case est mappée sur un invariant ou un garde-fou CI.

- [ ] `register()` appelé avec `meta` complète, `name` unique — **INV-REG**
- [ ] ESM pur, aucun `require()`/CJS dans `src/` — **INV-ESM**
- [ ] Accès au cœur uniquement via `globalThis.GeoLeaf.*`, namespace dédié, pas d'import d'implémentation core — **INV-NS**
- [ ] Chargé après core / avant boot (ou lazy) ; aucun appel à `boot()` — **INV-BOOT**
- [ ] Tout HTML/URL externe passé par `GeoLeaf.Security.*` ; zéro `innerHTML` brut — **INV-SEC**
- [ ] CSS injectée via le CSSOM (constructable stylesheets / `applyCssText`) ; aucun `<style>` ni `postcss({ inject: true })` — **INV-CSS** (PC-13)
- [ ] Aucune référence à un plugin dans le core ; `verify-core-standalone` vert — **INV-FRONT**
- [ ] Config sous `modules.<id>` ; lue via `Config.get("modules.<id>.*")` ; rien dans le core — **INV-CONFIG**
- [ ] `requires`/`optional` déclarés + guards de dégradation — **INV-DEP**
- [ ] Communication via événements typés `GeoLeafEventMap` — **INV-EVT**
- [ ] Tous fichiers source ≤ 700 lignes — **INV-FILE**
- [ ] Façade séparée de l'implémentation — **INV-FACADE**
- [ ] MapLibre externalisé ; `npm run size` dans le budget — **INV-EXT**
- [ ] CDC à jour, CHANGELOG + DOC_TRACKER renseignés

> ⚠️ _Annotation du 08/08/2026 (S11.4) — la dernière case demande de renseigner **`DOC_TRACKER.md`,
> qui n'existe plus** depuis le 27/07/2026 (fusionné dans `_docs_projet/ETAT.md`). Lire la case
> comme « CDC à jour, CHANGELOG + `ETAT.md` renseignés ». La case elle-même n'est pas réécrite : le
> régime §10 réserve cela à une RFC, et c'est son ADRESSE qui est fausse, pas son exigence._
>
> 📌 _Cette checklist porte par ailleurs le seul invariant sans numéro `PC-` exécutoire —
> **`INV-CONFIG`** —, et c'est mesurément ce qui lui a permis de dériver : **4 plugins livrés le
> violent** (`geocoding`, `measure`, `print`, `editor`, ce dernier avec les deux conventions dans
> le même fichier). Suivi en **B-175**. ⚠️ **L'ordre y est contraignant** : migrer les 4 plugins
> d'abord, promouvoir la gate ensuite — l'inverse fait naître une gate rouge._

---

## §10 — Gouvernance et immuabilité

### Ce qui est figé

La **Partie I** (§0–§10), le **numéro de contrat** `Plugin Contract v1` et la **checklist §9**. Modifier un invariant, le contrat d'enregistrement ou la gouvernance **exige une RFC acceptée**.

### Ce qui reste vivant

Les **annexes A–D**, les **CDC par plugin**, les documents de référence (boot, contrats TS, registry), et la **valeur** des seuils de budget (pilotée par `check-bundle-size.cjs`).

### Processus RFC (léger)

1. Créer `docs/specs/rfc/RFC_{NNN}_{slug}.md` (cycle : **Brouillon → En revue → Acceptée / Rejetée → Appliquée**).
    > ⚠️ _Annotation du 27/07/2026 : ce chemin disait `_docs_projet/rfc/`. Les RFC vivent sous
    > `specs/rfc/` — c'est le régime « gelé » qui les accueille, et le lien vers RFC-002 au §7
    > pointait lui aussi à côté (`../../../rfc/`). Le processus est inchangé, seule son adresse
    > l'était._
2. La RFC référence l'`INV-*` ou la section visée, et la raison du changement.
3. Une RFC **Acceptée** est la **seule** autorisation d'éditer la Partie I. Toute PR modifiant la Partie I sans `RFC_*` lié et accepté **doit être rejetée en revue**.
4. La RFC appliquée met à jour le **journal des versions** ci-dessous.

### Versioning de cette spec

| Composante      | Incrément                                     | Déclencheur                     |
| --------------- | --------------------------------------------- | ------------------------------- |
| `Z` (1.0.**Z**) | rédactionnel, annexes                         | sans RFC                        |
| `Y` (1.**Y**.0) | invariant ajouté **non cassant**              | RFC légère                      |
| `X` (**X**.0.0) | changement cassant → **Plugin Contract vN+1** | RFC + nouveau numéro de contrat |

### Journal des versions

| Version | Contrat            | Date       | RFC             | Changement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ------------------ | ---------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.0   | Plugin Contract v1 | 2026-06-08 | —               | Gel initial. Consolidation des fondateurs, ajout `INV-CONFIG`, correctif version d'enregistrement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1.3.0   | Plugin Contract v1 | 2026-06-21 | RFC-001         | Ajout de l'invariant `INV-CSS` (injection CSS des plugins via le CSSOM, jamais `<style>`) + check exécutoire `PC-13`. Non cassant — 11/11 plugins déjà conformes (post-B.7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1.4.0   | Plugin Contract v1 | 2026-07-19 | RFC-002         | Retrait du champ de manifeste `type` du contrat d'enregistrement et de `PC-03` : il n'avait plus aucun lecteur après la fusion des deux rapports console, et les deux listes de noms codées en dur qui les alimentaient contredisaient la valeur déclarée, en sens inverse l'une de l'autre. Non cassant — exigence retirée, 13/13 plugins conformes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1.4.1   | Plugin Contract v1 | 2026-07-27 | — (annotations) | **Sortie du dossier de tri, refonte documentaire V3.** Partie I **annotée, NON réécrite** (le régime §10 l'interdit sans RFC ; annoter n'est pas modifier un invariant). Six énoncés factuels étaient faux : bandeau « 11/11 plugins » (mesuré **13/13**) · `@geoleaf-plugins/form-renderer` **n'existe pas** — c'est `@geoleaf/field-renderer`, sous `packages/libs/`, et son consommateur `storage` s'appelle `offline-ui` · §4 citait `src/modules/built-in/api/`, **racine supprimée** · §7 exigeait de résorber un plugin Rollup de réécriture de chemins qui a **0 occurrence** dans le dépôt — la contrainte est tombée, la règle reste · §8 montrait le layout plat `packages/plugin-<nom>/` · §10 et le lien RFC-002 pointaient `_docs_projet/rfc/` au lieu de `specs/rfc/`. Annexe D (vivante) : 2 chemins `src/modules/` corrigés. Aucun invariant touché, aucune RFC nécessaire.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1.5.0   | Plugin Contract v1 | 2026-08-08 | RFC-003         | **Périmètre d'origine explicité, et solde du champ `type`.** **(1)** §0 gagne une sous-section « Chargement depuis une origine tierce (hors contrat) », sœur de celle des bibliothèques partagées : un plugin chargé au runtime depuis un domaine tiers est hors périmètre — aucun sandbox (`INV-NS` donne tout `GeoLeaf.*`, dont `Storage` et les jetons du Connector), SRI inapplicable à l'`import()` dynamique, et `registerLazy` ne prend qu'une **closure** (`LazyResolver = () => Promise<void>`), jamais une URL : le registre n'a aucune notion d'origine. **Aucun `INV-*` ne porte la clause, délibérément** — un invariant énonce une obligation vérifiable, et aucune gate ne pourrait porter celle-ci. L'installation d'un plugin tiers reste un **acte de build**, servi depuis `'self'`. **(2)** `INV-REG` n'exige plus `type` : **RFC-002 l'avait retiré du §4, de `PC-03`, des types du core, des 13 `entry.ts` et du gabarit — mais pas du tableau des invariants**, que sa ligne Cible ne nommait pas. L'invariant contredisait donc l'exemple canonique du §4, dans ce même document. Non cassant : une exigence morte retirée. **(3)** `field-renderer` ne liste plus qu'un consommateur (`addpoi` a fusionné dans `editor` au Sprint 5). ⚠️ **Le pré-vol de la RFC a infirmé un tiers de son énoncé d'origine** : les « 2 chemins morts `modules/built-in/` » à corriger l'avaient **déjà été le 27/07**, et la correction était tracée dans ce journal même (v1.4.1) — mode d'échec n° 4, visible en relisant le document et non le code. Le numéro de ligne de `INV-REG` était faux aussi (`:117` → `:126`). **(4)** Ordre du présent journal corrigé : **1.4.1 précédait 1.4.0**. |

---

# Partie II — Référence (vivant)

> Les annexes **renvoient** aux documents descriptifs maintenus à jour avec le code. Elles ne sont **pas** gelées.

## Annexe A — Séquence de boot B1→B11

Diagramme de séquence complet, phases 1→11, points de synchronisation (promises + événements DOM), modes d'initialisation profil :
→ [`INITIALIZATION_FLOW.md`](INITIALIZATION_FLOW.md).

Repères utiles aux plugins : un plugin s'enregistre en **phase 1.5** (avant `boot()`) ; le storage s'initialise en **phase 7.5** ; `geoleaf:map:ready` puis `geoleaf:app:ready` sont émis en **phase 11**.

## Annexe B — API détaillée du registry

`PluginRegistry` (`GeoLeaf.plugins.*`) — structure `PluginEntry`, méthodes (`register`, `registerLazy`, `isLoaded`, `canActivate`, `load`, `getLoadedPlugins`, `getInfo`…), événements, et table des chunks lazy :
→ [`PLUGIN_REGISTRY_BOOT.md`](PLUGIN_REGISTRY_BOOT.md).

## Annexe C — Contrats TypeScript

Interfaces `ICoreModule`, `IModuleRegistry`, `IModuleUISlot`, `IMapAdapter`, `IGeoLeafConfig`, `IConnector`, règles de dépendances Core → Extension → Plugin, et implémentation d'un `ICoreModule` :
→ [`MODULE_CONTRACT.md`](MODULE_CONTRACT.md) (source de vérité : `packages/core/src/contracts/`).

## Annexe D — Helpers de sécurité et événements

- **Sécurité** : `GeoLeaf.Security.*` (`sanitizeHTML`, `escapeHtml`, `escapeAttribute`, `validateUrl`, `validateCoordinates`, `containsDangerousHtml`, `stripHtml`, `createSafeElement`, `sanitizeSvgContent`, `validateNumber`, `parseHtmlSafely`) et `GeoLeaf.DOMSecurity.*` (`setTextContent`, `setSafeHTML`, `clearElement`, `createSVGIcon`). Source : `packages/core/src/kernel/security/index.ts`.
- **Événements typés** : `GeoLeafEventMap` (lifecycle `geoleaf:config:loaded`, `geoleaf:profile:loaded`, `geoleaf:theme:applied`, `geoleaf:map:ready`, `geoleaf:app:ready` ; plugins `geoleaf:plugin:loaded`/`:lazy-loaded`/`:failed`). Source : `packages/core/src/api/geoleaf.events.ts` (carte typée : `packages/core/src/contracts/event-bus.contract.ts`).

---

**Dernière mise à jour :** 12 juin 2026 (doc v1.1.0 — §0 : sous-section « Bibliothèques partagées internes » clarifiant le statut hors-contrat de `form-renderer` ; Sprint S13. Clarification de portée, aucun invariant modifié — pas de RFC.)
**Version GeoLeaf :** 2.0.0 — Platform V2 · **Plugin Contract v1 (figé)**
