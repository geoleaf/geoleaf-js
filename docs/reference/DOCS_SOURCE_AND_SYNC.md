# La règle documentaire — où s'écrit quoi, et qui fait foi

> **Ce document est la règle.** S'il contredit une autre page sur l'emplacement ou l'autorité
> d'une documentation, c'est lui qui a raison — et l'autre page est à corriger.
>
> Réécrit le **11/08/2026**. Ce qu'il disait avant est en fin de page, avec ce qui l'a démenti :
> trois de ses affirmations étaient fausses au moment où on les a mesurées.

---

## 1. La règle — trois régimes, trois lieux, et rien ne se dit deux fois

| Régime        | Lieu                                                 | Lecteur             | Ce qu'on y écrit                                                                    |
| ------------- | ---------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| **USAGE**     | `packages/core/docs/` → site `www.geoleaf.dev/docs/` | l'**intégrateur**   | démarrage, tutoriels, recettes, guides de configuration, README de module           |
| **CONTRAT**   | `docs/specs/`                                        | le **contributeur** | périmètre, table de configuration, API exposée, décisions, frontières               |
| **RÉFÉRENCE** | **générée, jamais rédigée**                          | les deux            | TypeDoc + les 6 artefacts de `docs/reference/` (voir §3)                            |
| _(interne)_   | `_docs_projet/`                                      | l'atelier           | journal, état, registres, roadmaps, rapports — **ne part pas dans le dépôt public** |
| _(partagé)_   | `_docs_communs/`                                     | l'atelier           | conventions et gabarits inter-projets — jonction NTFS, non versionnée ici           |

**La clause qui gouverne les quatre : ce dont on n'est pas sûr n'est pas publié.** Il reste suivi
dans le dépôt de travail et bascule après vérification. Publier une page douteuse coûte plus que
de ne pas la publier : un tarball npm est immuable, et un dépôt public ne se dé-publie pas.

### Les deux corollaires qui évitent le doublon

1. **Un sujet, un lieu.** Une capacité a **une** fiche de contrat et **une** page d'usage. Les
   deux se renvoient l'une à l'autre en une ligne ; elles ne se recopient pas. Une divergence
   entre elles est un **défaut**, pas une nuance de point de vue.
2. **Ce qui peut être dérivé ne s'écrit pas à la main.** Une table qui restate un schéma
   rediverge — c'est mesuré, pas supposé (§4).

---

## 2. Où atteint-elle son lectorat — les trois canaux, et ce que chacun emporte

| Canal        | Contenu                                                | Mécanisme                                                                             |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **le site**  | `packages/core/docs/` rendu par VitePress + le TypeDoc | `npm run docs:deploy` — **manuel**, écrit hors du dépôt sous `GEOLEAF_DOCS_SITE_ROOT` |
| **le dépôt** | `docs/` + `packages/core/docs/` + les 20 README        | GitHub, en clair                                                                      |
| **npm**      | `README.md` + `dist/` **seulement**                    | `files[]` de chaque paquet ; le TSDoc voyage dans les `.d.ts`                         |

⚠️ **`docs/` a quitté les `files[]` le 11/08/2026** (`@geoleaf/core`, `connector`, `offline-ui`).
Un tarball n'emporte plus que sa vitrine et son `dist/`. **Conséquence à ne pas oublier en
écrivant un README de paquet : ses liens relatifs vers `./docs/` seraient morts chez le
consommateur npm — les écrire en URL absolue.** Aucune gate ne peut le voir : `check-dead-links`
résout contre le disque du dépôt, où les fichiers sont toujours là.

### 🛑 Un README de paquet PUBLIÉ n'écrit pas d'alerte GitHub — `npmjs.com` ne les rend pas

Mesuré le 14/08/2026 sur la page de `@geoleaf/core` : les alertes GitHub (`> [!NOTE]`,
`> [!WARNING]`, `> [!IMPORTANT]`, `> [!TIP]`, `> [!CAUTION]`) sont une **extension propre à
GitHub**. Le moteur Markdown du registre les traite comme une citation ordinaire et affiche le
marqueur en **texte littéral** — donc l'encadré promis devient une ligne de bruit AU-DESSUS de
l'avertissement qu'il devait souligner. 18 alertes vivaient ainsi dans 6 des 14 README publiés.

**Le geste : `> **Warning** — …`**, qui rend à l'identique des deux côtés. La correspondance est
`[!NOTE]` → `**Note**`, et ainsi de suite. Quand le corps ouvrait déjà sur une phrase en gras, le
label absorbe l'emphase (elle ne compensait que l'icône absente) : pas de double gras.

⚠️ **La règle est INVERSE ailleurs, et l'élargir la rendrait fausse.** Le `README.md` racine
(paquet `private`, jamais publié) et tout `docs/` sont lus sur **GitHub** et via **VitePress**, qui
rendent les alertes correctement. Elles doivent y rester — 7 vivent à la racine, 1 dans
`host-runtime`. C'est le contresens de relecture le plus probable : on convertit les paquets, on
voit les alertes restantes à la racine, et on « finit le travail ».

✅ **Gaté** par `scripts/verify-npm-readme-render.cjs` (`NPMDOC-01/02/03`), périmètre dérivé de
`registry.publishable()` — donc un paquet qui cesse d'être `private` entre dans le périmètre le
jour même.

### 🛑 Le site et le dépôt sont DEUX espaces de liens, et un lien qui les traverse doit être absolu

Mesuré le 11/08/2026, en faisant échouer le build : VitePress a pour racine
`packages/core/docs/` (`srcDir: "."`). **Un lien relatif qui sort de ce répertoire — vers
`docs/specs/`, vers `docs/reference/` — est un lien mort POUR LE SITE**, même s'il résout
parfaitement sur le disque et même si `check-dead-links` l'accepte. `ignoreDeadLinks: false`
fait alors échouer `docs:build`, qui est une gate de `ci:local`.

**Le geste : depuis `packages/core/docs/`, tout renvoi hors du site s'écrit en URL absolue**
(`https://github.com/geoleaf/geoleaf-js/blob/main/…`). Dans l'autre sens — depuis `docs/specs/`
vers `packages/core/docs/` — le relatif convient : ces fichiers ne sont pas servis par VitePress.

⚠️ **`docs.geoleaf.dev` n'existe pas** : le sous-domaine rend **NXDOMAIN**. La doc est servie sur
**`www.geoleaf.dev/docs/`** (HTTP 200), et le TypeDoc sur `www.geoleaf.dev/docs/api/` (200).
Ne pas recopier ces mesures : `curl -sSI` les rend.

⚠️ **Le rendu publié est en retard sur le dépôt** — il s'intitule « GeoLeaf Core API - v2.1.5 »
au 11/08/2026. Le producteur est **vivant** (`scripts/deploy-docs.cjs`) ; il est simplement
manuel et n'a pas été relancé. Ce n'est pas une chaîne cassée, c'est une chaîne non déclenchée.

---

## 3. Ce qui est GÉNÉRÉ — la liste, et sa gate

Aucun de ces fichiers ne s'édite à la main. Chacun a un `--check` câblé dans `ci:local` **et**
`ci.yml`, donc une modification de la source sans régénération **rougit**.

| Artefact                                        | Producteur                      | Gate                          |
| ----------------------------------------------- | ------------------------------- | ----------------------------- |
| `reference/ARBORESCENCE_QUALIFIEE.md` + `.html` | `npm run docs:tree`             | `docs:tree:check`             |
| `reference/PROFILE_SCHEMA_REFERENCE.md`         | `npm run gen:profile-schema`    | `gen:profile-schema:check`    |
| `reference/MODELE_ATTRIBUTAIRE.md`              | `npm run gen:attributes-report` | `gen:attributes-report:check` |
| `reference/API_SURFACE.txt`                     | `npm run gen:api-surface`       | `gen:api-surface:check`       |
| `reference/reference_parametres_config.html`    | `npm run gen:config-reference`  | `gen:config-reference:check`  |
| `packages/core/docs/api/` (TypeDoc)             | `npm run docs:api`              | **aucune** — voir ci-dessous  |

⚠️ **Le rendu TypeDoc n'est pas gatable, et c'est délibéré** : il grave `git rev-parse HEAD` dans
29 fichiers sur 54 mesurés, donc il n'a pas de point fixe — la gate rougirait au commit même qui
vient de le régénérer. C'est **`API_SURFACE.txt`** qui porte la garde : un manifeste d'une ligne
par réflexion, avec l'empreinte du TSDoc, insensible au re-wrap de Prettier. Il n'est pas fait
pour être lu ; il est fait pour qu'aucun changement d'API ne passe inaperçu.

### Deux références restent RÉDIGÉES, et la raison est mesurée

- **`packages/core/docs/API_REFERENCE.md`** — TypeDoc ne rend **aucune page pour
  `GeoLeafGlobal`**, l'interface qui décrit le namespace `GeoLeaf.*`. Vérifié : le nom
  n'apparaît dans le rendu que comme _type de retour_, sur 23 pages. Or `GeoLeaf.Layers`,
  `GeoLeaf.Config`… sont ce qu'un intégrateur appelle. La remplacer par un renvoi **retirerait**
  de l'information au lieu d'en dériver.
- **`packages/core/docs/EVENTS_API.md`** — un nom d'événement est une **chaîne**, jamais un
  symbole exporté : rien ne peut le dériver des signatures. La gate `EVENT-MAP` garde en
  revanche que tout événement émis est déclaré dans `GeoLeafEventMap`.

Ce sont les **deux seules** exceptions. Elles portent leur motif sur leur propre page ; toute
autre référence rédigée est un défaut à instruire, pas un précédent à invoquer.

---

## 4. Ce que coûte une table écrite à la main — trois mesures du 11/08/2026

Ce ne sont pas des exemples pédagogiques : ce sont les trois cas trouvés le jour où `docs/` est
entré dans le corpus des gates de doc.

| Où                                                            | Ce qu'elle annonçait       | Ce qui était vrai                                                               |
| ------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| `PROFILE_JSON_REFERENCE.md`                                   | « Référence **Complète** » | **127 chemins sur 476**, et **46 clés** qu'aucun schéma n'impose                |
| `GeoLeaf_GeoJSON_README.md`                                   | 14 propriétés de couche    | **3** existent dans le schéma ; `clustering` donné `boolean`, c'est un `object` |
| `ARCHITECTURE_GUIDE.md` · `GeoLeaf_core_README.md` · 2 fiches | 8 modules noyau            | **6** — et `boot-install.ts:110` l'écrit sur place depuis le S6                 |

**La leçon opératoire** : citer une commande au lieu d'un chiffre ne protège que si la commande
**voit tout**. `npm run gen:profile-schema:audit` imprime l'écart dans les deux sens ; c'est lui
qu'on cite, jamais le chiffre qu'il a rendu un jour.

---

## 5. Ce qui garde quoi — et ce que rien ne garde

| Objet gardé                                              | Par quoi                                               |
| -------------------------------------------------------- | ------------------------------------------------------ |
| API fantômes et noms de paquet périmés dans les exemples | `validate-docs-examples` — corpus `productDocsFiles()` |
| Compilation des exemples `ts` et des `@example`          | `typecheck-docs-examples` — **même corpus**            |
| Clés de config d'un exemple JSON absentes du schéma      | `check-doc-config-examples` — **même corpus**          |
| Liens markdown morts                                     | `check-dead-links` — 10 scopes, 3 avec plancher        |
| Chemins cités en backticks par `docs/specs/`             | `SPECS-PATHS`, baseline décroissante                   |
| Chemins cités en backticks par `docs/guides/`            | `GUIDES-PATHS` (11/08/2026), baseline décroissante     |
| Chemins cités en backticks par `_docs_projet/vision/`    | `VISION-PATHS` (17/08/2026), baseline décroissante     |
| Table `## Configuration` d'une fiche ↔ le `configSchema` | `doc-capability-config.guard.test.js`, **deux sens**   |
| Table `## Manifeste` d'une fiche plugin ↔ `entry.ts`     | `doc-plugin-manifest.guard.test.js`                    |
| Liens morts du site                                      | `docs:build` (`ignoreDeadLinks: false`)                |
| Alertes GitHub dans un README **publié** sur npm         | `NPM-README` (`verify-npm-readme-render.cjs`)          |

⚠️ **Le corpus des trois premières est `productDocsFiles()`** (`scripts/lib/tsdoc-examples.cjs`) :
**un seul corpus, trois consommateurs**. L'élargir les élargit toutes les trois — c'est voulu, et
c'est ce qui a fermé le trou du 11/08. Il porte trois planchers (`specs`, `reference`, `guides`)
qui font **jeter** si une sous-racine devient invisible : une gate qui perd sa cible ne rougit
pas, elle **se tait**.

🖐 **Ce que rien ne garde, et qui reste à toi** :

- **La véracité d'une phrase.** « Met en cache 5 minutes » sur une fonction qui en cache 10 est
  indiscernable, pour tous les outils ci-dessus, d'une phrase juste.
- **Les chemins cités par `packages/core/docs/`** — c'est le corpus qui reste effectivement non
  gardé, et il n'est celui d'AUCUNE des quatre sources de chemins. L'écart est documenté ici même.
  ⚠️ La ligne d'origine affirmait que ce §5 le nommait déjà — c'était faux jusqu'au 17/08/2026, et c'est cette
  ligne-ci qui le rend vrai.
  📌 Cette puce a dit « les chemins cités par `docs/guides/` et `docs/reference/` » jusqu'au
  17/08/2026 : **`GUIDES-PATHS` les couvre depuis le 11/08**. L'exemple qui l'illustrait — une
  suite `poi.test.js` inexistante survivant dans le guide de test — reste vrai À SA DATE, et
  c'est précisément le trou que `GUIDES-PATHS` a fermé.
- **Les noms de classes et de modules cités en prose** — aucune gate ne les résout. C'est par là
  que huit modules noyau au lieu de six ont tenu dans quatre documents publics.
- **Les arbres de fichiers recopiés dans la prose.** `docs:tree:check` garde
  `ARBORESCENCE_QUALIFIEE.md`, pas les arbres réécrits ailleurs — deux étaient faux.

---

## 6. Les schémas JSON — source de vérité

**`profiles/schemas/` est la source de vérité opérationnelle** (10 schémas ; `ls` les rend).
La référence lisible en est **dérivée** : `docs/reference/PROFILE_SCHEMA_REFERENCE.md`.

⚠️ **`packages/core/docs/schema/` ne contient qu'un `README.md`** — vérifié le 11/08/2026,
comme le 27/07/2026 avant lui. La consigne « copier chaque schéma ici » y figurait depuis des
mois **sans avoir jamais été suivie**, ce qui est le signe qu'elle ne correspond à aucun besoin
réel : les schémas ne partent plus dans le tarball depuis que `docs/` a quitté `files[]`, et le
lecteur public a la référence dérivée. **La règle de recopie est retirée.** Si un besoin de
schéma embarqué réapparaît, il se traitera par une copie **générée et gatée**, pas par une
consigne manuelle.

---

## 7. Ce que ce document affirmait avant, et qui était faux

Consigné parce que ces trois énoncés ont été crus, et qu'un lecteur qui les retrouve ailleurs
doit savoir qu'ils sont morts.

1. **« `packages/core/docs/` — le markdown seul (62 `.md`) — embarqué dans le tarball de
   `@geoleaf/core` »** — faux deux fois au 11/08/2026 : il y en a **60**, et `docs/` **a quitté
   les `files[]`**. Le chiffre était de surcroît recopié en prose, dans un document qui interdit
   ailleurs de recopier un chiffre.
2. **« Le site reste en ligne mais gelé, sur `docs.geoleaf.dev` »** — l'hôte nommé est
   **NXDOMAIN**, et le producteur est **vivant** (373 lignes, `npm run docs:deploy`). Le site est
   **périmé**, ce qui appelle un geste (le relancer) et non un constat.
3. **« Zone 1 — `packages/core/docs/` : source principale publique »** — vrai, mais muet sur
   `docs/specs/`, `docs/reference/` et `docs/guides/`, qui n'existaient pas encore comme racine
   publique lors de sa dernière réécriture. Cette omission est ce qui a laissé le doublon
   s'installer sans que personne n'ait à le décider.
