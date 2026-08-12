---
type: spec-lib
title: field-renderer — les composants de champ, la modale et le pont de formulaire
lib_id: field-renderer
package: "@geoleaf/field-renderer"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 21630103
date: 28 juillet 2026
---

# field-renderer — les composants de champ, la modale et le pont de formulaire

**Type :** bibliothèque partagée · **Paquet :** `@geoleaf/field-renderer` ·
**Code :** `packages/libs/field-renderer/` · **Vérifié contre :** `21630103` (28/07/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **Ce n'est NI une capacité, NI un plugin — et aucune gate documentaire ne lit cette fiche.**
> Les deux gardes du §2.4 de la refonte visent `specs/capacites/` (table de configuration ↔
> `configSchema`) et `specs/plugins/` (manifeste ↔ `entry.ts`). Une bibliothèque n'a ni l'un ni
> l'autre. **La véracité de ce document repose donc entièrement sur sa relecture** — c'est la règle
> documentaire du dépôt, sans filet mécanique. Le dire ici plutôt que laisser croire l'inverse.

---

## Périmètre

### Ce que la bibliothèque fait

Elle fournit de quoi **construire un formulaire depuis une déclaration** : un catalogue de composants
de champ enregistrés dans un registre, un pont qui les instancie depuis un schéma et gère valeurs,
validation et erreurs, une **modale responsive** avec piège de focus, et des utilitaires de
sécurité DOM.

### Ce qu'elle ne fait pas

- **Elle n'est pas un plugin.** Aucun `entry.ts`, aucun `register()`, aucun montage de namespace
  `GeoLeaf.*`. Son point d'entrée est un `index.ts` d'exports purs, et sa sortie de construction est
  un paquet **importable**, pas un greffon auto-chargé. Elle est explicitement **hors du contrat de
  plugin**.
- **Elle ne connaît pas GeoLeaf.** Aucune dépendance vers le core, ni vers MapLibre, ni vers aucun
  cadre applicatif. Une seule concession : un utilitaire lit `GeoLeaf.I18n` **s'il existe**, puis
  son **catalogue de libellés intégré** (5.1c, **D6**), puis la clé. ⚠️ Jusqu'au 05/08 il retombait
  directement sur la clé, alors qu'il utilisait **43 clés qu'il ne déclarait nulle part**.
- **Elle n'est pas consommée par le core.** Le core porte **son propre** piège de focus, et le motif
  est écrit dans celui de la bibliothèque.
- **Elle ne valide pas de manière asynchrone.** Les validateurs sont **purs et synchrones**.

---

## Surface publique

Exportée par `src/index.ts`. C'est la seule frontière : ce qui n'y est pas n'est pas public.

⚠️ **La compression d'images (5.1-d) n'ajoute AUCUN export.** `types/image-compress.ts` est
**interne**, comme `types/field-media.ts` dont il dépend : ses consommateurs sont les composants
`image` et `gallery`, eux publics. Ce qui change sur la surface publiée est donc le
**comportement** de ces deux composants, pas la liste des exports — et c'est ce qui rend le
changement additif au sens de **D5**. Le détail du changement de sens de `maxSizeMb` est au
§Décisions ci-dessous.

✅ **Un seul export neuf : `setImageUploadStrategy`** (**D7**). C'est le point d'injection qui
permet à un hôte de changer le **transport** — par exemple pour retomber sur un stockage hors
ligne — **sans cloner le composant**. Il remplace le patron de surcharge que `addpoi` utilisait,
et qui coûtait **229 lignes pour changer 4 appels**. ⚠️ **Un seul stratège à la fois** : deux
hôtes qui en poseraient un chacun se donneraient un résultat dépendant de l'ordre de chargement.

| Groupe               | Contenu                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Contrats** (types) | `FieldConfig` · `RenderCtx` · `MapLayerHint` · `ComponentDefinition`                                                          |
| **Registre**         | `ComponentRegistry` · `registerBuiltinComponents()` · `builtinComponentIds()`                                                 |
| **Composants**       | **23**, du `text` au `gallery` — voir ci-dessous                                                                              |
| **Validateurs**      | Un espace `validators`, rendant chacun une chaîne d'erreur **ou `null`**                                                      |
| **Modale**           | `createResponsiveModal(...)` + ses types                                                                                      |
| **Piège de focus**   | `createFocusTrap(container, onEscape?)`                                                                                       |
| **Dialogue**         | `confirmDialog(...)` → promesse de booléen                                                                                    |
| **Pont**             | `createFieldRendererBridge(schema, values, ctx)`                                                                              |
| **Téléversement**    | `setImageUploadStrategy(fn \| null)` + le type `ImageUploadStrategy` — 5.1-d                                                  |
| **Libellés**         | Catalogue **interne** `src/lang/` — 43 clés `form.*` × 6 locales (5.1c, **D6**). Aucun export : c'est `_getLabel` qui le sert |
| **Aides DOM**        | `_el(tag, className?)` · `_getLabel(key)`                                                                                     |
| **Sécurité**         | `escapeHtml(...)` · `validateUrl(...)` · `safeUrl(...)`                                                                       |

⚠️ **Deux aides publiques portent un préfixe `_`** — `_el` et `_getLabel`. Le préfixe est la
convention du dépôt pour « interne », et elles sont pourtant exportées **et** consommées par trois
plugins. Même contradiction convention / surface que `_getExporter` de
[`print`](../plugins/CDC_print.md), relevée en **B-71** du
registre.

⚠️ **Ce qui est délibérément NON exporté** : l'application de texte CSS, et la **classe**
d'implémentation du registre — seule l'instance singleton l'est. Un consommateur ne peut donc pas
construire un second registre, ce qui est le point : voir §Décisions.

### Les 23 composants

Texte court et long, nombre, date, prix, mesure, badge, liste, étiquettes, tableau, adresse
électronique, téléphone, lien, adresse web, case à cocher, bouton radio, liste déroulante, note,
avis, horaires, coordonnées, image, galerie.

`registerBuiltinComponents()` les enregistre **tous**, et l'appel est **idempotent**.

---

## Le registre est un singleton de module — et c'est structurant

`ComponentRegistry` est **une instance unique par graphe de modules**. Trois conséquences, dont une
a déjà coûté un défaut :

1. **Deux plugins qui appellent `registerBuiltinComponents()` ne se gênent pas** — l'appel est
   idempotent.
2. **Un plugin qui n'enregistre qu'une partie du catalogue ne se limite pas lui-même** : il fait
   dépendre le reste de la présence d'un autre plugin. C'est précisément ce qui est arrivé —
   `addpoi` (fusionné dans [`editor`](../plugins/CDC_editor.md) au Sprint 5) n'enregistrait que dix composants, et les treize autres ne
   se résolvaient **que si `editor` était aussi chargé**, retombant silencieusement sur du texte
   sinon.
3. **Une surcharge doit porter son propre identifiant.** Le composant d'image d'`addpoi` en a un, et
   n'a donc **jamais** masqué le composant intégré.

---

## Décisions de conception

| Décision                                                                        | Pourquoi                                                                                                                                                                                                                                                                                                                   | Alternative écartée                                              |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Zéro dépendance d'exécution**                                                 | La bibliothèque est regroupée dans **trois** paquets consommateurs. La moindre dépendance y serait payée trois fois, ou dédupliquée par chance                                                                                                                                                                             | Un socle de composants tiers                                     |
| **DOM pur, aucun cadre applicatif**                                             | Imposer React ou Vue à un plugin cartographique aurait fixé un choix d'architecture pour tous les intégrateurs                                                                                                                                                                                                             | Un cadre applicatif                                              |
| **Un registre singleton, et sa classe non exportée**                            | Deux registres, c'est deux catalogues qui divergent — et un composant introuvable selon l'ordre d'import. Ne pas publier la classe rend le cas impossible                                                                                                                                                                  | Exporter la classe                                               |
| **Les validateurs sont purs et synchrones**                                     | Un validateur asynchrone impose une machine d'état à tout appelant. Le synchrone se compose sans cadre                                                                                                                                                                                                                     | Des validateurs asynchrones                                      |
| **Un validateur rend une chaîne ou `null`**                                     | Pas de booléen : la valeur de retour **est** le message. Un booléen aurait obligé à un second appel pour savoir quoi afficher                                                                                                                                                                                              | `boolean`                                                        |
| **Une seule modale, responsive, pas deux**                                      | Boîte centrée au-dessus d'un seuil, tiroir montant en dessous — deux composants auraient dupliqué le piège de focus et la gestion de l'état modifié                                                                                                                                                                        | Une modale de bureau + une mobile                                |
| **L'i18n est une lecture opportuniste**                                         | La bibliothèque ne doit pas dépendre de GeoLeaf. Elle lit le namespace **s'il est là**, et retombe sur la clé sinon — donc elle fonctionne seule                                                                                                                                                                           | Une dépendance au core                                           |
| **Le core ne la consomme pas**                                                  | Le core embarque son propre piège de focus. L'y faire dépendre aurait ajouté une arête du core vers `libs/` pour une seule fonction                                                                                                                                                                                        | Faire consommer la lib par le core                               |
| **Hors du contrat de plugin, explicitement**                                    | Elle n'enregistre rien, ne monte rien, et n'est pas auto-chargée. L'y soumettre aurait exigé un `entry.ts` sans objet                                                                                                                                                                                                      | La traiter comme un plugin                                       |
| **La compression est ici, le stockage hors ligne ne l'est pas** (**D5**, 5.1-d) | Compresser est **pur** — un fichier entre, un fichier sort, aucune dépendance neuve. Persister hors ligne tire IndexedDB et le kernel offline : une bibliothèque de rendu de champs qui saurait persister serait une inversion de dépendance                                                                               | Absorber toute la chaîne image d'`addpoi`                        |
| **`maxSizeMb` est la taille VISÉE, pas le plafond de refus** (5.1-d)            | Une photo de téléphone pèse 4 à 12 Mo ; le plafond par défaut de 5 Mo refusait donc la saisie la plus ordinaire, **sans recours**. Le refus porte désormais sur `maxSizeMb × PRECOMPRESSION_FACTOR`, et ce qui est entre les deux est compressé. ⚠️ **Le changement n'ôte rien** : tout fichier accepté avant l'est encore | Garder le refus sec, et laisser l'intégrateur monter `maxSizeMb` |
| **La garde canvas est SYNCHRONE**                                               | `addpoi` ne la posait qu'à l'intérieur d'`img.onload`, qui ne se déclenche jamais sans canvas : la promesse ne se réglait ni en succès ni en échec, et le téléversement restait **pendu sans message**. La vérifier avant toute E/S rend le cas exprimable                                                                 | Vérifier dans `onload`, comme la source                          |

---

## Dépendances et frontières

**Aucune dépendance de production. Aucune dépendance pair.** Le paquet est publié en **MIT** sur le
registre public, et `files[]` embarque `dist/`, `src/`, la licence et le fichier de présentation.

### Les trois consommateurs, et ce qu'ils prennent

| Consommateur                         | Ce qu'il importe                                                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`editor`](../plugins/CDC_editor.md) | Le **plus gros usage** : catalogue complet, modale responsive, registre, dialogue de confirmation, aides et sécurité. ⚠️ Hérité d'`addpoi`, fusionné ici au Sprint 5 |
| `editor`                             | Catalogue complet, piège de focus (trois sites), et une **ré-exportation** des deux aides DOM                                                                        |
| `offline-ui`                         | Le plus léger : dialogue de confirmation (quatre sites) et piège de focus                                                                                            |

**`packages/core` n'en dépend PAS**, et ne doit pas commencer.

### Ce que la migration `formSchema` (tâche 7.2) n'a PAS changé ici

✅ **Rien, structurellement — et c'est le résultat, pas un hasard.** La clé `formSchema` du profil
a été supprimée le 07/08/2026 au profit d'une projection de `attributes.fields[]`. Cette
bibliothèque n'a coûté que **deux commentaires** : `FieldConfig` disait « from the JSON profile
`formSchema` » et l'en-tête du pont disait « formSchema → ComponentRegistry ».

Le motif est structurant et vaut d'être écrit : **`FieldConfig` décrit ce qu'un composant REÇOIT,
jamais où le profil le range.** La traduction vit chez l'appelant — `editor`
(`packages/plugins/editor/src/modal/attributes-to-form.ts`) — qui aplatit le sac `options` du modèle attributaire sur le
descripteur, parce que c'est là que les composants le lisent (`fieldConfig.rows`,
`fieldConfig.maxItems`, `fieldConfig.uploadEndpoint`…). Déplacer cette traduction ici ferait entrer
le vocabulaire des profils dans une lib qui l'ignore, et lui ferait perdre exactement
l'indépendance qui a rendu cette migration bon marché.

⚠️ Le repli `?? ComponentRegistry.get("text")` du pont (`field-renderer-bridge.ts`) est **silencieux
par conception** : un `type` inconnu rend un champ texte sans avertir. C'est vivable parce que le
vocabulaire est gaté en amont (A10/A17 côté schéma, `ATTR-10`/`ATTR-11` côté parité) — et c'est
précisément ce repli qui a écarté, à 7.2, l'idée de dériver le widget de saisie par une table en
dur : une correspondance manquante n'aurait rien fait rougir.

⚠️ **Trois plugins du dépôt ne la consomment pas du tout** — [`table`](../plugins/CDC_table.md),
[`print`](../plugins/CDC_print.md) et [`measure`](../plugins/CDC_measure.md). Ce sont les trois qui
ne saisissent pas de données : la frontière d'usage recoupe exactement la frontière fonctionnelle.

---

## Écarts au CDC source

Le CDC `CDC_field-renderer.md` (v1.7.0, 23/07/2026) a été **consommé** en écrivant cette fiche, puis
**supprimé** du dossier de tri — ligne au §Journal des décisions de
`roadmap_documentation-v3.md`.

**C'est un CDC bien tenu** : il porte le renommage depuis son nom d'origine et le déplacement sous
`packages/libs/`. Son annexe B liste même ses affirmations techniques comme **vérifiées**.

| Énoncé du CDC                                                      | Ce que dit le code                                                                                                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §Résumé — les variantes de déploiement citées                      | Les variantes réellement produites sont `deploy-core`, `deploy-addpoi` et `deploy-full` — plus la variante instrumentée                                         |
| §Statut contractuel — hors contrat de plugin, quatre critères      | ✅ **Vérifiés exacts** tous les quatre : aucun `register()` en source, aucun `entry.ts` montant un namespace, sortie importable, point d'entrée en exports purs |
| §Résumé — 23 composants, modale responsive, pont, validateurs purs | ✅ **Vérifiés exacts**                                                                                                                                          |
| §Résumé — « ESM pur sans aucune dépendance externe runtime »       | ✅ **Vérifié exact** — ni `dependencies`, ni `peerDependencies`                                                                                                 |
| §12 — contrats avec les plugins consommateurs                      | ✅ **Vérifié**, et complété ici par la mesure de ce que chacun importe réellement                                                                               |

⚠️ **Ce que le CDC ne dit pas, et que la fiche ajoute** : les deux aides publiques portent un préfixe
`_` alors qu'elles sont dans la surface publique (**B-71**), et **trois plugins du dépôt ne la
consomment pas** — ceux qui ne saisissent pas de données.

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : l'origine de l'extraction (elle est
sortie du plugin d'édition), le positionnement produit, les audiences, les limites fonctionnelles
connues, et les alternatives écartées de la table §Décisions.
