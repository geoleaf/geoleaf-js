# RFC-002 — Retrait du champ de manifeste `type`

**Statut :** Acceptée → Appliquée
**Date :** 19 juillet 2026
**Auteur :** Mattieu Pottier
**Cible :** [`PLUGIN_ARCHITECTURE_SPEC.md`](../contrats/PLUGIN_ARCHITECTURE_SPEC.md) §1 (vocabulaire), §4 (contrat d'enregistrement), §7 ; `scripts/verify-plugin-contract.cjs` (check `PC-03`) ; `packages/core/src/modules/built-in/api/api-types.ts`
**Contrat :** Plugin Contract v1 — changement **non cassant** (exigence retirée, aucun plugin conforme ne cesse de l'être) → spec **1.3.0 → 1.4.0**

---

## Contexte

Le champ `type` du manifeste `plugins.register()` servait à partitionner les plugins pour l'affichage. Il avait exactement **deux** lecteurs, tous deux dans `packages/core/src/kernel/api/plugin-registry.ts` : deux rapports console distincts. Le sprint ARCHI S2 (19/07/2026) les fusionne en un `reportPlugins()` unique — après quoi le champ n'a **plus aucun lecteur** dans le monorepo.

## Le champ ne fonctionnait déjà pas

Ce n'est pas seulement un vestige : le mécanisme était faux avant même d'être privé de ses lecteurs.

Chaque rapport s'appuyait sur une **liste de noms codée en dur** qui **écrasait** la valeur déclarée par le plugin. Les deux listes contredisaient les déclarations, **en sens inverse** : `plugin-storage` et `plugin-editor` étaient rangés par les listes du côté opposé à celui que leur manifeste déclarait. Conséquence vérifiée par simulation des deux filtres : `storage` et `editor` passaient **les deux** tests et étaient affichés par **les deux** rapports — chaque démarrage les comptait deux fois.

Par ailleurs le toast de boot (`packages/core/src/kernel/api/boot-info.ts`) partitionnait sur une **troisième** liste codée en dur, qui **omettait `cog`** et ignorait complètement le champ `type`.

Trois sources de vérité pour une même partition, mutuellement incohérentes, et aucune ne consultait fidèlement la donnée déclarée.

## Changement proposé

Retirer `type` :

- du **contrat d'enregistrement** (§4) — il n'est plus un champ de `PluginMetadata` ;
- de la **règle PC-03**, qui l'exigeait littéralement ;
- des **types du core** — l'alias `PluginType` et les champs `PluginMetadata.type` / `PluginEntry.type` ;
- des **13 `entry.ts`** et du gabarit `_plugin-template` ;
- du générateur `scripts/create-plugin.cjs`, qui dupliquait le check PC-03 en local.

## Pourquoi non cassant

La règle PC-03 **exigeait** ce champ : tout plugin conforme le déclarait. Retirer une exigence ne peut pas rendre non conforme un plugin qui l'était — vérifié, **13/13 plugins conformes** après le changement, 0 violation, 0 dérogation.

Pour un consommateur externe, l'API `plugins.register()` ignore silencieusement les champs inconnus : un plugin tiers qui continuerait de passer `type` n'est pas cassé, le champ est simplement ignoré. Aucun `@geoleaf-plugins/*` n'était publié à la date de cette RFC, et `index.d.ts` ne décrivait pas le namespace `plugins` — la surface de migration externe est nulle.

Le changement d'API publique qui accompagne cette RFC (les deux rapports console fusionnés en un `reportPlugins()` unique) est **cassant** et documenté comme tel au `CHANGELOG` public de `@geoleaf/core`, mais il porte sur le namespace `GeoLeaf.plugins`, pas sur le contrat d'enregistrement — il ne relève donc pas de la Partie I figée.

## Alternatives écartées

- **Conserver le champ en le vidant de sens** (une valeur unique pour tous les plugins) : garde une exigence obligatoire à valeur constante, que rien ne lit. Le prochain audit la re-signalerait.
- **Le conserver en le renommant** (ex. `category`, taxonomie `ui`/`data`/`engine`) : conçoit une fonctionnalité nouvelle sous couvert d'un retrait. Écarté du périmètre ; peut faire l'objet d'une RFC ultérieure si le besoin d'une taxonomie apparaît.

## Impact

- Spec : §1 (ligne « Plugin »), §4 (contrat d'enregistrement et son exemple), §7.
- Vérificateur : `PC-03` ne demande plus que `version`, `label`, `healthCheck`.
- Tests : les blocs de `packages/core/__tests__/api/plugin-registry.test.js` couvrant les deux rapports sont remplacés par un bloc `reportPlugins()`, augmenté d'un test de non-régression sur le double comptage. Deux tests de `packages/core/__tests__/api/boot-info.test.js` sont corrigés, dont un dont l'intitulé annonçait une assertion qu'il ne faisait pas.

## Décision

**Acceptée** le 2026-07-19 (Mattieu Pottier — option « le retirer »). **Appliquée** dans le même changement : spec **1.3.0 → 1.4.0** (journal §10), `PC-03` allégé, champ retiré du core, des 13 plugins et du gabarit.

---

## ⏱️ Note de relecture — 27/07/2026 (refonte documentaire V3)

**Le corps de cette RFC n'est pas réécrit** — elle est exacte à sa date (19/07/2026).

Un chemin cité en en-tête ne résout plus :
`packages/core/src/modules/built-in/api/api-types.ts` → **`packages/core/src/kernel/api/api-types.ts`**.
La racine `src/modules/` a été éclatée en `kernel/`, `capabilities/`, `api/` et `app/`.

Le résultat annoncé tient : `node scripts/verify-plugin-contract.cjs` rend **13/13 plugins
conformes, 0 violation, 0 grandfathered**.

---

_MP-i — Mattieu Pottier Indépendant_
