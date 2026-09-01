---
type: spec-plugin
title: file-import — la conversion de fichiers géographiques vers GeoJSON
plugin_id: file-import
package: "@geoleaf-plugins/file-import"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 5535694b
date: 27 juillet 2026
---

# file-import — la conversion de fichiers géographiques vers GeoJSON

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/file-import` ·
**Code :** `packages/plugins/file-import/` · **Vérifié contre :** `5535694b` (27/07/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **Ce plugin est le seul des trois premiers à être EXTENSIBLE par un tiers** :
> `registerConverter(ext, converter)` ouvre son registre de formats. C'est la zone d'extension
> libre que le contrat prévoit (§3), exercée pour de vrai.

---

## Périmètre

### Ce que le plugin fait

Il convertit un **fichier déposé par l'utilisateur** — GPX, KML, KMZ, CSV, TSV, TopoJSON — en
GeoJSON, et sait le rendre directement sur la carte. Il accepte aussi des **convertisseurs
supplémentaires** enregistrés par l'intégrateur.

### Ce qu'il ne fait pas

- **Il ne fournit aucune interface.** Ni bouton, ni zone de dépôt, ni sélecteur de fichier :
  l'intégrateur passe un objet fichier obtenu comme il l'entend. C'est ce qui le distingue d'un
  plugin d'interface.
- **Il n'enregistre pas la couche dans le gestionnaire de couches** — même limite que
  [`flatgeobuf`](CDC_flatgeobuf.md), et pour la même raison : cet enregistrement est interne au
  core. Le code le dit sur place et **oriente vers `convert()`** quand on veut garder la main sur
  l'affichage.
- **Il ne lit pas de fichier distant** : il consomme un objet fichier local, jamais une URL.
- **Il ne reprojette pas** et **ne valide pas la topologie** : il convertit ce qu'on lui donne.
- **Il ne lit aucun bloc `modules.file-import`** — voir §Configuration.

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`.

| Champ        | Valeur                              |
| ------------ | ----------------------------------- |
| `name`       | `file-import`                       |
| `label`      | `FileImport (GPX/KML/CSV/TopoJSON)` |
| `requires`   | `[]`                                |
| `optional`   | `[]`                                |
| `namespace`  | `GeoLeaf.FileImport`                |
| `paquet npm` | `@geoleaf-plugins/file-import`      |

⚠️ **Le `label` énumère quatre formats, le registre en sert six extensions** (`.gpx`, `.kml`,
`.kmz`, `.csv`, `.tsv`, `.topojson`). Ce n'est pas une erreur — le libellé est une étiquette
d'affichage, pas un inventaire — mais un lecteur qui s'y fie sous-estime le périmètre. La liste
vraie se lit par `GeoLeaf.FileImport.getSupportedFormats()`, et c'est **cet** appel qu'il faut
citer, jamais l'étiquette.

### La forme de `entry.ts`

Deux étapes du squelette figé, comme [`cog`](CDC_cog.md) : montage du namespace et
auto-enregistrement. Ni i18n (aucune interface), ni chargeur de couche déclaratif — un fichier
déposé par l'utilisateur ne peut pas être déclaré dans un profil.

⚠️ Son `healthCheck` teste la **véracité** du namespace, là où `cog` et `flatgeobuf` testent son
**type**. Les deux satisfont le contrat (PC-03 exige la présence de la fonction) ; la divergence est
cosmétique, mais elle existe.

---

## Fonctionnalités

| ID    | Fonctionnalité                               | Entrée                                              | Sortie observable                                                                                                                 | Code                                       |
| ----- | -------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| FI-01 | Conversion vers GeoJSON                      | `convert(file)`                                     | Une collection d'entités **plus une liste d'avertissements**                                                                      | `import-api.ts` → `convert`                |
| FI-02 | Détection du format par extension            | Nom de fichier                                      | Le convertisseur correspondant, ou `null`                                                                                         | `format-detector.ts` → `detectConverter`   |
| FI-03 | Format non pris en charge                    | Extension inconnue                                  | Collection **vide** plus un avertissement nommant le fichier — **jamais d'exception**                                             | `import-api.ts` → `convert`                |
| FI-04 | Fichier absent ou sans nom                   | `convert(null)`                                     | Collection vide plus un avertissement                                                                                             | `import-api.ts` → `convert`                |
| FI-05 | Décompression KMZ                            | Fichier `.kmz`                                      | Le KML est extrait de l'archive puis converti ; **les avertissements de décompression sont fusionnés** avec ceux de la conversion | `kmz-extractor.ts` ; `import-api.ts`       |
| FI-06 | KMZ illisible                                | Archive sans KML exploitable                        | Collection vide plus les avertissements de décompression                                                                          | `import-api.ts` → `convert`                |
| FI-07 | Convertisseurs intégrés                      | `.gpx`, `.kml`, `.kmz`, `.csv`, `.tsv`, `.topojson` | Six extensions servies par quatre convertisseurs — `.kmz` réutilise celui du KML, `.tsv` celui du CSV                             | `format-detector.ts` → registre            |
| FI-08 | Liste des formats servis                     | `getSupportedFormats()`                             | Les extensions **réellement enregistrées**, extensions ajoutées comprises                                                         | `import-api.ts` → `getSupportedFormats`    |
| FI-09 | **Extension par un tiers**                   | `registerConverter(".shp", monConvertisseur)`       | L'extension est servie comme les autres ; **peut aussi remplacer** un convertisseur intégré                                       | `format-detector.ts` → `registerConverter` |
| FI-10 | Extension insensible à la casse              | `.GPX`, `.Kmz`                                      | Reconnue — l'extension est normalisée à l'enregistrement comme à la détection                                                     | `format-detector.ts`                       |
| FI-11 | Rendu direct sur la carte                    | `importAsLayer(file, options?)`                     | Source et sous-couches créées par l'adaptateur du core ; rend l'identifiant de couche                                             | `import-api.ts` → `importAsLayer`          |
| FI-12 | Échecs francs du rendu                       | Aucune entité extraite, ou carte absente            | Exception explicite — contrairement à `convert()`, qui n'échoue jamais                                                            | `import-api.ts` → `importAsLayer`          |
| FI-13 | Identifiant de couche                        | `layerId` absent                                    | Identifiant auto-incrémenté                                                                                                       | `import-api.ts`                            |
| FI-14 | Convertisseurs synchrones **ou** asynchrones | Convertisseur rendant une valeur ou une promesse    | Les deux sont acceptés — le contrat de convertisseur ne l'impose pas                                                              | `import-api.ts` → `convert`                |

⚠️ **Deux régimes d'erreur cohabitent, et c'est délibéré** : `convert()` **ne jette jamais** — il
rend une collection vide et des avertissements, parce qu'un fichier fourni par un utilisateur est
une entrée hostile ordinaire ; `importAsLayer()` **jette**, parce qu'une carte absente ou un fichier
vide est une erreur de programmation de l'intégrateur. Ne pas aligner les deux.

Les tests qui couvrent ces lignes : `packages/plugins/file-import/src/__tests__/`, dont un fichier
par convertisseur (PC-09).

---

## Configuration

**Aucun bloc `modules.file-import`**, et aucune lecture de la configuration du core. Comme
[`cog`](CDC_cog.md), tout passe par les arguments d'appel — ici, l'objet fichier et les options de
couche.

Ce plugin va plus loin que l'absence de configuration : sa **variabilité passe par le code**, via le
registre de convertisseurs. C'est la zone d'extension libre du contrat (§3), et c'est une forme de
configurabilité qu'un schéma JSON ne saurait pas exprimer — on n'y déclare pas une fonction de
conversion.

---

## Contrat exposé

### API publique — `GeoLeaf.FileImport`

Montée par `entry.ts`. `public-api.ts` est une **pure ré-exportation** de `import-api.ts`
(INV-FACADE — elle portait auparavant toute la chaîne de conversion).

| Membre                          | Rend / fait                                                     |
| ------------------------------- | --------------------------------------------------------------- |
| `convert(file)`                 | Collection d'entités + avertissements. **Ne jette jamais**      |
| `importAsLayer(file, options?)` | Convertit **et** rend ; rend l'identifiant de couche. **Jette** |
| `getSupportedFormats()`         | Les extensions réellement servies                               |
| `registerConverter(ext, conv)`  | Ajoute ou **remplace** un convertisseur                         |

Le **contrat de convertisseur** est ré-exporté depuis `entry.ts` — `IFileConverter`,
`ConvertResult`, `GeoJSONFeatureCollection` —, ce qui est ce qui rend l'extension par un tiers
réellement praticable : l'intégrateur type son convertisseur contre l'interface publiée.

### Le namespace est déclaré — mais il ne l'était pas, et cette fiche l'a découvert

`packages/core/src/global.d.ts` déclare `FileImport?: unknown`. Une faute de frappe sur le nom du
namespace ne compile donc pas ; **la forme des appels, en revanche, n'est pas vérifiée** — c'est la
traîne de membre encore ouverte.

⚠️ **Ce n'était pas le cas quand cette fiche a été écrite, et c'est elle qui a levé le défaut.**
L'interface `GeoLeafGlobal` n'a plus de traîne de premier niveau ; **cinq** namespaces
de plugins n'y avaient pas été déclarés — `FileImport`, `Measure`, `Print`, `Editor`, `Ws` —, de
sorte qu'un intégrateur compilant contre les types publiés recevait :

```
GeoLeaf.FileImport.convert(file)   →  TS2339 : la propriété n'existe pas
```

Les deux effets venaient du **même geste** — huit API fantômes documentées tombées d'un
côté, cinq plugins publiés fermés de l'autre. Seul le premier était voulu.

✅ **Soldé le 27/07/2026** : les cinq sont déclarés, le symptôme a été **vérifié
empiriquement avant et après** par une sonde compilée contre `dist/types/` à travers l'exports map
— cinq erreurs, puis zéro —, et une **gate ferme désormais la classe** :
`packages/core/__tests__/guards/plugin-namespace-declared.guard.test.js` vérifie que tout namespace
monté par un plugin est déclaré côté core.

⚠️ **Pourquoi rien ne l'avait vu, et pourquoi ce n'est pas encore refermé pour autant** : les
plugins écrivent à travers `GeoLeafHost` (`@geoleaf/host-runtime`), qui **porte encore** sa traîne
`[key: string]: unknown` — délibérément, son en-tête annonçant que la précision y croît sprint par
sprint comme dans le core. Les deux contrats ne sont donc **pas au même stade**, et c'est ce
décalage qui a rendu l'écart invisible depuis le plugin. La gate neuve compense pour l'existence de
la clé ; elle ne dit rien de sa forme.

### Événements et i18n

**Aucun** événement émis ou écouté, **aucun** dictionnaire i18n. Les messages du plugin sont des
**avertissements rendus dans la valeur de retour**, pas des libellés d'interface — ce qui est
cohérent avec un plugin sans interface, et laisse l'intégrateur les traduire s'il les affiche.

---

## Décisions de conception

| Décision                                                                 | Pourquoi                                                                                                                                                                                        | Alternative écartée                                                             |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Aucune interface fournie**                                             | Le dépôt sait déjà déposer des fichiers autrement ; imposer une zone de dépôt figerait une ergonomie dans un plugin de conversion                                                               | Fournir un bouton et une zone de dépôt                                          |
| **`convert()` ne jette jamais**                                          | Un fichier déposé par un utilisateur est une entrée hostile ordinaire : mauvais format, contenu tronqué, encodage inattendu. Rendre des avertissements permet d'en afficher plusieurs à la fois | Lever à la première anomalie — l'utilisateur ne verrait que le premier problème |
| **`importAsLayer()` jette**                                              | Une carte absente ou zéro entité n'est pas un problème de fichier, c'est un problème d'appel : le signaler fort est utile au développeur                                                        | Rendre un identifiant vide                                                      |
| **Un registre d'extensions ouvert**                                      | Les formats géographiques sont innombrables ; en servir quatre et permettre les autres vaut mieux que d'en promettre vingt                                                                      | Une liste fermée                                                                |
| **Un remplacement est autorisé**                                         | Un intégrateur peut vouloir son propre lecteur GPX, plus tolérant sur un dialecte donné. L'interdire l'obligerait à contourner le plugin                                                        | Refuser d'écraser une extension intégrée                                        |
| **Extensions normalisées en minuscules**                                 | Les systèmes de fichiers et les utilisateurs ne s'accordent pas sur la casse ; normaliser aux deux bouts (enregistrement et détection) évite un échec incompréhensible                          | Comparer tel quel                                                               |
| **KMZ traité comme un KML compressé**                                    | C'est exactement ce qu'il est. Réutiliser le convertisseur KML évite un second lecteur à maintenir                                                                                              | Un convertisseur KMZ à part                                                     |
| **Avertissements de décompression FUSIONNÉS** avec ceux de la conversion | Sinon un KMZ dont l'archive pose problème **et** dont le KML est imparfait ne rapporterait que la moitié des symptômes                                                                          | Ne garder que les derniers                                                      |
| **Convertisseurs synchrones ou asynchrones**                             | Un lecteur de texte n'a pas besoin d'être asynchrone ; un lecteur qui décompresse ou appelle un service en a besoin. Imposer l'un des deux exclurait la moitié des cas                          | N'accepter que des promesses                                                    |
| **Rendu par l'adaptateur du core**                                       | Même choix que `flatgeobuf` : c'est le chemin vivant en mode MapLibre                                                                                                                           | Une API de données du core, inopérante dans ce mode                             |
| **La façade a été vidée de sa logique**                                  | `public-api.ts` portait toute la chaîne de conversion, ce que le contrat interdit (INV-FACADE)                                                                                                  | Laisser l'implémentation dans la façade                                         |

---

## Dépendances et frontières

### Conformité au contrat gelé

Vérifié par `scripts/verify-plugin-contract.cjs`, bloquant dans `ci:local` et `.husky/pre-commit`.
Comme les deux autres plugins de ce lot, il n'a **ni CSS ni écriture de HTML** : PC-07 et PC-13 ne
le concernent pas. PC-08 (taille de fichier) est le seul contrôle qui le serre un peu : son
convertisseur GPX est le plus gros fichier du paquet.

### Dépendances

| Dépendance              | Nature                                                                        |
| ----------------------- | ----------------------------------------------------------------------------- |
| `@geoleaf/core`         | Dépendance d'espace de travail ; chargé **après** le core, **avant** `boot()` |
| `@geoleaf/host-runtime` | En **type seulement** (`GeoLeafHost`) — même forme que `cog` et `flatgeobuf`  |

**Aucune dépendance sur MapLibre** : la carte est atteinte par l'adaptateur du core, dont une vue
**structurelle** locale est déclarée. PC-10 ne s'applique pas.

### Frontières

- **Aucune lecture de configuration du core.**
- **Aucun couplage à un autre plugin** — `requires` et `optional` vides, et vrai au sens fort.
- ⚠️ **Un couplage de fait avec la capacité [`route`](../capacites/route.md)** : la fiche de `route`
  note que la lecture des fichiers GPX / KML **est déléguée à ce plugin** — c'est même l'argument qui
  a fait de `route` une capacité de surcouche plutôt qu'un plugin. La relation est **documentaire,
  pas de code** : aucun des deux ne référence l'autre, et c'est ce qui la rend fragile à suivre.
- **Aucune CSS**, aucune écriture de HTML.

---

## Écarts au CDC source

Le CDC `CDC_plugin-file-import.md` a été **consommé** en écrivant cette fiche, puis retiré du
dossier de tri — trace au §Journal des décisions de
la refonte documentaire V3.

| Énoncé du CDC                                | Ce que dit le dépôt                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Formats annoncés par le libellé du manifeste | Le registre sert **six extensions** pour quatre convertisseurs : `.kmz` passe par le KML, `.tsv` par le CSV |
| Chiffres de volume recopiés en prose         | Non repris, par la règle 1                                                                                  |
| ✅ Le point d'extension `registerConverter`  | **Exact**, et c'est la particularité du plugin — la seule zone d'extension libre exercée dans ce lot        |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : les cas d'usage (import d'une trace
GPS, d'un export KML issu d'un outil bureautique, d'un tableau de points en CSV), et les
alternatives écartées de la table §Décisions.
