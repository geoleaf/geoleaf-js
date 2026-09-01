---
type: spec-plugin
title: geocoding — la recherche d'adresse sur la carte
plugin_id: geocoding
package: "@geoleaf-plugins/geocoding"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: fab770b1
date: 1er septembre 2026
---

# geocoding — la recherche d'adresse sur la carte

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/geocoding` ·
**Code :** `packages/plugins/geocoding/` · **Vérifié contre :** `fab770b1` (01/09/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **C'est le plugin COMPLET du lot : le seul qui exerce les six étapes d'`entry.ts`.** Il a une
> interface, des dictionnaires i18n, un cycle de vie, un créneau de barre d'outils, un écouteur
> d'action, une configuration de profil et une CSS. Les trois autres fiches du lot
> ([`cog`](CDC_cog.md), [`flatgeobuf`](CDC_flatgeobuf.md), [`file-import`](CDC_file-import.md))
> couvrent des formes plus pauvres — c'est ici que le squelette de fiche est mis à l'épreuve.

---

## Périmètre

### Ce que le plugin fait

Il pose une **barre de recherche d'adresse** sur la carte, interroge un service de géocodage,
propose les résultats, et vole vers celui que l'utilisateur choisit. La recherche est aussi
disponible **par programme**, sans interface.

Quatre fournisseurs sont servis : la base d'adresses nationale française, deux services mondiaux, et
**n'importe quel point d'accès HTTPS** rendant une collection d'entités GeoJSON.

### Ce qu'il ne fait pas

- **Il ne géocode pas en sens inverse** : d'une adresse vers un point, jamais d'un point vers une
  adresse.
- **Il n'assainit pas les résultats lui-même par du HTML** : les libellés sont posés en texte, ce
  qui rend l'injection impossible par construction.
- **Il ne stocke rien** : ni historique de recherche, ni cache de résultats.
- **Il n'ajoute pas de couche** : il déplace la vue, il ne matérialise pas le résultat en entité.
- **Il n'a pas de bouton sur bureau.** Le créneau de barre d'outils qu'il déclare est **mobile
  seulement** — voir §Manifeste.

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`.

| Champ        | Valeur                            |
| ------------ | --------------------------------- |
| `name`       | `geocoding`                       |
| `label`      | `Geocoding (recherche d'adresse)` |
| `requires`   | `[]`                              |
| `optional`   | `[]`                              |
| `namespace`  | `GeoLeaf.Geocoding`               |
| `paquet npm` | `@geoleaf-plugins/geocoding`      |

✅ **Le `label` valait `geocoding` — l'identifiant, pas un nom lisible.** Corrigé le 29/07/2026
en même temps que celui de [`table`](CDC_table.md), l'autre des deux seuls dans ce cas.
Le contrat décrit ce champ comme un « nom lisible (toasts, rapports) », et les trois autres plugins
du lot en portaient déjà un.

⚠️ **PC-03 ne vérifie que la PRÉSENCE du champ**, pas son utilité — donc rien ne rougissait, et rien
ne rougirait si l'écart revenait. C'est la limite connue de cette gate, et elle vaut d'être sue :
ce que la table `## Manifeste d'enregistrement` de cette fiche garantit, c'est que le libellé
**documenté** est celui **déclaré**, pas qu'il soit lisible.

### Les six étapes d'`entry.ts`

| Étape                              | Ce qu'elle fait ici                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1 — dictionnaires i18n **d'abord** | Six langues enregistrées **avant** tout rendu, sans quoi les libellés ne résoudraient pas                      |
| 2 — montage du namespace           | `GeoLeaf.Geocoding = buildPublicApi()`                                                                         |
| 3 — cycle de vie                   | `GeocodingRegistry.init()` — s'abonne à la disponibilité de la carte                                           |
| 4 — auto-enregistrement            | Le manifeste ci-dessus                                                                                         |
| 5 — créneau de barre d'outils      | `registry.register({ id, ui: { mobileIcon: … } })` — **mobile uniquement**, et sous `isInitialized() !== true` |
| 6 — écouteur d'action              | Sur `geoleaf:toolbar:action`, ouvre la pastille quand l'action est la sienne                                   |

⚠️ **Aucun bouton d'onglet de bureau n'est déclaré, et c'est un choix.** Au-delà d'un seuil de
largeur, la barre de recherche est **toujours visible** ; la pastille de barre d'outils serait un
doublon. Elle est donc masquée par la CSS plutôt que non enregistrée — l'enregistrement reste unique,
l'affichage est conditionnel.

⚠️ **La `profileKey` du créneau est `modules.geocoding.showButton`** depuis le 17/08/2026, et
`ui.showGeocoding` — la clé historique du bouton de recherche du core — n'en est plus que le
`legacyProfileKey`. La canonique **gagne dès qu'elle est présente** ; l'ancienne ne parle que dans
son silence, et **l'absence des deux vaut visible** — voir
`packages/core/src/kernel/ui/ui-slot-builder.ts`, `_configuredVisibility` : la sentinelle
`undefined` est exactement ce qui rend ce repli possible, un `get(clé, défaut)` rendant « absente »
et « déclarée `true` » indiscernables. `PC-14` (`scripts/verify-plugin-contract.cjs`) rend
désormais la branche exécutoire et **exempte explicitement `legacyProfileKey`**, qui n'existe que
pour ne pas casser un profil déjà écrit.

⚠️ **Cette ligne disait « une clé hors de `modules.geocoding` », et en tirait qu'un profil activant
`modules.geocoding.enabled` sans `ui.showGeocoding` obtenait « la barre sans la pastille ».** Les
deux énoncés sont faux : la clé a migré sous `modules.geocoding`, et l'absence de clé n'a jamais
masqué la pastille — seul un `false` explicite la masque.

🛑 **Et l'enregistrement de l'étape 5 ne vaut que sur le chemin EAGER** (21/08/2026) : il est
conditionné à `registry.isInitialized() !== true`. Chargé avant `boot()` — ce que prescrit le
README publié —, cet appel est la **seule** déclaration du créneau et c'est lui qui dessine le
bouton ; chargé après `init()`, la barre d'outils est déjà construite et la déclaration serait
stockée sans jamais être dessinée. Sur le chemin paresseux, c'est `apps/geoleaf-app/init.js` qui
déclare le créneau (`registerLazyForAction`), avec la même paire de clés. ⚠️ La condition est
`!== true` et non `=== false` : un hôte qui n'expose pas `isInitialized` garde son créneau — un
avertissement de trop coûte une ligne de console, une déclaration manquante coûte le bouton.
`geocoding` est le **cas eager réel du dépôt** — préchargé par `beforeBoot` —, et c'est ce que
vérifie `scripts/probe-slot-timing.mjs`.

🛑 **CE PLUGIN NE PEUT PAS ÊTRE PUREMENT PARESSEUX, et l'oublier l'a cassé en silence.**
Il s'abonne à `geoleaf:map:ready` **au moment de son import**, et son contrôle ne se monte que
là. L'application doit donc le **précharger dans `beforeBoot`** quand le profil porte
`modules.geocoding.enabled: true` — c'est le seul point du cycle qui court après le config et
avant la création de la carte. Mesuré le 08/08/2026 : rendu paresseux sans cet ajout, il
n'était chargé par personne, et **GC-01 ne se produisait plus du tout** — sans erreur, avec
`isEnabled()` qui rendait `true`. Le charger après coup ne répare rien : l'écouteur serait posé
après l'événement.

⚠️ Son `init()` porte depuis un **repli** « la carte est peut-être déjà prête », qui rend le
montage insensible à l'ordre de chargement. Il ne remplace pas le préchargement — sans lui, rien
ne charge le plugin — mais il ferme le chemin tardif (clic sur le créneau, `plugins.load()`),
mesuré cassé lui aussi. La classe entière est instruite pour `editor` et `table`.

### Les clés i18n sont PLATES et pointées

Les dictionnaires portent `geocoding.toolbar.button`, `geocoding.control.placeholder`… en clés
**plates**. Le code du core l'exige : sa table fusionnée est indexée directement et **ne découpe
jamais sur le point**, donc un dictionnaire imbriqué résoudrait silencieusement vers rien.
`entry.ts` porte cet avertissement sur place.

Aucune entrée pour l'alias de langue allemand n'est nécessaire : le core le résout vers l'allemand
pour les deux codes.

---

## Fonctionnalités

| ID    | Fonctionnalité                                 | Entrée                                        | Sortie observable                                                                                                                                                                  | Code                                                                  |
| ----- | ---------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| GC-01 | Montage de la barre de recherche               | Carte disponible, capacité activée            | Le contrôle est posé sur la carte à la position configurée                                                                                                                         | `registry.ts` → `init` ; `control.ts`                                 |
| GC-02 | Recherche à la frappe                          | Saisie au-delà du minimum de caractères       | Requête au fournisseur, résultats proposés sous le champ                                                                                                                           | `control.ts` ; `registry.ts` → `search`                               |
| GC-03 | Anti-rebond de la frappe                       | Frappe rapide                                 | Une seule requête après le délai configuré                                                                                                                                         | `control.ts`                                                          |
| GC-04 | Seuil de déclenchement                         | Saisie plus courte que le minimum             | Aucune requête                                                                                                                                                                     | `control.ts`                                                          |
| GC-05 | Choix d'un résultat                            | Clic ou validation au clavier                 | La carte **vole** vers un point, ou **cadre** une emprise ; puis un événement est émis                                                                                             | `registry.ts` → `selectResult`                                        |
| GC-06 | Recherche par programme                        | `search(query, limit?)`                       | Les résultats, **sans que l'interface soit visible**                                                                                                                               | `public-api.ts` → `search`                                            |
| GC-07 | Sélection par programme                        | `selectResult(result)`                        | Même déplacement de carte et même événement qu'un choix utilisateur                                                                                                                | `public-api.ts` → `selectResult`                                      |
| GC-08 | Fournisseur français par défaut                | Aucun `provider` configuré                    | La base d'adresses nationale — **sans clé d'API**                                                                                                                                  | `provider.ts` → `createProvider`                                      |
| GC-09 | Fournisseurs mondiaux                          | `provider: "nominatim"` ou `"photon"`         | Le service correspondant, réponses **normalisées** vers la même forme de résultat                                                                                                  | `provider.ts`                                                         |
| GC-10 | Point d'accès sur mesure                       | `provider: "https://…"`                       | Le point d'accès est interrogé, sa collection d'entités normalisée                                                                                                                 | `provider.ts` → fournisseur sur mesure                                |
| GC-11 | **Valeur de fournisseur inconnue ou non sûre** | `provider: "javascript:…"`, ou un nom inconnu | **Repli sur le fournisseur par défaut** — jamais d'appel vers une valeur non reconnue                                                                                              | `provider.ts` → `createProvider`                                      |
| GC-12 | Restriction par emprise                        | `bbox`                                        | Traduite **différemment selon le fournisseur** : filtre strict pour deux d'entre eux, **biais de proximité** par le centroïde pour la base française, qui n'a pas de filtre strict | `provider.ts`                                                         |
| GC-13 | Restriction par pays                           | `countrycodes`                                | Appliquée par un seul fournisseur, **ignorée** par les autres — et c'est documenté sur le type                                                                                     | `provider.ts`                                                         |
| GC-14 | Encodage de la saisie                          | Saisie contenant `&`, `?`, des espaces        | Encodée avant d'entrer dans l'URL                                                                                                                                                  | `provider.ts`                                                         |
| GC-15 | Libellés posés en texte                        | Résultat dont le libellé contient du balisage | Rendu littéral — jamais interprété                                                                                                                                                 | `control.ts`                                                          |
| GC-16 | Pastille mobile                                | Action de barre d'outils `geocoding`          | La pastille de recherche s'ouvre et le champ prend le focus                                                                                                                        | `entry.ts` étape 6 → `registry.ts` → `open` ; `control.ts` → `reveal` |
| GC-17 | Barre toujours visible sur grand écran         | Largeur au-delà du seuil                      | La pastille est masquée par la CSS ; la barre est là en permanence                                                                                                                 | `css/geoleaf-geocoding.css`                                           |
| GC-18 | Lecture de configuration **paresseuse**        | Configuration de profil rechargée à chaud     | Prise en compte **sans réinitialiser** le registre                                                                                                                                 | `registry.ts` ; `config.ts`                                           |
| GC-19 | Démontage                                      | `destroy()`                                   | Contrôle retiré et écouteurs DOM relâchés                                                                                                                                          | `public-api.ts` → `destroy`                                           |
| GC-20 | Lecture de l'état d'activation                 | `isEnabled()`                                 | `true` quand le profil actif l'active                                                                                                                                              | `registry.ts` → `isEnabled`                                           |

Les tests qui couvrent ces lignes : `packages/plugins/geocoding/src/__tests__/` — sept fichiers,
dont un **contrat de configuration** qui vérifie clé par clé la traduction vers les URL des
fournisseurs (PC-09).

---

## Configuration

Bloc `modules.geocoding` d'un profil, lu par `config.ts` → `getPluginConfig()` **via
`coreConfigGet` de `@geoleaf/host-runtime`** — la forme figée du contrat (§5).

| Clé            | Type                                     | Défaut                           | Rôle                                                                  |
| -------------- | ---------------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| `enabled`      | `boolean`                                | `false` — **strictement opt-in** | Monte le contrôle de recherche                                        |
| `provider`     | nom connu, ou URL HTTPS                  | la base d'adresses française     | Service interrogé ; une valeur non reconnue **retombe sur le défaut** |
| `debounceMs`   | `number`                                 | défaut du code                   | Anti-rebond de la frappe                                              |
| `minChars`     | `number`                                 | défaut du code                   | Longueur minimale avant requête                                       |
| `resultLimit`  | `number`                                 | défaut du code                   | Nombre de résultats proposés                                          |
| `position`     | l'un des quatre coins                    | défaut du code                   | Position du contrôle                                                  |
| `placeholder`  | `string`                                 | libellé i18n                     | Texte d'invite du champ                                               |
| `flyToZoom`    | `number`                                 | défaut du code                   | Zoom appliqué en volant vers un point                                 |
| `bbox`         | `[O, S, E, N]`                           | —                                | Restriction géographique — **traduction dépendante du fournisseur**   |
| `countrycodes` | codes pays ISO, séparés par des virgules | —                                | Restriction par pays — **un seul fournisseur l'applique**             |

⚠️ **Les valeurs par défaut ne sont pas recopiées ici**, sauf `enabled`. Elles vivent dans le code du
plugin et sont documentées dans le TSDoc de son type de configuration ; les recopier créerait une
troisième source après le type et le lecteur — exactement la divergence que
[`branding`](../capacites/branding.md) et [`cluster`](../capacites/cluster.md) ont dû réparer côté
capacités.

⚠️ **`enabled: false` reproduit le comportement historique du core** : le composant ne se monte que
si le profil le demande.

### Ce qui gate cette configuration, et ce qui ne la gate pas

| Dispositif                                       | Ce qu'il couvre                                                                                                                                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/__tests__/config-contract.test.ts`          | La **traduction** de chaque clé vers les URL des fournisseurs, et le repli de sécurité                                                                                                                                       |
| L'inventaire des paramètres du core (famille B2) | `modules.geocoding` y **figure** — le core en tient la trace documentaire                                                                                                                                                    |
| `profiles/schemas/*.json`                        | ❌ **Ne déclare pas** ces clés, et c'est **conforme** au contrat (§5) : le core ne déclare, ne valide ni ne défaute la configuration d'un plugin                                                                             |
| `PC-14` (`scripts/verify-plugin-contract.cjs`)   | La **branche**, pas les valeurs : tout `profileKey` déclaré par une source du plugin doit vivre sous `modules.geocoding`. `legacyProfileKey` en est exempt — c'est lui qui porte l'ancienne clé pour les profils déjà écrits |

⚠️ **Conséquence à connaître** : une clé mal orthographiée dans `modules.geocoding` n'est **rejetée
par rien** — ni par le validateur de profils, ni par le plugin, qui fusionne simplement sur ses
défauts. Le contrat prévoit d'ailleurs qu'un futur enregistrement de schéma par plugin fermerait ce
trou ; il n'existe pas encore.

---

## Contrat exposé

### API publique — `GeoLeaf.Geocoding`

Montée par `entry.ts`. `public-api.ts` est une façade **mince** : ses méthodes délèguent au registre,
sans logique (INV-FACADE).

| Membre                  | Rend / fait                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `isEnabled()`           | `true` quand le profil actif active la capacité                 |
| `search(query, limit?)` | Les résultats — **ne demande pas que l'interface soit visible** |
| `selectResult(result)`  | Vole vers le résultat **et** émet l'événement de sélection      |
| `open(button?)`         | Ouvre la pastille mobile et donne le focus au champ             |
| `destroy()`             | Démonte le contrôle et relâche les écouteurs                    |

La façade porte **deux `@example`** — une recherche par programme et l'écoute de l'événement de
sélection. ⚠️ Ces exemples sont **compilés** depuis le 27/07/2026 : les `@example` du TSDoc de
toutes les sources entrent dans `typecheck-docs-examples`.

Typage publié : `global.d.ts` déclare `Geocoding?: unknown`. Le namespace **existe donc au niveau des
types** — une faute de frappe sur son nom ne compile pas — mais **la forme des appels n'est pas
vérifiée**. C'est la traîne de membre encore ouverte.

### Événements

| Événement                  | Sens       | Émis où        | Détail                                         |
| -------------------------- | ---------- | -------------- | ---------------------------------------------- |
| `geoleaf:geocoding:result` | **émis**   | Sur `document` | Libellé et coordonnées du résultat choisi      |
| `geoleaf:map:ready`        | **écouté** | —              | Déclenche le montage du contrôle               |
| `geoleaf:toolbar:action`   | **écouté** | —              | Ouvre la pastille quand l'action est la sienne |

⚠️ **`geoleaf:geocoding:result` est un événement de plugin non typé, et il EST suivi.** La gate
EVENT-MAP scanne **tous** les paquets de l'espace de travail — pas seulement le core —, donc cet
événement est dans la baseline des non typés, dont la liste **ne peut que rétrécir**. Le typer
consiste à ajouter sa clé dans le contrat d'événements du core puis à retirer sa ligne de la
baseline.

Le seam de barre d'outils est consommé via le **type publié** `GeoLeafRawEventMap` importé de
`@geoleaf/core` — et non par une re-déclaration locale. C'était le geste de l'API publique S3 :
sept plugins en portaient **quatre formes divergentes**.

---

## Décisions de conception

| Décision                                                         | Pourquoi                                                                                                                                                        | Alternative écartée                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Base d'adresses française par défaut**                         | Aucune clé d'API, aucun quota pour un trafic raisonnable, et une qualité supérieure sur le territoire visé par la majorité des déploiements                     | Un service mondial par défaut — moins précis là où le produit sert le plus                         |
| **Quatre fournisseurs derrière une seule interface**             | Les réponses sont normalisées vers une forme unique : l'interface et l'API publique ne savent pas quel service a répondu                                        | Exposer la réponse brute — chaque intégrateur devrait la normaliser                                |
| **Repli du fournisseur sur une valeur non reconnue**             | Cette clé vient d'un profil, donc d'une source que le plugin ne contrôle pas : une valeur exotique ne doit jamais devenir une URL appelée                       | Lever, ou appeler la valeur telle quelle                                                           |
| **L'emprise est traduite par fournisseur**                       | Deux d'entre eux ont un filtre strict, la base française n'en a pas : lui passer un centroïde en biais de proximité est le comportement le plus proche possible | Ignorer l'emprise là où le filtre strict n'existe pas — l'intégrateur ne comprendrait pas pourquoi |
| **Libellés posés en texte, jamais en HTML**                      | Les résultats viennent d'un service tiers ; le texte rend l'injection impossible **par construction** plutôt que par assainissement                             | Assainir du HTML — un chemin de plus à ne jamais oublier                                           |
| **Interface mobile seulement dans la barre d'outils**            | Sur grand écran la barre est visible en permanence : une pastille serait un doublon                                                                             | Enregistrer aussi un bouton d'onglet de bureau                                                     |
| **Masquage par CSS plutôt qu'enregistrement conditionnel**       | Un seul enregistrement, une seule source de vérité sur l'existence du créneau ; c'est l'affichage qui dépend de la largeur                                      | Enregistrer selon la largeur — l'état dépendrait du moment du chargement                           |
| **i18n enregistrée en PREMIER**                                  | Les libellés doivent être résolus avant tout rendu ; sinon la barre d'outils s'affiche avec des clés brutes                                                     | L'enregistrer après le montage                                                                     |
| **Clés i18n plates et pointées**                                 | La table du core est indexée **directement** et ne découpe pas sur le point : un dictionnaire imbriqué résoudrait vers rien, en silence                         | Des dictionnaires imbriqués — l'échec serait invisible                                             |
| **Configuration lue paresseusement**                             | Permet un rechargement de profil à chaud sans réinitialiser le registre, donc sans perdre l'état du contrôle                                                    | Lire une fois à l'initialisation                                                                   |
| **Vue structurelle locale de l'adaptateur**                      | Le plugin ne pilote que trois méthodes de carte ; dépendre de tout le contrat d'adaptateur le coupleraient au paquet de l'adaptateur                            | Importer le contrat complet                                                                        |
| **Accès au namespace par la fonction d'accès de `host-runtime`** | C'est le geste récent : les treize plugins re-déclaraient chacun sa propre paire « interface d'hôte + transtypage de `globalThis` »                             | La forme manuelle — encore celle de `cog`, `flatgeobuf` et `file-import`                           |

---

## Dépendances et frontières

### Conformité au contrat gelé

Vérifié par `scripts/verify-plugin-contract.cjs`, bloquant dans `ci:local` et `.husky/pre-commit`.

⚠️ **C'est le seul plugin du lot que PC-13 concerne** : il a une CSS. Le contrôle exige que le style
passe par l'API du modèle de style (INV-CSS) et **interdit** un `<style>` injecté ou une inclusion de
CSS par le greffon de build. La feuille est donc importée par `entry.ts` et traitée par la chaîne de
construction.

PC-07 le concerne aussi — pas d'écriture brute de HTML hors des helpers de sécurité —, et le plugin
y répond par un choix plus fort que la conformité : il n'écrit **jamais** de HTML pour les données
qu'il affiche.

### Dépendances

| Dépendance              | Nature                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@geoleaf/core`         | Déclaré en **`peerDependencies`** depuis le 25/08/2026, doublé en `devDependencies` pour que l'espace de travail résolve et teste — jamais en `dependencies` : deux bornes disjointes installeraient deux copies du core derrière un namespace unique. Chargé **après** le core, **avant** `boot()`. Consommé **en type** pour le seam de barre d'outils |
| `@geoleaf/host-runtime` | Consommé **fonctionnellement** — `getGeoLeaf()`, `coreConfigGet()` et `tLabel()` (`control.ts`), pas seulement des types                                                                                                                                                                                                                                 |

⚠️ **Deux générations de plugins coexistent dans ce lot.** `geocoding` consomme `host-runtime` par
ses fonctions ; `cog`, `flatgeobuf` et `file-import` n'en prennent qu'un type et refont le
transtypage de `globalThis` à la main. Aucun contrôle du contrat ne l'impose — ce n'est donc pas une
non-conformité —, mais la forme de `geocoding` est celle vers laquelle les autres doivent aller.

**Aucun import de MapLibre dans le code** — le plugin ne pilote la carte que par la vue structurelle d'adaptateur ci-dessus. ⚠️ Le manifeste, lui, **déclare** `maplibre-gl` en `peerDependencies` (borne resserrée lors de la montée du moteur). PC-10 n'a donc rien à exiger ici — il ne réclame la borne que si `rollup.config.mjs` mentionne le moteur, ce que celui-ci ne fait pas — et rien à reprocher : la seule forme qu'il interdit est une `dependencies`.

### Frontières

- **Aucun couplage à un autre plugin** — `requires` et `optional` vides, et vrai au sens fort.
- ⚠️ **Un couplage de fait avec la capacité `filter`** existe côté produit (chercher une adresse puis
  filtrer autour) mais **aucun lien de code** : ni l'un ni l'autre ne se référence.
- **Requêtes réseau vers un tiers** : c'est le seul plugin du lot qui appelle un service externe par
  défaut. La conséquence à énoncer à l'intégrateur est une **politique de sécurité de contenu** qui
  autorise le point d'accès choisi.
- **CSS propre**, sous la chaîne de construction, avec un seuil de largeur qui décide de la forme
  affichée.
- 🛑 **`src/ui/pill-search.ts` est une COPIE DÉLIBÉRÉE du core, épinglée par empreinte.** INV-NS
  interdit au plugin d'importer les sources du core : la pastille est donc recopiée, et son
  `_createIcon` réimplémente localement l'équivalent de `DOMSecurity.createSVGIcon` — cette
  divergence-là est attendue. La paire (`packages/core/src/kernel/ui/pill-search.ts` ↔ ce fichier)
  est enregistrée dans `scripts/verify-seam-drift.cjs`, câblé dans `ci:local` et dans la CI :
  **éditer ce fichier fait rougir la gate** tant que la copie du core n'a pas été RELUE et les deux
  empreintes ré-épinglées. Le ré-épinglage se fait ciblé, jamais en global — un global absorberait
  aussi une dérive réelle ailleurs sans la montrer.

---

## Écarts au CDC source

Le CDC `CDC_plugin-geocoding.md` a été **consommé** en écrivant cette fiche, puis retiré du dossier
de tri — trace au §Journal des décisions de
la refonte documentaire V3.

| Énoncé du CDC                                    | Ce que dit le dépôt                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Défauts de configuration recopiés en clair       | Non repris : ils vivent dans le type et le lecteur du plugin. Les recopier ferait une troisième source                         |
| `geocodingConfig` à la racine du profil          | **Migré** vers `modules.geocoding` (contrat v1, INV-CONFIG) ; l'ancienne clé racine a été retirée du core en clôture S14       |
| Le bouton décrit comme présent sur bureau        | **Mobile seulement** : aucun bouton d'onglet de bureau n'est enregistré, la barre étant visible en permanence au-delà du seuil |
| ✅ Les quatre fournisseurs et leur normalisation | **Exacts**                                                                                                                     |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : les cas d'usage, le choix de la base
d'adresses française comme défaut (couverture et absence de clé d'API), et les alternatives écartées
de la table §Décisions.
