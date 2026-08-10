# GeoLeaf-JS — Module Contract (v3.0.0)

**Version produit :** GeoLeaf Platform V3
**Source de vérité :** `packages/core/src/contracts/`
**Vérifié contre :** `16e5a451` (27/07/2026)

> **Annexe de référence du [Plugin Contract v1](PLUGIN_ARCHITECTURE_SPEC.md).** Document
> **descriptif et vivant** — il suit le code. Les règles **normatives figées** vivent dans
> [`PLUGIN_ARCHITECTURE_SPEC.md`](PLUGIN_ARCHITECTURE_SPEC.md) ; en cas de divergence, la
> spec prévaut.

> ⚠️ **Réécrit le 27/07/2026 — la version 2.0.0 décrivait une couche d'architecture
> supprimée.** Elle était bâtie sur trois niveaux « Core / **Extensions lazy** / Plugins »,
> avec une table de 12 clés `_loadModule()` pointant des fichiers `src/lazy/*.ts`. Or
> `packages/core/src/bundle-esm-entry.ts:20` acte que **`GeoLeaf._loadModule` et
> `GeoLeaf._loadAllSecondaryModules` sont supprimés (BREAKING, S5)**, et le répertoire
> `src/lazy/` n'existe pas. Un tiers du document enseignait donc une API absente — dont une
> procédure « Ajout d'un nouveau module lazy » en quatre étapes, inexécutable. Le reste
> citait `src/modules/built-in/*`, racine éclatée depuis, et ne connaissait que **2 plugins**
> sur les 13 publiés.

---

## Les trois niveaux — tels qu'ils sont

```
┌────────────────────────────────────────────────────────────────────┐
│  KERNEL              packages/core/src/kernel/ + globals/ + app/   │
│  Toujours dans le graphe. Le retirer casse le boot. Aucune gate.   │
├────────────────────────────────────────────────────────────────────┤
│  CAPACITÉ IN-CORE    packages/core/src/capabilities/<id>/          │
│  Auto-contenue (logique + CSS + tests + déclaration + façade).     │
│  Embarquée si son `install.ts` est dans le manifeste du preset.    │
│  Gate `modules.<id>`, posture OPT-OUT. Tree-shakeable — CSS compris.│
├────────────────────────────────────────────────────────────────────┤
│  PLUGIN              packages/plugins/<nom>/                       │
│  Paquet npm SÉPARÉ. Chargé AVANT `GeoLeaf.boot()`, s'auto-enregistre│
│  dans le `PluginRegistry`. Enrichit `GeoLeaf.<Plugin>.*`.          │
└────────────────────────────────────────────────────────────────────┘
```

**La différence qui compte** (ADR-09) : un **module** participe à l'ordre d'initialisation —
il déclare ses `dependencies` et le `ModuleRegistry` les résout par tri topologique. Un
**plugin** n'y participe pas : son enregistrement est plat, ce sont des métadonnées.

⚠️ **Il n'y a plus de « chargement à la demande » par répertoire.** Ce qui est lazy, ce sont
uniquement des `import()` dynamiques ponctuels. Le tree-shaking d'une capacité ne passe plus
par un build qui saute un répertoire, mais par le fait que **l'installer possède son CSS et le
tire lui-même** dans le graphe : ne pas l'importer retire le code _et_ la feuille de style
(ADR-06).

Les listes ne se recopient pas — elles se lisent :

```bash
ls packages/core/src/kernel/            # les sous-systèmes du kernel
ls packages/core/src/capabilities/      # les capacités in-core
ls packages/plugins/                    # les plugins publiés
```

Le **registre réel** des capacités n'est pas le système de fichiers : c'est
`packages/core/src/presets/manifest.full.ts`. Une capacité absente de ce tableau n'est pas
embarquée, et **l'ordre y est porteur**.

---

## Contrats TypeScript — `src/contracts/`

Les interfaces de `packages/core/src/contracts/` définissent les frontières publiques entre
couches. Aucun module métier ne contourne un contrat en important directement une
implémentation concrète d'un autre module.

⚠️ **Ce document ne recopie aucune signature.** Elles sont dérivées du TSDoc par TypeDoc, et
les recopier ici créerait un second exemplaire qui divergerait. La liste réelle :

```bash
ls packages/core/src/contracts/
```

**Ce sont des surfaces de types PURES** : aucun export de valeur, aucun import non-type,
aucune instruction top-level. Gaté par `scripts/check-contracts-pure.cjs`, en pre-commit
comme dans `ci:local`. C'est ce gate qui a arrêté la dérive « membrane » où des contrats
s'étaient mis à exporter des singletons faisant des lookups `globalThis`.

**Six contrats sont publiés** en sous-chemins `types`-seuls, atteignables par un plugin tiers :
`core-module`, `capability`, `config`, `map-adapter`, `layer-data`, `event-bus`
(`@geoleaf/core/contracts/<nom>.contract.js`). On en ajoute quand on veut ; **on n'en retire
jamais**.

---

## Règles de dépendances

| Règle                                                                            | Statut                                                                                          | Gate                                                              |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/core/src/` → `@geoleaf-plugins/*`                                      | **INTERDIT**                                                                                    | `scripts/verify-core-standalone.cjs` — CI, pre-commit, `ci:local` |
| `capabilities/**` → import profond sous `kernel/**`                              | **INTERDIT**                                                                                    | règle ESLint **R.8**                                              |
| `capabilities/**` → baril `kernel/<domaine>/index.ts`, hub `*-types.ts`, ou seam | autorisé                                                                                        | —                                                                 |
| `capabilities/**` → `adapters/maplibre/*`, `app/`                                | **INTERDIT**                                                                                    | ESLint                                                            |
| kernel → `capabilities/**`                                                       | **INTERDIT** — le kernel est le substrat                                                        | —                                                                 |
| plugin → core                                                                    | via le **namespace global** ou les 6 sous-chemins `types`, jamais par un alias vers les sources | `verify-plugin-core-boundary`                                     |
| plugin → plugin                                                                  | autorisé **via dépendance npm déclarée**, jamais par réécriture de chemins au build             | `PLUGIN_ARCHITECTURE_SPEC.md` §7                                  |
| core → `@geoleaf/host-runtime`                                                   | **INTERDIT** — la dépendance est à sens unique                                                  | ADR-11                                                            |

⚠️ **`no-plugin-in-core` est une frontière d'ARCHITECTURE.** Elle garantit que le core reste
**autonome et tree-shakeable**, et ne dépend d'aucune propriété des plugins autre que le fait
qu'ils sont des plugins (ADR-02).

**L'élargissement d'un baril de médiation est le geste que R.8 DÉSIGNE**, pas un
contournement — mais il est explicite et se motive sur place, dans le baril.

---

## Implémenter un module

⚠️ **`ICoreModule` est une UNION**, pas une interface :

```typescript
// packages/core/src/contracts/core-module.contract.ts:373
export type ICoreModule = ILifecycleModule | IUISlotModule;
```

TypeScript refuse `implements` sur une union : une classe de cycle de vie déclare donc
**`implements ILifecycleModule`**. Ce n'est pas un détail de style — `ICoreModule` déclarait
autrefois `dependencies`/`init`/`destroy` comme obligatoires alors que
`ModuleRegistry.register()` accepte depuis toujours un simple `{id, ui}` : publier le contrat
tel quel aurait rejeté huit sites d'appel réels.

```typescript
import type { ILifecycleModule } from "@geoleaf/core/contracts/core-module.contract.js";
import type { IMapAdapter } from "@geoleaf/core/contracts/map-adapter.contract.js";
import type { IGeoLeafConfig } from "@geoleaf/core/contracts/config.contract.js";

export class MonModule implements ILifecycleModule {
    readonly id = "mon-module";
    readonly dependencies = ["geojson"]; // résolu par tri topologique (Kahn)

    async init(adapter: IMapAdapter, config: IGeoLeafConfig): Promise<void> {
        /* tout ce qui a besoin de l'adapter ou de la config FUSIONNÉE */
    }

    async destroy(): Promise<void> {
        /* teardown symétrique */
    }
}
```

⚠️ **`init()` ne porte que le runtime.** Ce qui doit être prêt **dès l'import du bundle** —
les façades — se pose en phase A, par appel direct en fin de `globals.*.ts`. Un « setup de
façade » n'a rien à faire dans un module : s'il n'a besoin ni de l'adapter ni de la config
fusionnée, sa place est dans un `globals.*.ts`. Voir `specs/CDC_kernel.md` §Séquence de boot.

---

## Enregistrer un plugin

Un plugin s'auto-enregistre **à la fin de son `entry.ts`** (patron réel, `packages/plugins/cog/src/entry.ts`) :

```javascript
_g.GeoLeaf.plugins.register("cog", {
    version: _VERSION,
    requires: [], // dépendances obligatoires
    optional: [], // dépendances optionnelles
    label: "Cloud Optimized GeoTIFF (satellite/aerial imagery)",
    healthCheck: () => typeof _g.GeoLeaf?.COG === "object",
});
```

⚠️ **Le champ `type` a été RETIRÉ du contrat d'enregistrement**
([RFC-002](../rfc/RFC_002_retrait-champ-type.md)). Un plugin tiers qui le passerait encore
n'est pas cassé — le champ est simplement ignoré.

`src/entry.ts` est **le** fichier à lire en premier pour comprendre un plugin : il porte
6 étapes numérotées qui donnent d'un coup l'i18n, le namespace monté, le cycle de vie, le
manifeste `plugins.register`, le slot toolbar et l'action.

Conformité vérifiée par `scripts/verify-plugin-contract.cjs` (PC-01…PC-13), en CI et en
pre-commit. Le compte de plugins conformes est ce que le gate imprime — il n'est pas recopié ici.

---

## Désactiver une fonctionnalité par le profil

**Forme unique : `modules.<id>`.** Les clés racine héritées (`features.offline`,
`ui.showLegend`, `route.enabled`…) ont été retirées, avec le miroir de compatibilité qui les
alimentait.

```json
{
    "modules": {
        "offline": { "enabled": false },
        "legend": { "enabled": false }
    }
}
```

Le core traite le contenu d'un bloc `modules.<id>` comme **opaque** : les clés internes
appartiennent au module (INV-CONFIG / INV-FRONT). La lecture passe par
`GeoLeaf.Config.getModuleConfig("<id>", "<chemin>", <défaut>)`.

⚠️ **La posture est OPT-OUT**, et c'est une conséquence de l'ordre du boot : la gate de la
Pass 2 lit la config **pré-fusion**, les ressources de profil se chargeant après elle. Détail
et conséquence dans `specs/CDC_kernel.md` §Séquence de boot.

L'inventaire exhaustif des paramètres est dans
`docs/reference/inventaire_config_parametres.md`, gaté dans les deux sens contre
`profiles/schemas/*.json`.

---

## Voir aussi

- [`PLUGIN_ARCHITECTURE_SPEC.md`](PLUGIN_ARCHITECTURE_SPEC.md) — le contrat **figé** (invariants `INV-*`, gouvernance RFC)
- [`PROFILE_CONTRACT_SPEC.md`](PROFILE_CONTRACT_SPEC.md) — le contrat **figé** côté données de profil
- `docs/specs/CDC_kernel.md` — séquence de boot, 13 sous-systèmes, les 14 ADR

---

## Historique des révisions

| Version   | Date       | Modifications                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3.0.0** | 27/07/2026 | **Réécrit contre le code.** La couche « Extensions lazy » (12 clés `_loadModule()`, `src/lazy/*.ts`, `_loadAllSecondaryModules()`, procédure d'ajout en 4 étapes) est **supprimée** : l'API est retirée depuis le S5 et le répertoire n'existe pas. Les trois niveaux deviennent **kernel / capacité in-core / plugin**. Table « Modules Core » retirée — elle citait `src/modules/built-in/*` (racine éclatée), `GeoLeaf.Filters` (supprimé au S4.5) et des internes `_GeoJSON*` ; remplacée par les commandes qui listent. Table « Modules Plugin » retirée — elle en connaissait **2 sur 13**, dont `storage` renommé `offline-ui`. Les interfaces TypeScript recopiées sont remplacées par un renvoi (elles sont dérivables). `ICoreModule` documenté comme **union**. Désactivation par profil réécrite en `modules.<id>` (les clés racine montrées étaient toutes retirées). Règles de dépendances réécrites avec leur gate. |
| 2.0.0     | 01/04/2026 | Version Platform V2 — archivée par la réécriture ci-dessus.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
