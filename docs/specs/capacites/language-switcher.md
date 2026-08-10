---
type: spec-capacite
title: language-switcher — le sélecteur de langue de l'interface
capability_id: language-switcher
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 5535694b
date: 27 juillet 2026
---

# language-switcher — le sélecteur de langue de l'interface

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/language-switcher/` ·
**Vérifié contre :** `5535694b` (27/07/2026)

> **Deux règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.

---

## Périmètre

### Ce que la capacité fait

Elle pose un **bouton de langue** à deux endroits — le bandeau d'onglets du panneau desktop et la
barre d'outils mobile —, ouvre un **popover** listant les langues offertes, persiste le choix et
recharge la page dessus.

Elle n'ajoute **aucun poids de traduction** : les dictionnaires sont déjà compilés dans le core.
Elle ne fait qu'**exposer un choix** entre eux.

### Ce qu'elle ne fait pas

- **Elle ne traduit pas les DONNÉES.** L'i18n couvre le _chrome_ — boutons, panneaux, messages.
  Les noms de POI et les libellés de couches viennent des profils, et les traduire supposerait des
  champs multilingues dans le modèle de données.
- **Elle ne bascule pas à chaud** : changer de langue **recharge la page**. Voir §Décisions.
- **Elle ne résout pas la langue au boot** — c'est `utils/i18n/i18n.ts` → `initI18n()` qui arbitre
  les sources ; la capacité ne fait qu'**écrire** dans deux d'entre elles.
- **Elle n'ajoute pas de langue.** Le jeu offert est celui des dictionnaires compilés ; en ajouter
  une est un geste kernel (`LANGS` + un `src/lang/lang-<code>.ts`).
- **Elle ne détecte pas `navigator.language`** — non instruit : l'interaction avec la persistance
  et avec le partage de lien demande d'être tranchée d'abord.

---

## Fonctionnalités

| ID    | Fonctionnalité                           | Entrée                                                    | Sortie observable                                                                                                  | Code                                                                                   |
| ----- | ---------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| LS-01 | Bouton dans le bandeau d'onglets desktop | Seam `geoleaf:desktop-panel:tabs-ready`, capacité activée | `.gl-rp-tab-btn.gl-rp-lang-btn` inséré **avant** `.gl-rp-theme-toggle` (repli : appendu en fin de bandeau)         | `language-button.ts` → `appendLanguageButtonToTabs`                                    |
| LS-02 | Rattrapage d'un bandeau déjà construit   | `.gl-rp-tabs` présent au moment de l'`init()`             | Même insertion, sans attendre un prochain seam                                                                     | `lifecycle.ts` → `init`                                                                |
| LS-03 | Bouton dans la barre d'outils mobile     | `.gl-map-toolbar__scroll` (repli `.gl-map-toolbar`)       | Même bouton, plus la classe `.gl-map-toolbar__btn` et `data-variant="mobile"`                                      | `lifecycle.ts` → `_tryInjectMobile`                                                    |
| LS-04 | Attente de la barre d'outils             | Barre construite **après** l'`init()`                     | Un `MutationObserver` sur `document.body` injecte dès qu'elle apparaît, **puis se déconnecte**                     | `lifecycle.ts` → `init`                                                                |
| LS-05 | Insertion idempotente                    | Seam qui refire, ou deux voies d'injection                | Un seul bouton par conteneur — la classe du bouton sert de marqueur                                                | `language-button.ts`, `lifecycle.ts`                                                   |
| LS-06 | Popover des langues offertes             | Clic sur le bouton                                        | `.gl-lang-popover` en `role="menu"`, une ligne `role="menuitem"` par langue, glyphe + endonyme en `textContent`    | `language-button.ts` → `_buildPopover`                                                 |
| LS-07 | Langue active marquée                    | Popover ouvert                                            | `aria-current="true"` sur la ligne de la langue active                                                             | `language-button.ts` → `_buildPopover`                                                 |
| LS-08 | Fermeture au clic extérieur              | Clic hors du popover et hors du bouton                    | Popover retiré, écouteurs de document relâchés — écoute en **phase de capture**                                    | `language-button.ts` → `_openFor`                                                      |
| LS-09 | Fermeture au clavier                     | `Échap`                                                   | Popover retiré **et focus rendu au bouton** — c'est ce qui rend `Échap` utilisable au clavier                      | `language-button.ts` → `_openFor`                                                      |
| LS-10 | Second clic referme                      | Clic sur le bouton, popover déjà ouvert                   | Bascule fermée, aucun second popover                                                                               | `language-button.ts` → `_openFor`                                                      |
| LS-11 | Bascule de langue                        | Choix d'une ligne, ou `switchTo(code)`                    | Écriture `localStorage`, puis rechargement sur l'URL portant `?lang=<code>`                                        | `language-switch.ts` → `switchToLanguage`                                              |
| LS-12 | Rejet d'un code forgé                    | `switchTo("../fr")`, `switchTo("fra")`                    | Refus journalisé, **aucune écriture, aucune navigation** — forme acceptée : deux lettres minuscules                | `language-switch.ts` → `LANG_CODE_RE`                                                  |
| LS-13 | Navigation privée tolérée                | `localStorage` indisponible                               | La bascule s'applique tout de même à ce chargement via `?lang=`, sans être mémorisée                               | `language-switch.ts`                                                                   |
| LS-14 | Restriction de la liste offerte          | `languages: ["fr","en"]`                                  | Seules ces entrées sont proposées                                                                                  | `config.ts` → `getOfferedLanguages`                                                    |
| LS-15 | Code inconnu écarté **en silence**       | `languages: ["fr","xx"]`                                  | `xx` est **abandonné sans avertissement** — offrir une langue sans dictionnaire basculerait l'UI sur un repli muet | `config.ts` → `getOfferedLanguages`                                                    |
| LS-16 | Filtre vide neutralisé                   | `languages: ["zz"]` (ne correspond à rien)                | Repli sur **toute** la liste — un popover vide serait pire qu'un filtre ignoré                                     | `config.ts` → `getOfferedLanguages`                                                    |
| LS-17 | `display` invalide neutralisé            | `display: "drapeau"`                                      | Lu comme `"flag"` : une faute de frappe ne doit pas rendre un bouton vide                                          | `config.ts` → `getLanguageSwitcherConfig`                                              |
| LS-18 | Démontage complet                        | `LanguageSwitcherModule.destroy()` / `_reset()`           | Popover fermé, observateur déconnecté, écouteur du seam détaché, **tous** les boutons retirés du document          | `lifecycle.ts` → `_reset` ; `language-button.ts` → `removeLanguageButtonsFromDocument` |
| LS-19 | Déclaration introspectable               | —                                                         | `getAllCapabilities()` la liste, `getCapabilitySchema("language-switcher")` rend son schéma sans `loader`          | `language-switcher-capability.ts`                                                      |

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/language-switcher/` — dont
une série dédiée à **l'ordre de résolution de `initI18n()`** et un test qui vérifie que **le kernel
émet réellement le seam** du bandeau d'onglets.

---

## Configuration

Bloc `modules.language-switcher` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre   | Type      | Défaut   | Où c'est lu                                                                                                  |
| ----------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `enabled`   | `boolean` | `false`  | `config.ts` → `getLanguageSwitcherConfig()` ; **décide de la visibilité** dans `lifecycle.ts` (gate tardif)  |
| `display`   | `string`  | `"flag"` | `config.ts` → `getLanguageSwitcherConfig()`, qui **normalise** toute valeur autre que `"code"` vers `"flag"` |
| `languages` | `array`   | `[]`     | `config.ts` → `getOfferedLanguages()`. **Vide signifie « toutes »**, pas « aucune » — voir ci-dessous        |

Le bloc vit à la **racine** (`profiles/geoleaf.config.json`) : la langue de l'interface ne doit pas
dépendre du profil de données affiché.

⚠️ **`languages: []` n'est pas un défaut vide, c'est un défaut _ouvert_.** Le schéma annonce le
tableau vide, et le lecteur l'interprète comme « offrir tous les dictionnaires compilés ». Trois
replis en cascade protègent cette clé, parce qu'un popover vide est un cul-de-sac d'interface :
absente ou vide → toutes ; codes inconnus → écartés ; filtre qui ne correspond à rien → toutes.

⚠️ **Double gate, comme [`theme-toggle`](theme-toggle.md) et
[`profile-switcher`](profile-switcher.md)** : `enableWhenAbsent: true` ne concerne que
l'enregistrement du module avant fusion ; le **défaut destiné à l'intégrateur est OFF**, décidé par
le gate tardif du cycle de vie. Le CDC source annonçait `false` — voir §Écarts au CDC.

### Les langues offertes, et le 7ᵉ nom qui n'est pas une langue

`config.ts` → `SUPPORTED_LANGUAGES` énumère les langues proposées, avec pour chacune son
**endonyme** (`Français`, `English`, `Español`, `Português`, `Italiano`, `Deutsch`) et son emoji
régional. La liste est module-locale : le seul chemin d'accès est `getOfferedLanguages()`, qui
applique le filtre.

⚠️ **`LANGS` (dans `utils/i18n/i18n.ts`) porte une clé de plus que le nombre de dictionnaires** :
`al` est un **alias** vers le dictionnaire allemand (abréviation française d'« Allemand »), pas une
langue supplémentaire. Compter les clés de `LANGS` pour compter les langues donnerait donc un
résultat faux. Conséquence pratique : `?lang=al` fonctionne, et `getActiveLang()` rend `de` — il
dérive la clé du dictionnaire actif et rencontre `de` avant `al`, donc le bouton affiche le bon
glyphe. La forme acceptée par `switchToLanguage` (deux lettres minuscules) laisse aussi passer
`al`, bien qu'il ne soit pas offert dans le popover.

### Endonymes, et pourquoi ce n'est pas un détail

Chaque langue se nomme **dans sa propre langue**. Quelqu'un qui atterrit sur une page rédigée dans
une langue qu'il ne lit pas reconnaît tout de même « Deutsch » ou « Español » ; « Allemand » ne lui
servirait à rien. C'est écrit sur place dans `config.ts`, et c'est la raison pour laquelle ces
libellés **ne passent pas par l'i18n**.

---

## Contrat exposé

### API publique

`GeoLeaf.LanguageSwitcher`, construit par `public-api.ts` → `buildPublicApi()`, monté par
`install.ts` → `registerGlobals(gl)`, re-exporté par la façade ESM
`src/api/geoleaf.language-switcher.ts` (sans logique — gate `scripts/check-facade-purity.cjs`).

| Membre           | Rend / fait                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `list()`         | Les langues offertes (`code`, `label`, `flag`), filtre appliqué                                 |
| `current()`      | Le code actif — **délègue à `getActiveLang()`**, donc les deux ne peuvent pas divulguer d'écart |
| `switchTo(code)` | Persiste et recharge avec `?lang=` — **valide le code d'abord**                                 |
| `isEnabled()`    | `true` quand `modules.language-switcher.enabled === true`                                       |
| `getConfig()`    | Le bloc `modules.language-switcher` fusionné et **normalisé**                                   |

`current()` ne recalcule rien : l'i18n dérive son résultat du dictionnaire actif. C'est ce qui
rend impossible une dérive entre la langue **appliquée** et la langue **annoncée**.

Typage publié : `src/global.d.ts`, section des capacités (`LanguageSwitcher?:` →
`LanguageSwitcherPublicApi`). Ne pas citer de numéro de ligne pour ce fichier.

### Événements

| Événement                          | Sens                     | Rôle                                                             |
| ---------------------------------- | ------------------------ | ---------------------------------------------------------------- |
| `geoleaf:desktop-panel:tabs-ready` | **écouté** (seam kernel) | Porte le bandeau d'onglets vivant — le point d'insertion desktop |

La capacité **n'émet aucun événement**. Le seam est un **`CustomEvent` brut** (son `detail` porte
un `HTMLElement`, que le bus assainissant ne peut pas transporter) et il est émis
**synchronement**, une fois par construction de panneau — c'est ce qui garantit que les abonnés
injectent dans le même tick et que l'ordre des boutons est préservé.

Côté mobile il n'y a **pas de seam** : la barre d'outils est construite de façon asynchrone, d'où
l'observateur de mutations (LS-04).

### Stockage écrit et paramètre d'URL

| Canal                     | Portée        | Rôle                                                                              |
| ------------------------- | ------------- | --------------------------------------------------------------------------------- |
| `?lang=<code>` dans l'URL | ce chargement | Rend **ce** chargement déterministe, et c'est la source que l'i18n lit en premier |
| `localStorage["gl-lang"]` | durable       | La préférence, restaurée aux visites suivantes (`LANG_STORAGE_KEY`)               |

Ordre de résolution, dans `initI18n()` : `?lang=` → `localStorage["gl-lang"]` → `ui.language` →
français.

⚠️ **Deux invariants du kernel dont cette capacité dépend, et qu'il ne faut pas casser :**

1. **`?lang=` reste au sommet.** Si la préférence enregistrée primait, la même URL montrerait une
   langue différente selon le visiteur : le lien cesserait d'être une référence reproductible.
   `initI18n()` porte cette raison en commentaire, à l'endroit exact où l'ordre est écrit.
2. **La lecture du stockage est enveloppée d'un `try/catch`.** `initI18n()` tourne **avant** le
   premier `getLabel()` ; l'accès au stockage **jette** en navigation privée sur certains moteurs,
   et une exception là emporterait tout le boot. Le repli silencieux sur la langue configurée est
   le seul comportement acceptable. `_readStoredLang()` porte cet avertissement.

Un code inconnu (URL ou stockage) retombe sur le français sans casser le boot.

---

## Décisions de conception

| Décision                                                    | Pourquoi                                                                                                                                                                             | Alternative écartée                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **Bouton + popover**, pas un `<select>`                     | Le bandeau d'onglets est vertical et étroit ; un `<select>` n'y tient pas. Le patron « bouton icône → popover » est celui de `share` et du toggle de thème                           | Un `<select>` dans un bandeau supérieur — il n'y a plus de bandeau supérieur     |
| **Bascule = rechargement**                                  | `initI18n()` fige le dictionnaire actif au boot, et chaque libellé est résolu à la **construction** de son nœud DOM. Une bascule à chaud imposerait de re-rendre toute l'interface   | Le re-rendu à chaud                                                              |
| **Priorité au paramètre d'URL**                             | Un lien partagé doit rendre la même chose pour son destinataire que pour son auteur                                                                                                  | Faire primer la préférence enregistrée — le partage deviendrait non déterministe |
| **Deux canaux, deux rôles** (URL + `localStorage`)          | L'URL rend ce chargement reproductible ; le stockage porte la préférence. Un seul canal perdrait l'un des deux                                                                       | Un seul canal                                                                    |
| **`display: "flag" \| "code"`, prévu dès la spécification** | Les emojis-drapeaux régionaux ne sont pas dessinés par toutes les plateformes. `"code"` est l'échappatoire **par configuration**, sans toucher au code                               | Ne prévoir que l'emoji, et découvrir le problème sur le poste d'un utilisateur   |
| **Un `display` invalide vaut `"flag"`**                     | Une faute de frappe dans un profil rendrait un bouton **vide** — un contrôle invisible qu'on ne sait pas diagnostiquer                                                               | Laisser la valeur telle quelle, ou lever                                         |
| **Trois replis sur `languages`**                            | Un popover vide est un cul-de-sac : l'utilisateur clique et ne peut rien choisir. Chaque repli couvre une façon différente d'arriver à zéro entrée                                   | Un seul contrôle de validité                                                     |
| **Codes inconnus écartés en silence**                       | Offrir une langue sans dictionnaire basculerait l'UI sur un repli muet — pire qu'une entrée manquante                                                                                | Les honorer, ou lever                                                            |
| **Libellés en endonymes, hors i18n**                        | Un utilisateur perdu dans une langue qu'il ne lit pas doit reconnaître la sienne                                                                                                     | Traduire les noms de langues — « Allemand » n'aide pas un germanophone égaré     |
| **Deux voies d'injection, un seul composant**               | Desktop et mobile n'ont ni le même conteneur ni le même moment de construction, mais le comportement doit être identique                                                             | Deux composants — deux comportements à maintenir en phase                        |
| **Écoute en phase de capture** pour la fermeture            | La carte avale les clics qui remontent sur certaines surfaces : en phase de bulle, le popover resterait ouvert                                                                       | La phase de bulle                                                                |
| **`Échap` rend le focus au bouton**                         | Sans retour de focus, la fermeture au clavier laisse l'utilisateur nulle part                                                                                                        | Fermer seulement                                                                 |
| **`_reset()` interroge tout le document**                   | Le bouton est injecté dans des conteneurs que la capacité ne possède pas, depuis **deux** points d'entrée : le démontage ne doit pas dépendre de l'appelant                          | Une portée limitée à un conteneur mémorisé                                       |
| **Classes CSS écrites en littéraux**                        | purgecss lit les sources statiquement : un nom composé est déclaré règle morte et **la règle part du CSS de production**. Le contrôle s'afficherait sans style, tous les tests verts | `` `${ROOT}__item` `` — c'est le piège dans lequel le sprint précédent est tombé |
| Pas de `loader`                                             | Inline avec le bundle UI ; le gate de configuration décide                                                                                                                           | Un `import()` paresseux                                                          |

---

## Dépendances et frontières

### Dépendance de cycle de vie

`module.ts` → `LanguageSwitcherModule` : `id = "language-switcher"`,
`dependencies = ["geojson"]` — pour que l'`init()` passe avant que le bandeau d'onglets desktop
puisse s'annoncer. `init()` **n'utilise pas la carte** : les deux points de montage sont hors
carte.

Position dans `presets/manifest.full.ts` : **appendue** au moment de son ajout, et un test le
vérifie — l'ordre d'enregistrement est observable par introspection, donc appendre laisse tous les
index antérieurs intacts.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                                               | Statut vis-à-vis de R.8                  |
| ---------------------------------------------------- | ---------------------------------------- |
| `kernel/config/config-primitives.js`                 | **Exception** nommée par la règle        |
| `kernel/ui/desktop/desktop-tabs-seam.js` (type seul) | **Seam** — exception nommée par la règle |

Le reste passe par `utils/` : `utils/log`, `utils/general/dom-helpers` (`domCreate`), et
`utils/i18n/i18n` — dont elle consomme `getLabel`, `getActiveLang` et `LANG_STORAGE_KEY`.

⚠️ **`LANG_STORAGE_KEY` est importée, jamais recopiée.** La capacité écrit la clé que l'i18n lit :
deux littéraux indépendants divergeraient sans qu'aucune gate ne le voie, et la préférence
cesserait silencieusement d'être relue au boot.

### Ce que la capacité ne touche pas

- **Aucun accès à la carte**, aucun `IMapAdapter` utilisé (la signature `init(adapter, config)` du
  contrat est honorée, les deux arguments sont ignorés).
- **Aucune référence à un plugin** — règle `no-plugin-in-core`, vérifiée par
  `scripts/verify-core-standalone.cjs`. Les dictionnaires de plugins (`registerDict`) sont gérés
  par l'i18n kernel, sans passer par ici.

### Frontière côté CSS

`css/language-switcher.css`, sous `@layer gl.capabilities`, tirée par `install.ts` — l'importer
est la seule chose qu'un consommateur fait pour embarquer la capacité, donc **la feuille se
tree-shake avec le code**. Elle ne contient que les surcharges propres au bouton : la base
`.gl-rp-tab-btn` (taille, teinte, survol) appartient au bandeau d'onglets, et ce bouton est le seul
de la pile à rendre **du texte** là où ses voisins rendent un SVG.

---

## Écarts au CDC source

Le CDC `CDC_capacite-language-switcher.md` (v1.0.0, 25/07/2026) a été **consommé** en écrivant
cette fiche, puis retiré du dossier de tri — trace au §Journal des décisions de
`roadmap_documentation-v3.md`.

| Énoncé du CDC                                                         | Ce que dit le code                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Décision 3 — gate opt-in avec **`enableWhenAbsent: false`**           | `enableWhenAbsent: **true**` — enregistrement seul, plus un gate tardif. Sémantique visible identique (opt-in), mécanisme différent                |
| « `languages` — défaut : **les 6 dictionnaires** »                    | Le schéma annonce **`[]`**, et le lecteur l'interprète comme « toutes ». L'**effet** décrit est juste, la **valeur déclarée** ne l'est pas         |
| « Un code inconnu est ignoré **avec avertissement** »                 | Il est ignoré **en silence** : `getOfferedLanguages()` filtre sans journaliser. Seul `switchToLanguage` avertit, et sur la _forme_ du code         |
| « 6 langues » (rapporté aux clés de `LANGS`)                          | **6 dictionnaires**, mais **7 clés** dans `LANGS` : `al` est un alias vers l'allemand. L'énoncé est juste sur les dictionnaires, faux sur les clés |
| « 1 ligne kernel modifiée », « 28 px », seuils de couverture en clair | Chiffres mesurables recopiés — non repris ici, par la règle 1                                                                                      |
| « gate `verify-facade-purity` »                                       | Le script est `scripts/check-facade-purity.cjs` ; son décompte est celui qu'il imprime                                                             |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : les cas d'usage (démonstration
internationale, déploiement public multilingue, lien partagé imposant sa langue, intégrateur
mono-langue qui ne configure rien), l'origine — le sprint T1b a supprimé la couche de démonstration
qui portait ce sélecteur, **sans migration** —, et les alternatives écartées de la table §Décisions.
