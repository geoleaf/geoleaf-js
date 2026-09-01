---
type: spec-capacite
title: toast-renderer — le rendu DOM des notifications
capability_id: toast-renderer
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: ed1db5b5
date: 28 juillet 2026
---

# toast-renderer — le rendu DOM des notifications

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/toast-renderer/` ·
**Vérifié contre :** `ed1db5b5` (28/07/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **La question que cette fiche existe pour répondre : QUAND le renderer se monte.**
>
> Le CDC source affirmait que les toasts de boot étaient « bufferisés puis rendus ». L'énoncé est
> vrai **à l'infini** et faux **dans toute fenêtre d'observation** : il ne dit ni quand le tampon
> se vide, ni ce que deviennent les messages émis par les deux autres surfaces, qui n'ont pas de
> tampon du tout. C'est précisément le trou du défaut d'ordre de montage — un défaut de
> production où aucune notification n'était visible pendant tout le chargement initial des
> couches, la fenêtre même où surviennent les erreurs de chargement.
>
> Toute affirmation de cette fiche portant sur le rendu d'un message porte donc **sa borne
> temporelle et sa surface d'émission**, ou elle n'est pas écrite.

---

## Périmètre

### Ce que la capacité fait

Elle est le **renderer** du sous-système de notification : elle crée le conteneur, tient une file
prioritaire, rend chaque toast dans le DOM, et **s'enregistre auprès de la primitive `notify()` du
kernel** pour en devenir la sortie visible. Elle porte aussi les trois toasts de boot (chargement,
profil chargé, thème appliqué).

### Ce qu'elle ne fait pas

- **Elle n'est pas le point d'émission.** La primitive `notify(message, level)` reste au kernel
  (`utils/notify/notify.primitive.ts`, ancre B2), sans aucune dépendance au DOM : un plugin chargé
  avant `boot()` peut l'appeler à son niveau supérieur. La capacité en est le renderer enfichable.
- **Elle n'expose pas ses réglages de rendu à un profil.** `position`, `maxVisible`,
  `maxPersistent`, `durations`, `animations` sont des **constantes de code** (`constants.ts`), pas
  des paramètres de profil — voir §Configuration.
- ✅ **Elle rejoue sa propre file au montage, depuis le 17/08/2026.** Les DEUX tampons sont
  désormais vidés : celui de la **primitive**, et la file interne du renderer, drainée par
  `init()` dès qu'il réussit (soldé).
  ⚠️ **Cette puce affirmait l'inverse**, et c'était vrai jusqu'à cette date : `_processQueue()`
  sort tôt faute de conteneur, et **rien ne le rappelait après l'initialisation** — la file
  attendait le _prochain_ `show()`. Les messages émis au boot (« profil introuvable », « couche
  en échec ») sont précisément ceux qui n'ont pas de suivant : ils étaient perdus sans trace.
  📌 Un `init()` qui **échoue** ne draine rien **et ne vide rien** : la file survit pour le
  prochain essai — la perdre là serait pire que le défaut d'origine.
- **Elle n'insère jamais de HTML.** Le message passe par `textContent` ; la surface XSS est nulle
  par construction.

---

## Fonctionnalités

| ID    | Fonctionnalité                                  | Entrée                                               | Sortie observable                                                                                                              | Code                                                                 |
| ----- | ----------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| TR-01 | Montage du conteneur                            | `ToastRendererModule.init()`                         | `#gl-notifications` créé et appendu à `<body>` s'il n'existe pas ; **emprunté** s'il existe déjà                               | `lifecycle.ts` → `init`                                              |
| TR-02 | Montage **avant** le chargement des couches     | `dependencies = ["config"]`                          | Le renderer est prêt pendant que les couches du thème par défaut chargent — c'est le correctif d'ordre                         | `module.ts`                                                          |
| TR-03 | Enregistrement comme renderer de la primitive   | Conteneur trouvé                                     | `notifyPrimitive.registerRenderer(...)`, qui **vide le tampon de la primitive immédiatement**                                  | `lifecycle.ts`, `packages/core/src/utils/notify/notify.primitive.ts` |
| TR-04 | Gate tardif                                     | `modules.toast-renderer.enabled === false`           | `init()` sort avant tout : ni conteneur, ni renderer enregistré. `notify()` reste sur son repli console                        | `lifecycle.ts` → `init`                                              |
| TR-05 | File prioritaire                                | Émissions concurrentes                               | `error` (3) > `warning` (2) > `success`/`info` (1) ; à priorité égale, **FIFO par horodatage**                                 | `notifications.ts` → `_enqueue`                                      |
| TR-06 | Deux budgets **séparés**                        | Toasts temporaires et persistants mêlés              | `maxVisible` compte les temporaires, `maxPersistent` les persistants — un toast de progression ne famine pas le transitoire    | `notifications.ts` → `_processQueue`                                 |
| TR-07 | Éviction au profit d'une erreur                 | File tenant une erreur, budget temporaire plein      | Un `info`/`success` visible est retiré ; à défaut le plus ancien évictable. **Rien d'autre qu'une erreur n'évince**            | `notifications.ts` → `_makeSpaceForPriority`                         |
| TR-08 | File pleine                                     | 15 entrées en attente                                | L'entrant **surclasse** la plus faible → celle-ci est jetée ; sinon l'entrant est **rejeté** et l'appel rend `null`            | `notifications.ts` → `_enqueue`                                      |
| TR-09 | Fermeture automatique par type                  | Toast temporaire rendu                               | `success` 3 s · `error` 5 s · `warning` 4 s · `info` 3 s, sauf `duration` explicite                                            | `constants.ts` → `DEFAULT_DURATIONS`                                 |
| TR-10 | Toast persistant                                | `{ persistent: true }`                               | `data-persistent` posé, **aucun minuteur** : il reste jusqu'à `dismiss()` / `clearAll()`                                       | `notifications.ts` → `_showImmediate`                                |
| TR-11 | Bouton de fermeture accessible                  | `dismissible` non `false`                            | Bouton `.gl-toast__close`, `aria-label` et `title` traduits, caractère de fermeture traduit                                    | `notifications.ts` → `_appendCloseButton`                            |
| TR-12 | Écouteur du bouton libéré au **détachement**    | Toast retiré du DOM                                  | L'entrée quitte le gestionnaire à ce moment-là, pas au `destroy()` — une session de plusieurs heures n'accumule rien           | `notifications.ts` → `_releaseCloseListener`                         |
| TR-13 | Animations d'entrée et de sortie                | `animations: true`                                   | Entrée en **double `requestAnimationFrame`** ; sortie différée de `TOAST_EXIT_ANIMATION_MS`, `0` quand les animations sont off | `notifications.ts` → `_showImmediate`, `_remove`                     |
| TR-14 | Annonce vocale graduée                          | Toast rendu                                          | `role="alert"` ; `aria-live="assertive"` pour une **erreur**, `"polite"` sinon                                                 | `notifications.ts` → `_showImmediate`                                |
| TR-15 | Message inséré en `textContent`                 | Message d'origine quelconque                         | Aucune interprétation HTML — **jamais** `innerHTML`                                                                            | `notifications.ts` → `_showImmediate`                                |
| TR-16 | Toast de chargement persistant                  | `geoleaf:theme:applying`                             | Toast `info` persistant **non fermable**, refermé sur `geoleaf:theme:applied`                                                  | `lifecycle.ts` → `onThemeApplying`                                   |
| TR-17 | Toast « profil chargé », **réessayé**           | `geoleaf:profile:loaded`                             | Rendu si le renderer est prêt ; sinon **mémorisé** et retenté sur `geoleaf:map:ready`                                          | `lifecycle.ts` → `tryShowProfileToast`, `onMapReady`                 |
| TR-18 | Toast « thème appliqué »                        | `geoleaf:theme:applied`                              | Toast `success` portant le nom du thème et le nombre de couches                                                                | `lifecycle.ts` → `onThemeApplied`                                    |
| TR-19 | Mesure de durée de chargement, **opt-in**       | `window.__GEOLEAF_PERF__` vrai                       | Marques `applying`/`applied` + mesure `geoleaf:theme-data-load` journalisée. **Aucun coût quand le drapeau est absent**        | `lifecycle.ts` → `_pm`, `onThemeApplied`                             |
| TR-20 | `init()` est une **ré-initialisation complète** | Second `init()` partiel, y compris après `destroy()` | Chaque option repart de son défaut, et le renderer revient **actif** — l'état ne dépend pas de ce qui a tourné avant           | `notifications.ts` → `init`                                          |
| TR-21 | Suspension et reprise                           | `disable()` puis `enable()`                          | Rien n'est rendu entre les deux ; `enable()` **draine** ce qui s'est empilé                                                    | `notifications.ts` → `disable`, `enable`                             |
| TR-22 | Démontage complet                               | `ToastRendererModule.destroy()`                      | Écouteurs détachés, renderer **désenregistré de la primitive**, minuteurs et écouteurs libérés, conteneur **possédé** retiré   | `lifecycle.ts` → `_reset`                                            |
| TR-23 | Instantané d'état                               | `Notifications.getStatus()`                          | `initialized` (conteneur présent), compteurs visibles/en file, budgets, position                                               | `notifications.ts` → `getStatus`                                     |
| TR-24 | Déclaration introspectable                      | —                                                    | `getAllCapabilities()` la liste, `getCapabilitySchema("toast-renderer")` rend son schéma                                       | `toast-renderer-capability.ts`                                       |

⚠️ **TR-23 porte le piège déjà payé.** `getStatus().maxVisible` rend `3` sur un renderer
**jamais monté** : c'est une constante lue sur l'instance, pas une preuve de montage. Le seul champ
qui atteste le montage est **`initialized`**, ajouté et **vu rougir** au correctif. Un test qui
lit un budget pour conclure « le renderer est là » est aveugle par construction.

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/toast-renderer/`, et
`e2e/vn-toasts.spec.js` côté navigateur.

---

## Configuration

Bloc `modules.toast-renderer` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre | Type      | Défaut | Où c'est lu                                                                                                   |
| --------- | --------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| `enabled` | `boolean` | `true` | `config.ts` → `getToastRendererConfig()` ; gate tardif en tête de `lifecycle.ts` → `init()`. **Vrai opt-out** |

### Un opt-out, un vrai — contrairement à ses voisines

`enableWhenAbsent: true` a **deux sens différents** selon les capacités, et les confondre est
l'erreur la plus facile de ce dépôt :

| Capacité                              | `enableWhenAbsent` | Défaut du schéma | Ce que ça veut dire                                                             |
| ------------------------------------- | ------------------ | ---------------- | ------------------------------------------------------------------------------- |
| **`toast-renderer`** (cette fiche)    | `true`             | `true`           | **Vraiment actif par défaut** — les deux étages disent la même chose            |
| [`theme-toggle`](theme-toggle.md)     | `true`             | `false`          | Enregistrement seulement ; la visibilité est **opt-in** sur la config fusionnée |
| [`theme-selector`](theme-selector.md) | `true`             | `false`          | Idem — voir le §Double gate de sa fiche                                         |

Ici les deux étages lisent la même clé avec le même défaut : un profil qui ne déclare rien obtient
des toasts, et il faut écrire `modules.toast-renderer.enabled: false` pour les éteindre. Le motif
est la préservation du comportement d'avant la migration — les toasts de géolocalisation et de
stockage devaient continuer à s'afficher sur des profils qui n'avaient jamais entendu parler de
cette clé.

### Ce qui n'est PAS configurable, et pourquoi ce n'est pas un oubli

`position` (`"bottom-center"`), `maxVisible`, `maxPersistent`, la taille de file et les durées par
type vivent dans `constants.ts`, lues par le constructeur, par `init()` **et** par le câblage de
`lifecycle.ts`. Le fichier porte son motif sur place : ces valeurs étaient auparavant des littéraux
dispersés sur quatre sites, dont un **avait déjà divergé**, et `maxPersistent` était pire encore —
déclaré sur l'interface de configuration, documenté, et **jamais lu** par `init()`, donc le
configurer ne faisait rien en silence.

Les exposer en configuration de profil est un enrichissement, pas une réparation : le déclarer
avant de l'implémenter est exactement ce qui a produit le `maxPersistent` fantôme.

---

## Contrat exposé

### Les trois surfaces d'émission — et elles ne se dégradent PAS de la même façon

C'est le cœur de cette fiche. Trois chemins mènent au même renderer, avec **trois comportements
différents** avant son montage :

| Surface               | Montée par                                                     | Avant le montage du renderer                                                           | Trace laissée                  |
| --------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| `GeoLeaf.notify()`    | kernel, à l'import (ancre B2)                                  | **Mise en tampon** dans la primitive, puis rejouée                                     | oui — `console.*`              |
| `Notifications.*`     | `install.ts` → `registerGlobals`                               | Empilée dans la file du renderer, **drainée par `init()`**                             | oui, depuis le 17/08/2026      |
| `GeoLeaf.UI.notify.*` | kernel (`packages/core/src/globals/globals.ui.ts`), à l'import | Idem — drainée aussi ; reste un no-op muet si la capacité n'est **pas montée du tout** | oui, si la capacité est montée |

✅ **« Bufferisés puis rendus » vaut désormais pour les TROIS lignes** (17/08/2026). Le tampon de la
primitive est vidé par `registerRenderer()` ; la file du renderer est drainée par `init()` dès qu'il
réussit.

⚠️ **Ce paragraphe a dit l'inverse jusqu'au 17/08/2026, et il était exact** : les deux dernières
surfaces tapent directement le singleton, leur message entrait dans `_queue`, `_processQueue()`
sortait faute de conteneur, et **`init()` ne le rappelait jamais** — seuls `enable()` et le retrait
d'un toast relançaient le drainage. Un message émis par ces chemins avant le montage y restait
**définitivement**, sans repli console.

C'était le second défaut, soldé. Le premier avait **réduit** la fenêtre — le renderer se monte avant le
chargement des couches — sans la fermer ; c'est le drain qui la ferme.

🖐 **Ce qui subsiste, et qui n'est PAS ce défaut** : si la capacité `toast-renderer` n'est pas montée du
tout, `GeoLeaf.UI.notify.*` reste un no-op muet. Le drain ne peut rien pour un renderer qui n'existe
pas — c'est une autre question, celle du repli console de la troisième surface.

### API publique

`GeoLeaf.Notifications`, construit par `public-api.ts`, monté par `install.ts` →
`registerGlobals(gl)`, et exporté en ESM sous `{ Notifications }` par `bundle-esm-entry.ts`.

⚠️ **Il n'y a pas de façade `src/api/geoleaf.notifications.ts`**, contrairement à `labels` ou
`theme-palette` : l'export ESM se fait depuis l'entrée du bundle, pas depuis une façade dédiée.

| Membre                                      | Rend / fait                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `notify(message, type\|options, duration?)` | Affiche un toast — deux signatures, positionnelle ou par objet d'options   |
| `show(...)`                                 | **Alias strict** de `notify` — voir l'avertissement ci-dessous             |
| `success` · `error` · `warning` · `info`    | Raccourcis typés ; second argument = durée (ms) **ou** objet d'options     |
| `dismiss(toastEl)`                          | Ferme **ce** toast, par la référence rendue à l'émission                   |
| `clearAll()`                                | Ferme tout le visible et **vide la file en attente**                       |
| `getStatus()`                               | Instantané d'état — `initialized` est le seul champ qui atteste le montage |

⚠️ **Les méthodes d'émission rendent trois choses distinctes**, et l'appelant qui veut plus tard
appeler `dismiss()` doit les distinguer : l'élément du toast, `null` quand la file l'a **rejeté**
(pleine et rien de plus faible à évincer), et `undefined` quand le renderer **n'est pas
initialisé**. Cette union est écrite en ligne sur chaque signature plutôt qu'exportée sous un alias
nommé — un type public sans consommateur serait un contrat inventé pour lui-même, et la gate
`check-orphan-exports` le refuse.

⚠️ **`show` existe parce que trois surfaces le nommaient et qu'il n'existait pas.** Le renderer, la
surface historique `GeoLeaf.UI.showNotification` et la documentation des plugins l'appelaient toutes
`show` ; l'appel tombait sur `undefined` et échouait en silence. C'est un alias assumé, pas une
duplication accidentelle.

⚠️ **`GeoLeaf.UI.Notifications` et les six raccourcis `GeoLeaf.UI.show*` n'existent PAS au
runtime.** `kernel/ui/ui-api.ts` les monte derrière un `if (GeoLeaf._UINotifications)` de **corps de
module**, évalué à l'import — alors que l'unique écrivain de `_UINotifications` est le
`registerGlobals` de cette capacité, appelé au **boot**. Mesuré sur le bundle livré, avec
contre-épreuve : écrire `_UINotifications` après coup ne les fait pas apparaître. Ligne ouverte au
registre. Les plugins ne sont pas touchés : ils passent par
`GeoLeaf._UINotifications` via `getUINotifications()` de `@geoleaf/host-runtime`, qui, lui, résout.

### Trois autres clés montées par l'installeur

`registerGlobals` écrit **trois** valeurs, pas une : `_UINotifications` (le singleton, c'est le seam
que lisent les plugins), `NotificationSystem` (la classe, pour qui veut sa propre instance) et
`Notifications` (la façade). Les trois sont dans la surface figée par l'oracle de namespace : les
retirer casse le contrat publié.

### Événements

| Événement                | Sens       | Détail                                                     |
| ------------------------ | ---------- | ---------------------------------------------------------- |
| `geoleaf:theme:applying` | **écouté** | Ouvre le toast de chargement persistant                    |
| `geoleaf:theme:applied`  | **écouté** | Ferme ce toast et annonce le thème appliqué                |
| `geoleaf:profile:loaded` | **écouté** | Annonce le profil — mémorisé si le renderer n'est pas prêt |
| `geoleaf:map:ready`      | **écouté** | Rattrapage du toast de profil mémorisé                     |

La capacité **n'émet aucun événement** : sa sortie est le DOM. Les quatre écoutes sont posées dans
`init()` et **toutes** détachées par `_reset()` — c'est ce qui rend le démontage complet.

### Stockage écrit

Aucun. Cette capacité n'écrit ni `localStorage`, ni `sessionStorage`, ni paramètre d'URL.

---

## Décisions de conception

| Décision                                                          | Pourquoi                                                                                                                                                                                                                        | Alternative écartée                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **La primitive reste au kernel, la capacité n'est que le rendu**  | Un plugin chargé avant `boot()` appelle `GeoLeaf.notify()` à son niveau supérieur : l'ancre doit exister à l'import, donc sans dépendance au DOM. Enrichir la primitive la coupleraient à `HTMLElement` et `duration`           | Une primitive riche — c'est ce que la migration existait pour défaire |
| **`dependencies = ["config"]`**                                   | La boucle d'init du registry est **séquentielle et awaitée**, et `GeoJSONModule.init()` attend le chargement des couches. Dépendre de `geojson` séquençait le renderer **derrière le réseau**, là où les erreurs arrivent       | `["geojson"]` — c'était le cas avant, par astuce d'ordonnancement     |
| **Jamais `["ui"]`**                                               | `UIModule.init()` pilote la mise en place des features avec avidité : en dépendre produirait un interblocage, exactement comme documenté sur `route`                                                                            | `["ui"]`, sémantiquement tentant puisque c'est de l'interface         |
| **Deux budgets comptés séparément**                               | Un toast de progression persistant qui occupe un créneau ferait famine sur le retour transitoire. Les compter ensemble rend l'un tributaire de l'autre                                                                          | Un budget unique                                                      |
| **Seule une erreur peut évincer**                                 | L'éviction est une dégradation de l'expérience : elle ne se justifie que pour un message qu'on ne peut pas se permettre de retarder                                                                                             | Éviction par ancienneté, quel que soit le niveau                      |
| **Compteurs vivants pendant la passe de drainage**                | Le retrait d'un toast est **différé** par l'animation de sortie. Re-interroger le DOM ferait re-cibler le même toast à chaque tour et dépasser `maxVisible` sur une rafale d'erreurs                                            | Re-requêter le DOM à chaque itération                                 |
| **`init()` re-initialise, il ne fusionne pas**                    | La forme fusionnante remettait deux budgets à leur défaut tout en conservant trois autres réglages, et ne restaurait jamais `enabled` — que `destroy()` avait éteint. Tout chemin de recréation revenait **muet**               | La fusion sur l'état courant                                          |
| **Le conteneur emprunté n'est pas repris**                        | Une page hôte a le droit de fournir son propre `#gl-notifications`. Le démontage peut reprendre ce qu'il a **ajouté**, jamais ce qu'il a **emprunté**                                                                           | Retirer le conteneur inconditionnellement                             |
| **Désenregistrer le renderer au démontage**                       | Ce n'est pas de la propreté : `destroy()` laisse le singleton sans conteneur, où tout ce qu'on lui donne est perdu. Une primitive qui pointerait encore dessus **croirait avoir un renderer** et n'aurait plus de repli console | Laisser la primitive pointer le singleton mort                        |
| **Désenregistrement vérifié par identité**                        | Une capacité démontée **après** qu'une autre s'est enregistrée ne doit pas aveugler le renderer vivant                                                                                                                          | Un `unregisterRenderer()` inconditionnel                              |
| **L'écouteur du bouton passe par le gestionnaire de la capacité** | La propriété `onClick` des utilitaires DOM route vers le gestionnaire **global** dès qu'il existe — et en production il existe toujours. Chaque toast y laissait une entrée permanente pointant un bouton détaché aussitôt      | `createElement({ onClick })`, la forme courte                         |
| **L'écouteur est libéré au détachement, pas au `destroy()`**      | Une session qui affiche des toasts pendant des heures ne doit pas accumuler une entrée par toast affiché                                                                                                                        | Tout libérer au `destroy()`                                           |
| **`textContent`, jamais `innerHTML`**                             | Le message peut venir d'une source non fiable (erreur réseau, réponse de service). C'est une frontière de sécurité, pas un style d'écriture                                                                                     | Un gabarit HTML pour enrichir la présentation                         |
| **Les réglages de rendu restent des constantes**                  | Les exposer sans les brancher a déjà produit un `maxPersistent` documenté que rien ne lisait. Un fichier unique de constantes rend les quatre sites identiques **par construction**                                             | Les déclarer dans le `configSchema` avant de les brancher             |
| **Mesure de performance derrière un drapeau**                     | La mesure du chargement des données est utile en diagnostic et inutile en production : conditionnée à `__GEOLEAF_PERF__`, elle ne coûte rien quand personne ne regarde                                                          | Mesurer systématiquement                                              |
| Pas de `loader`                                                   | Le renderer est présent dans les deux entrées et sert au boot lui-même : le charger paresseusement le rendrait indisponible exactement quand il sert                                                                            | Un `import()` paresseux                                               |

---

## Dépendances et frontières

### Dépendance de cycle de vie — et sa borne temporelle

`module.ts` → `ToastRendererModule` : `id = "toast-renderer"`, `dependencies = ["config"]`.
`init()` **n'utilise pas la carte** et ne lit aucune donnée : il lui faut le DOM, l'i18n et la
primitive, rien d'autre.

⚠️ **Cette capacité ne déclare pas `["geojson"]` mais `["config"]`, et c'est délibéré.** La
**large majorité** des capacités qui portent un module de cycle de vie déclarent `["geojson"]`
comme **astuce d'ordonnancement** — forcer le tri topologique sans passer par `ui`. La conséquence
mesurée est que leur `init()` attend la résolution des couches du thème par défaut ; c'est la question des dépendances.

> 🛑 **Relecture du 11/08/2026 — cette phrase disait « Sur les **15** capacités […] c'est **la
> seule** à ne pas déclarer `["geojson"]` », et elle était fausse deux fois.** Mesuré : **16**
> capacités portent un module, et **deux** ne déclarent pas `["geojson"]` — celle-ci (`["config"]`)
> **et `permalink`** (`[]`). Une affirmation d'**unicité** est la forme la plus coûteuse d'une
> phrase fausse : elle se cite ailleurs comme une propriété du système. Le « quatorze autres »,
> lui, se trouvait juste — 16 − 2 —, ce qui rendait l'erreur d'autant moins visible. Le compte est
> retiré ; la commande ci-dessous le rend.

La mesure se rejoue — **récursivement**, jamais sur `*/module.ts` :

```bash
grep -rn "readonly dependencies" packages/core/src/capabilities/
```

> 🛑 **La commande citée ici était `packages/core/src/capabilities/*/module.ts`, et son angle mort
> était EXACTEMENT le contre-exemple à la phrase qu'elle prétendait étayer.** `permalink` déclare
> son module dans `share/module.ts` : le glob à un seul niveau ne le voyait pas, la commande rendait
> **15** au lieu de 16, et la seule capacité qu'elle manquait était la seconde à ne pas déclarer
> `["geojson"]`. **Citer une commande au lieu d'un chiffre ne protège que si la commande voit
> tout** — sinon elle donne au chiffre faux l'apparence d'un fait vérifiable, ce qui est pire que
> le chiffre nu.

**La fenêtre où les notifications ne sont pas visibles** s'étend donc du premier code qui s'exécute
jusqu'à `ToastRendererModule.init()`, c'est-à-dire jusqu'à la fin de l'initialisation du module
`config`. Elle ne recouvre **plus** le chargement des couches. Ce qui est émis dans cette fenêtre
suit le tableau des trois surfaces ci-dessus : rejoué pour la primitive, perdu pour les deux autres.

Position dans `presets/manifest.full.ts` : dans le lot multi-couches, **avant `legend`**, ce qui
reproduit l'ordre relatif historique de leurs déclarations. Aucun consommateur ne dépend de cet
ordre global — seules `legend` et `share` déclarent une icône de barre d'outils mobile.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                                             | Statut vis-à-vis de R.8           |
| -------------------------------------------------- | --------------------------------- |
| `kernel/config/config-primitives.js` (`config.ts`) | **Exception** nommée par la règle |

Tout le reste passe par `utils/` : `utils/log`, `utils/i18n` (`getLabel`), `utils/notify`
(la primitive), `utils/general/dom-helpers` (`createElement`),
`utils/general/event-listener-manager` et `utils/general/timer-manager`. **Aucun accès à la carte**,
aucun `IMapAdapter` utilisé. **Aucune référence à un plugin** — règle `no-plugin-in-core`.

### Frontière inverse : le kernel lit la capacité, tardivement

`packages/core/src/globals/globals.ui.ts` monte `GeoLeaf.UI.notify.*`, qui est **du kernel** et doit donc rester monté même
sans la capacité. Il n'importe pas le singleton : il le **relit sur le namespace à chaque appel**.
Une entrée qui laisse la capacité de côté n'a simplement aucun écrivain, et chaque appel dégrade en
no-op muet. C'est le même patron de localisateur de service que `vector-tiles`, et c'est ce qui rend
`notifications.ts` réellement élaguable.

### Frontière côté CSS

`install.ts` importe `./css/toast-renderer.css` — la feuille entre dans le graphe de modules par
l'installeur, donc une entrée qui l'omet ne livre ni le code ni le style.

---

## Écarts au CDC source

Le CDC `CDC_capacite-toast-renderer.md` (v1.1.0, 09/07/2026) a été **consommé** en écrivant cette
fiche. ⚠️ **Il n'a PAS été retiré du dossier de tri** : celui-ci appartient à une session
concurrente au moment de cette passe — trace et conséquence sur le compteur au §Journal des
décisions de la refonte documentaire V3.

| Énoncé du CDC                                                                                       | Ce que dit le code                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| « Toasts profil/thème : via la primitive, **bufferisés puis rendus** »                              | ✅ Vrai des **trois** surfaces depuis le 17/08/2026. Ce l'était **de la primitive seule** jusque-là — les deux autres perdaient leur message sans trace, et c'est le trou d'où le défaut est sorti |
| `dependencies=["geojson"]` (§5 et §12, présenté comme une protection d'ordre)                       | **Faux depuis le 28/07** : `["config"]`. L'énoncé était même contredit par le TSDoc du fichier qu'il décrivait — « the renderer only needs the DOM + i18n + the primitive »                        |
| `renderer/notifications.ts` · `css/notifications.css`                                               | Les deux chemins sont **faux** : `notifications.ts` est à la racine de la capacité, la feuille s'appelle `css/toast-renderer.css`                                                                  |
| `app/boot-modules/toast-renderer.module.ts` + enregistrement inline `packages/core/src/app/boot.ts` | Le module vit **dans** la capacité (`module.ts`) et l'enregistrement passe par l'installeur du manifeste de preset, plus par un bloc gaté de `packages/core/src/app/boot.ts`                       |
| `@import` de la feuille depuis `packages/core/src/css/geoleaf-main.css`                             | La feuille entre par `install.ts`, pas par un `@import` de la feuille agrégée                                                                                                                      |
| « rendu **byte-identique**, `maxPersistent: 2` »                                                    | La valeur est la bonne, mais elle n'était **pas appliquée** : déclarée, documentée, jamais lue par `init()`. Corrigé depuis, avec les constantes partagées                                         |
| `GeoLeaf.UI.Notifications` + les raccourcis `UI.show*` listés comme API                             | **Ils n'existent pas au runtime** — mesuré sur le bundle livré, avec contre-épreuve — versé au registre                                                                                            |
| « exposition de `position`/`maxVisible`/`animations` = enrichissement futur »                       | Toujours vrai, et le motif s'est renforcé : `constants.ts` documente pourquoi les déclarer avant de les brancher est précisément ce qui a produit un paramètre fantôme                             |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : la frontière primitive/renderer et son
motif (les plugins appellent `notify()` avant `boot()`), la raison du choix in-core plutôt que
plugin (ubiquitaire, utilisé au boot, présent dans les deux entrées), les cas d'usage réels
(géolocalisation, export et synchronisation, placement de POI, intégrateur), et les alternatives
écartées de la table §Décisions.
