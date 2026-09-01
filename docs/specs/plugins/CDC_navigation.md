---
type: spec-plugin
title: navigation — le guidage temps réel, et les trois adaptateurs qui le rendent portable
plugin_id: navigation
package: "@geoleaf-plugins/navigation"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: b4cc844b1
date: 27 août 2026
---

# navigation — le guidage temps réel, et les trois adaptateurs qui le rendent portable

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/navigation` ·
**Code :** `packages/plugins/navigation/` · **Vérifié contre :** `b4cc844b1` (27/08/2026)

> ⚠️ **Ce corps a annoncé `f92421820` pendant que le frontmatter disait `3307070d0`** — deux
> attestations contradictoires dans le même fichier, et c'est le frontmatter que la gate lit.
> Les deux sont désormais la même. Une fiche qui se contredit sur SA PROPRE fraîcheur ne peut
> rien attester du reste.

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**.

> 🛑 **Ce paquet est un SQUELETTE à ce jour.** Il monte son namespace, il déclare sa dépendance et
> il passe le contrat de plugin — **il ne guide personne.** Aucun suivi de position, aucun énoncé
> de manœuvre, aucun recalcul. Les sections ci-dessous distinguent à chaque fois ce qui est livré
> de ce qui est spécifié : une fiche qui ne fait pas cette distinction se lit comme un compte rendu
> et devient un mensonge daté.

---

## Périmètre

### Ce que le plugin fera

- Il **suit** la position de l'utilisateur le long d'un itinéraire déjà calculé.
- Il **énonce** la manœuvre suivante, dans la langue de l'interface.
- Il **recalcule** lorsque l'écart au tracé dépasse un seuil — avec hystérésis.

### Ce qu'il ne fait pas, et ne fera pas

- **Aucun calcul d'itinéraire.** C'est `@geoleaf-plugins/routing`, et la dépendance est déclarée.
- **Aucun accès direct au navigateur hors de ses adaptateurs.** Voir ci-dessous : c'est la
  propriété structurante de ce paquet.
- **Aucun rendu propre.** Comme `routing`, il publie par la couture du cœur.

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`.

| Champ        | Valeur                            |
| ------------ | --------------------------------- |
| `name`       | `navigation`                      |
| `label`      | `Navigation (guidage temps réel)` |
| `requires`   | `["routing"]`                     |
| `optional`   | `[]`                              |
| `namespace`  | `GeoLeaf.Navigation`              |
| `paquet npm` | `@geoleaf-plugins/navigation`     |

🛑 **`requires` n'est PAS vide, et c'est le seul cas de la flotte.** Aucun autre plugin de ce dépôt
n'en dépend d'un autre. La déclaration est ici parce que la dépendance est **réelle et
asymétrique** : le guidage sans calcul n'a aucun objet. L'écrire dans `entry.ts` plutôt que dans ce
seul document la rend vérifiable — `PluginRegistry` la lit
(`packages/core/src/kernel/api/plugin-registry.ts:212`).

⚠️ **Le partage de code entre les deux paquets ne passe QUE par des types.** La spec d'architecture
autorise le partage inter-plugins « via dépendance npm déclarée » ; ses exemples sont des
bibliothèques partagées, et cette arête-ci est la première **plugin → plugin** du dépôt. La
contenir aux `import type` est ce qui la rend sans conséquence à l'exécution : les types sont
effacés au build, donc aucun code de `routing` n'entre dans le bundle de `navigation`.

✅ **L'arête est réelle depuis le 21/08/2026**, et le seul endroit où elle l'est se nomme :
`src/guidance-contract.ts`, qui type `GuidanceRuntime` contre `RouteResult`, `NavProgress` et
`NavState`. 🛑 **Ce n'est pas un détail d'implémentation : c'est ce qui rend la déclaration
LÉGITIME.** Déclarée avant que quoi que ce soit l'importe, la dépendance a été refusée par knip —
et il avait raison : une dépendance que rien n'importe est indiscernable d'un reste laissé par une
suppression. La faire taire par une baseline aurait été un `update-baseline` de défaut.

---

## Les trois adaptateurs — la seule propriété qui compte structurellement

Le plugin ne touche `navigator.geolocation`, `speechSynthesis` et `navigator.wakeLock` **que depuis
`src/platform/`**. Partout ailleurs, il consomme un adaptateur.

**Ce que cela achète** : un portage natif ultérieur devient un remplacement de trois fichiers, et
non une relecture du plugin entier. C'est la seule raison de cette contrainte — elle n'est pas une
préférence de style.

Livrés le 21/08/2026 (sprint 4, tâches 4.1 à 4.3).

| Adaptateur     | Ce qu'il rend                                                             | Le piège qu'il porte                                                                                      |
| -------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `geo.ts`       | `startGeoWatch` — des relevés portant **cap et vitesse**, filtrés du saut | La couture du cœur ne rend ni cap ni vitesse : elle déstructure `latitude`, `longitude`, `accuracy` seuls |
| `voice.ts`     | `createVoiceAnnouncer` — annonces, coupables **en session**               | Couper le son **annule** ce qui parle ; une annonce **remplace** la file                                  |
| `wake-lock.ts` | `createScreenWakeLock` — l'écran reste allumé, **même après un retour**   | 🛑 Le navigateur relâche le verrou dès que le document est caché, et ne le restaure jamais                |

### 🛑 Le verrou d'écran : ré-acquisition INCONDITIONNELLE

Un verrou d'écran est relâché par le navigateur dès que le document cesse d'être visible, et le
retour au premier plan ne le restaure pas. Une implémentation qui demande le verrou une seule fois
**passe tous les tests** et laisse l'écran s'éteindre au premier coup d'œil à un message — le
symptôme arrive des minutes plus tard, en circulation, et ressemble à un réglage système.

⚠️ **Vérifier que le sentinel est encore vivant avant de redemander a l'air prudent et c'est faux** :
son drapeau `released` est précisément ce qu'une référence périmée rapporte mal sur certains
moteurs, et redemander un verrou déjà tenu est sans effet. Les deux formes — pas de ré-acquisition,
et ré-acquisition conditionnelle — ont été mutées, et le test dédié tombe sur les deux.

### ⚠️ Du filtre de saut, une seule moitié se reprend

Le patron de `packages/plugins/measure/src/tools/tool-gps.ts` filtre deux fois : il rejette une
vitesse invraisemblable, et il **jette** les relevés distants de moins de deux mètres. Seul le
premier rejet a sa place ici. Jeter un relevé ferait cesser d'exister un véhicule arrêté à un feu,
et une approche au pas d'une étape n'entrerait jamais dans le rayon d'arrivée. **Filtrer n'est pas
ne pas mettre à jour.**

Deux cas limites en découlent : le **premier** relevé est accepté — il n'a rien contre quoi être
invraisemblable — et une horloge qui n'avance pas ne borne rien, certains hôtes répétant un
horodatage.

### Ce que la lib DOM dit de faux

`navigator.wakeLock` y est déclaré **non optionnel**. C'est faux à l'exécution : l'API manque à
plusieurs moteurs encore en service, et faire confiance au type ferait planter précisément les
navigateurs où ce confort compte. Le contrôle de présence reste — écrit avec un type, jamais avec
un transtypage, que le cliquet des assertions non-null refuse à raison.

✅ **La règle est GATÉE**, pas seulement écrite : `scripts/check-platform-isolation.cjs`
(`PLATFORM-ISO`), câblée dans `ci-local.cjs` et `ci.yml`.

⚠️ **Le balayage est scopé à ce paquet, jamais au dépôt.** Le cœur porte une capacité de
géolocalisation légitime et `measure` un outil GPS : au dépôt entier, la gate naîtrait rouge sur du
code qu'elle n'a pas à juger — et une gate qui naît rouge se fait désarmer.

⚠️ **Ce que la gate ne voit pas**, et qu'il faut savoir avant de s'y fier : elle lit l'arbre
syntaxique, donc un alias (`const n = navigator; n.geolocation`) ou un accès dynamique la
contournent. C'est un fil de détente sur la forme évidente, pas une preuve d'isolation.

---

## Chargement — paresseux, et c'est le pendant exact du choix inverse pour `routing`

`navigation` se charge **à la demande**. Il est la moitié lourde des deux paquets, et son point
d'entrée n'a pas la contrainte qui force `routing` à être eager : on n'entre dans le guidage
qu'**après** avoir calculé un itinéraire, donc depuis une interface déjà rendue par un plugin déjà
chargé.

---

## Le moteur de guidage — `src/engine/`

Livré le 21/08/2026 (sprint 4, tâches 4.4 à 4.8 et 4.12). Cinq modules purs, sans état global,
sans accès au navigateur — les adaptateurs de plateforme sont un lot distinct, encore à venir.

| Module             | Ce qu'il rend                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `snap.ts`          | `buildTrack` puis `snapToTrack` — projection, distance au tracé, avancement le long du tracé |
| `heading.ts`       | Cap de la plateforme, avec repli sur le cap entre deux relevés, plié dans `[0, 360)`         |
| `progress.ts`      | Restants **par tronçon ET au total**, simultanément                                          |
| `off-route.ts`     | Détection de sortie à **hystérésis dans les deux sens**, deux compteurs séparés              |
| `state-machine.ts` | Les cinq états et leurs transitions, dont `waypoint-reached`                                 |

🛑 **La fenêtre de projection est bornée par la VITESSE, pas par un rayon.** Un itinéraire qui
repasse près de lui-même a deux points proches dans l'espace et éloignés le long du tracé : sans
borne, la projection saute de l'un à l'autre. Mesuré sur la trace du dépôt avant que la borne
existe — **+171 m en 1,2 s**, soit 513 km/h, à un coin à 90°, puis 147 m en arrière. Sur l'écran,
c'est un restant qui remonte, et un restant qui remonte fait douter de tout le reste.

⚠️ **Et la projection n'admet aucun RECUL.** On ne dé-parcourt pas un itinéraire ; un bruit qui
tirerait la projection en arrière la laisse en place, et un vrai demi-tour sort du tracé — ce qui
confirme une sortie, demande un recalcul, et relâche l'ancre.

🛑 **Un recalcul DOIT relâcher l'ancre de projection et appeler `OffRouteDetector.reset()`.** Les
compteurs et l'ancre valent pour l'ANCIEN tracé ; les hériter fait rerouter sans fin.

⚠️ **Aucun seuil n'a de valeur par défaut dans ces modules** — rayon d'arrivée, seuil de sortie,
confirmations d'entrée et de retour sont tous des paramètres. Leurs défauts appartiennent au schéma
de configuration, et une valeur écrite à deux endroits diverge de son schéma sans que rien ne
rougisse.

---

## Le recalcul, et ce que « en couverture » veut dire ici

`src/engine/runtime.ts` — `createGuidanceRuntime`, livré le 21/08/2026 (tâche 4.11). Il noue la
veille de position, la projection, la progression, la détection de sortie et la machine à états.

🛑 **« En couverture » se découvre en ESSAYANT, jamais en consultant `navigator.onLine`.** Ce
drapeau dit qu'un lien existe, pas que quelque chose répond : un portail captif, un fournisseur
hors service et une barre de réseau s'y lisent tous « en ligne ». Et le modèle de
`@geoleaf-plugins/routing` **nomme déjà** `network` et `timeout` parmi ses six causes d'échec — la
réponse est un résultat ordinaire, pas une exception à prédire. Le runtime tente le recalcul et
**espace** ses tentatives en doublant l'attente ; ce faisant, il couvre aussi le cas qu'aucune
détection de couverture ne voit — un fournisseur joignable et cassé.

⚠️ **Quand le recalcul échoue, le guidage CONTINUE sur l'itinéraire qu'il a.** Ce n'est pas un
repli improvisé : le module de calcul hors-ligne a été **retiré en v1.0.0** de la spécification
fonctionnelle, et ce qui l'a remplacé est « guider hors couverture sur un itinéraire préparé en
couverture ». Un runtime qui s'arrêterait faute de pouvoir re-router jetterait la seule chose que
la conception dit de garder. ⚠️ L'exigence F-04.6 renvoie encore à **F-06.4**, qui appartient au
module retiré : le renvoi est mort, et c'est le paragraphe ci-dessus qui fait foi.

🛑 **Un recalcul abouti relâche l'ancre de projection ET réinitialise le détecteur — les deux,
jamais l'un sans l'autre.** Compteurs et ancre valent pour l'ANCIENNE ligne ; en hériter fait
re-confirmer une sortie au premier relevé du tracé neuf, donc redemander un recalcul aussitôt : un
itinéraire qui se recalcule sans fin.

⚠️ **Les étapes restantes se dérivent de l'index de TRONÇON**, jamais d'un décalage constant. Le
tronçon _i_ va de l'étape _i_ à l'étape _i + 1_, donc ce qui reste est `waypoints[i + 1…]`. Couper
à l'index 1 — « tout sauf l'origine » — n'est juste que sur le premier tronçon, et renverrait
silencieusement un conducteur à sa troisième étape par la deuxième.

### Ce que le plugin ne peut PAS faire lui-même

`recompute` et `decodeGeometry` sont **injectés** par l'appelant. Les deux exigent une **valeur**
de `@geoleaf-plugins/routing` — un fournisseur à appeler, un décodeur de polyline à exécuter — et
ce paquet n'en importe que des **types**, ce qui est ce qui rend la première arête plugin→plugin du
dépôt inerte. L'appelant, lui, tient déjà les deux.

---

## API publique — `GeoLeaf.Navigation`

| Membre        | Signature                                                                  | État                 |
| ------------- | -------------------------------------------------------------------------- | -------------------- |
| `getConfig()` | `(): PluginConfig`                                                         | ✅ livré             |
| `start()`     | `(route, line, deps): void` — `deps` porte `recompute` et `decodeGeometry` | ✅ livré             |
| `stop()`      | `(): void`                                                                 | ✅ livré, idempotent |

Le paquet publie en revanche son **contrat de types** dès maintenant — `GuidanceRuntime` et
`GuidanceListener`, ré-exportés depuis l'entrée. Un intégrateur peut donc typer contre le guidage
avant qu'il existe, ce qui est l'inverse d'annoncer une méthode qui ne répond rien : un type absent
casse à la compilation, une méthode vide casse chez l'utilisateur.

⚠️ **`start()` prend la ligne DÉCODÉE en second paramètre**, et ce n'est pas un confort d'appelant.
`RouteResult.geometry` est une polyline encodée ; la décoder demanderait une **valeur** de
`@geoleaf-plugins/routing`, or ce paquet n'en importe que des **types** — c'est ce qui rend la
première arête plugin→plugin du dépôt inoffensive. Recopier le décodeur ici serait un fork, ce dont
ce dépôt a une gate et une cicatrice. L'appelant a déjà la ligne décodée : c'est ce qu'il a dessiné.

⚠️ La surface est étroite **à dessein** tant que le runtime de guidage n'existe pas. Annoncer
`start()` avant qu'il démarre quoi que ce soit place la découverte du vide à l'exécution, chez
l'intégrateur.

---

## Configuration

Le plugin lit **`modules.navigation`**, et cette branche est la seule (INV-CONFIG).

| Clé                       | Type      | Défaut  | Rôle                                                            |
| ------------------------- | --------- | ------- | --------------------------------------------------------------- |
| `enabled`                 | `boolean` | `true`  | active le plugin                                                |
| `showButton`              | `boolean` | `false` | affiche le point d'entrée dans la barre                         |
| `arrivalRadiusMetres`     | `number`  | `30`    | sous cette distance, une étape compte comme atteinte            |
| `offRouteThresholdMetres` | `number`  | `40`    | au-delà, un relevé compte comme hors tracé                      |
| `confirmExit`             | `number`  | `3`     | relevés consécutifs avant de confirmer une sortie               |
| `confirmReturn`           | `number`  | `2`     | relevés consécutifs avant de confirmer un retour                |
| `retryAfterFixes`         | `number`  | `2`     | attente avant la première nouvelle tentative de recalcul        |
| `maxRetryFixes`           | `number`  | `8`     | plafond de l'attente, qui double à chaque échec                 |
| `voiceEnabled`            | `boolean` | `true`  | état de **départ** des annonces — reste commutable en session   |
| `voiceAnnounceAtMetres`   | `number`  | `200`   | distance à laquelle une manœuvre est annoncée une première fois |
| `keepScreenAwake`         | `boolean` | `true`  | maintient l'écran allumé pendant le guidage                     |
| `followZoom`              | `number`  | `17.5`  | zoom tenu pendant le suivi — réappliqué à **chaque** relevé     |
| `followPitch`             | `number`  | `60`    | inclinaison tenue pendant le suivi, en degrés                   |
| `cameraMaxTransitionMs`   | `number`  | `1000`  | plafond d'une transition de caméra, en millisecondes            |

🛑 **C'est le SEUL endroit où un seuil de guidage reçoit une valeur.** `snap.ts`, `off-route.ts`,
`state-machine.ts` et `runtime.ts` prennent tous les leurs en paramètres et n'en défaussent aucun :
un défaut écrit ici ET dans le module qui le lit diverge sans que rien ne rougisse, sur une quantité
que personne ne re-mesure parce que les deux côtés ont l'air de faire foi. **Un test lit les sources
du moteur et refuse toute valeur par défaut posée sur un paramètre de seuil.**

⚠️ **Une valeur hors bornes retombe sur son défaut — ni honorée, ni levée.** `confirmExit: 0` n'est
pas une confirmation plus courte, c'est son ABSENCE : chaque relevé bruité deviendrait une sortie
confirmée, donc une requête, donc un quota vidé en minutes. `arrivalRadiusMetres: -5` rendrait
l'arrivée inatteignable. Lever emporterait la carte pour une coquille dans un réglage de confort.

🛑 **Les trois clés de caméra sont arrivées le 27/08/2026, et deux d'entre elles CORRIGENT un
défaut, elles n'ajoutent pas un réglage.** `ui/camera.ts` portait `DEFAULT_PITCH = 50` et
`DEFAULT_MAX_TRANSITION_MS = 1000` en dur — dans le paquet dont cette fiche dit, quelques lignes
plus haut, qu'un seuil s'y déclare **ici et nulle part ailleurs**. Et le zoom était pire qu'en
dur : `CameraOptions.zoom` était **optionnel sans défaut**, et le seul appelant —
`ui/session-view.ts` — n'en passait aucun. **Le guidage ne cadrait donc rien** : il suivait le
point et tournait avec le cap, au zoom où l'utilisateur se trouvait, monde compris.

⚠️ **Le test-garde existait et il était VERT**, parce que son balayage s'arrêtait à `engine/`.
Il lit désormais `engine/` **et** `ui/`, et un second refuse tout membre optionnel dans
`CameraOptions` — les deux ont été vus rougir avant d'être crus. _Une garde n'est jamais plus
large que ce qu'elle lit._

⚠️ **`followPitch` et `followZoom` ont un PLAFOND, et ce n'est pas de la symétrie** : 80° est ce
que le moteur accepte (`maxPitch` de l'adaptateur), pas une préférence. Une valeur au-delà n'est
pas une inclinaison plus forte, c'est un nombre que le rendu refuse. Un pitch de **0 reste
honoré** : à plat est une inclinaison.

⚠️ **`maxRetryFixes` sous `retryAfterFixes` n'est PAS hors bornes** : chaque valeur est
individuellement valide, seule leur **relation** est fausse — laissée telle quelle, l'attente
rétrécirait à chaque échec au lieu de croître. Le plafond est relevé au plancher, **après** le
contrôle des bornes ; l'inverse comparerait une valeur qu'on allait jeter.

⚠️ **`offRouteThresholdMetres` doit rester plus large que `arrivalRadiusMetres`.** Un véhicule garé
à une livraison est couramment plus loin de la route que de l'étape ; si les deux se croisent,
chaque arrivée se lit comme une sortie de tracé.

⚠️ **`showButton` est à `false`, contre le gabarit, et c'est un choix de produit.** Le panneau
n'existe pas encore : un bouton visible par défaut serait un contrôle **mort** chez tout
intégrateur qui active le module — et un contrôle mort ne se signale pas, il se clique. Il
repassera à `true` avec ce qu'il ouvre.

---

## L'interface — bandeau de manœuvre et caméra suivie

`src/ui/{maneuver-banner,maneuver-labels,camera}.ts`, livrés le 21/08/2026 (tâches 4.9 et 4.10),
**câblés le 22/08/2026** par `src/ui/session-view.ts`.

### 🛑 Ils ont été écrits, testés, publiés en types — et INJOIGNABLES pendant un jour

Entre les deux dates, **rien n'importait ces trois fichiers**. Ni `session.ts`, ni la façade, ni
un hôte : le manifeste n'expose qu'un point d'entrée, donc aucun sous-chemin ne pouvait les
atteindre non plus. Une session démarrait, le moteur tournait, la progression s'émettait, et
**rien n'était dessiné**.

⚠️ **Trois instruments étaient verts dessus, et c'est la partie qui se généralise.** La suite de
bout en bout n'interrogeait que l'API — `state.guiding`, les états traversés —, donc son oracle ne
pouvait pas distinguer « le guidage marche » de « le guidage marche et n'affiche rien ». Knip tient
pour utilisé tout ce qui est atteignable depuis les `exports` du manifeste, et les `.d.ts` en font
partie. Et une tâche de revue nommée « code mort, doublons, **code non câblé** » avait été marquée
faite. **Le défaut a été trouvé en comptant des importeurs** — le seul des trois angles qui pouvait
le voir.

Ce qui a été ajouté avec le câblage, parce qu'il en avait besoin :

| Pièce                                  | Ce qu'elle rend                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/engine/maneuver.ts`               | la manœuvre **à venir** et sa distance — la borne du pas SUIVANT, jamais celle du pas courant |
| `GuidanceView` + `onView`              | un second canal, distinct de `onProgress` : position projetée, cap, secondes écoulées         |
| `src/ui/session-view.ts`               | le montage — ancre dans le conteneur de carte, abonnement, démontage                          |
| `src/__tests__/session-wiring.test.ts` | **le test qui manquait** : `session.ts` n'en avait aucun                                      |

🛑 **`NavProgress.stepIndex` était un `0` littéral** aux deux points d'émission du runtime. Un champ
toujours nul est indiscernable d'un champ que personne ne lit — jusqu'au jour où quelque chose le
lit. Câbler le bandeau est ce qui l'a lu.

⚠️ **Pourquoi un second canal plutôt que quatre champs de plus sur `NavProgress`** : ce type
appartient à `@geoleaf-plugins/routing` et voyage avec le modèle d'itinéraire. Une position
projetée et un cap résolu sont l'état de travail d'un moteur de guidage, pas des propriétés d'un
trajet — les y mettre imposerait l'interne d'un rendu à tout consommateur d'une route. Le partage
garde aussi `onProgress` stable : un intégrateur qui écoute l'avancement n'est jamais touché par ce
dont le bandeau a besoin.

### 🛑 Aucun markup n'est produit, et c'est plus fort qu'échapper

Le contenu vient d'un fournisseur : nom de route, manœuvre, modifier. `GeoLeaf.Security.escapeHtml`
existe et est monté — mesuré, pas supposé. Mais échapper sert à rendre une chaîne sûre **dans du
markup**, et ce module n'en produit aucun : chaque chaîne venue du fournisseur est écrite en
`textContent`. Une chaîne assignée ainsi ne peut pas devenir un élément, un attribut ni un
gestionnaire, quoi qu'elle contienne — c'est une propriété de l'assignation, pas d'un appel qu'il
faut penser à faire. **Un test lit la source des deux modules et refuse tout `innerHTML`.**

### La phrase est composée LOCALEMENT, jamais reprise du fournisseur

`RouteStep.instruction` est optionnel, et l'instance publique d'OSRM n'émet **aucun narratif** — un
bandeau bâti dessus serait vide pour tout utilisateur de ce moteur. ⚠️ Et quand un fournisseur en
donne un, il est dans la langue qu'on lui a demandée, pas celle de l'interface : l'afficher ferait
changer le bandeau de langue selon le moteur qui a répondu. La manœuvre et le modifier forment un
vocabulaire clos ; composer depuis eux donne une seule voix sur tous les moteurs. Le nom de route
vient bien du fournisseur, comme **donnée**, sur sa propre ligne.

### ⚠️ Les jetons sont normalisés avant d'indexer quoi que ce soit

Un modifier d'OSRM contient un **espace** — `slight left`. Dans un nom de classe, l'espace en crée
une seconde ; dans une clé i18n, il empêche la résolution. Et c'est le cas grave : l'utilisateur lit
alors le **repli** et le croit juste. **Une phrase générique qu'on prend pour la bonne est pire
qu'un blanc, qui se voit.** Le repli est donc nommé (« Poursuivez »), jamais le jeton brut — et
« la clé rendue telle quelle » compte comme une absence, certains hôtes répondant la clé.

### 🛑 La caméra est cadencée sur les RELEVÉS, jamais sur la boucle de rendu

Un `requestAnimationFrame` réveillerait le GPU soixante fois par seconde pendant tout le trajet, sur
un appareil qui tient déjà un verrou d'écran et une veille GPS, souvent débranché. Les positions
arrivent à ~1 Hz : **tout ce qui est entre deux relevés est inventé**, il n'y a aucune information
nouvelle à rendre. Un test lit la source pour refuser `requestAnimationFrame` et `setInterval` —
l'économie n'est gratuite que si personne ne remet la boucle « pour la fluidité ».

⚠️ La transition est **plafonnée** : un mouvement qui dure plus que l'intervalle tourne encore quand
le suivant commence, donc chacun arrive en retard et la caméra traîne de plus en plus.

⚠️ **`bearing` est OMIS quand il n'y a pas de cap, jamais mis à zéro.** L'appareil retire `heading`
précisément à l'arrêt ; mettre 0 ferait pivoter la carte plein nord à chaque feu rouge.

### 🛑 Le mode immersif — et pourquoi il appartient au CŒUR

`src/ui/immersive.ts`, posé et retiré par `attachSessionView` / `detach`. Livré le 27/08/2026.

**Le défaut d'origine n'était pas dans ce paquet.** Le bandeau s'ancre au haut-centre de la carte
(`top: .75rem; left: 50%`, z-index 500) ; la barre de thèmes du cœur occupe **le même pixel**
(`top: 10px; left: 50%`, z-index 1001, et 1490 en mobile). Comme `#geoleaf-map` est `absolute`
**sans** `z-index`, il ne crée aucun contexte d'empilement : les deux valeurs se comparent
directement, et 1001 gagne de 501 points. Le bandeau existait, se remplissait, se testait vert —
et n'était pas visible.

⚠️ **Et remonter le z-index n'est PAS le remède.** Il aurait enjambé `.gl-position-share-badge`
(z 900, même coordonnée, **même parent**), dont le rôle est de ne pas pouvoir être manqué pendant
que des données de localisation quittent le navigateur. Le bandeau reste donc à 500 et
**descend** quand un badge est là.

Ce que fait le plugin : il demande `GeoLeaf.UI.setImmersive(true, { fullscreen: true })`. Le cœur
retire son propre chrome et vise `document.documentElement`.

⚠️ **Le plein écran est un BEST-EFFORT et le guidage n'en dépend jamais.** Le geste qui démarre
une session est un clic, mais le bundle se charge paresseusement entre les deux : un import plus
lent que la fenêtre d'activation transitoire fait refuser la demande. Masquage du chrome et plein
écran sont **deux mécanismes**, et le premier est déjà acquis quand le second échoue.

🛑 **Un cœur `3.0.0` sans la couture satisfait `peerDependencies`.** Le mode serait alors un
no-op silencieux — ni chrome retiré, ni feuille de style pour le faire. L'absence est donc
**journalisée une fois**, jamais avalée par un `?.()`.

### La flèche du conducteur — la rotation est DÉLÉGUÉE au moteur

`src/ui/position-arrow.ts`, livré le 27/08/2026. Jusque-là, **une session ne dessinait aucun
marqueur de position** : la position de l'utilisateur était le centre de la carte, implicitement.

Le marqueur passe par la couture d'adaptateur du cœur (`createMarker` / `updateMarkerPosition` /
`removeMarker` / `setMarkerRotation`), celle qu'utilise déjà la capacité `geolocation` — aucune
source MapLibre n'est créée ici, la frontière tient.

🛑 **`rotationAlignment: "map"`, et l'angle passé est le cap BRUT.** L'implémentation évidente lit
le cap de la carte à chaque relevé et écrit `rotate(heading − bearing)`. Elle est fausse, et
démontrablement : le moteur réapplique déjà cette expression **à chaque frame rendue** pour un
marqueur aligné sur la carte, son `_update` étant abonné à `move`. La calculer une fois par relevé
fige la flèche pendant que la caméra tourne encore — **dans un virage à 90°, elle pointe à 90° du
vrai pendant tout le virage**, c'est-à-dire au seul moment où on la regarde. Déléguer respecte
aussi la règle du paquet : ni `requestAnimationFrame`, ni intervalle.

⚠️ **L'icône est du SVG PUR, jamais un `<div>` d'enveloppe.** L'adaptateur assainit `icon` contre
une liste blanche SVG qui ne contient pas `div` ; l'enveloppe serait retirée en silence, en
emportant la forme. La rotation ne touche pas non plus la racine du marqueur : c'est le nœud sur
lequel le moteur écrit sa propre `transform` de placement.

⚠️ **Sans cap, la rotation est laissée telle quelle**, jamais remise à zéro — même piège que le
`bearing` de la caméra, même remède.

⚠️ Le disque bleu de la capacité `geolocation` **s'efface** pendant le guidage : deux marqueurs de
position au même pixel se lisent comme un défaut d'affichage.

### 🛑 L'icône de manœuvre peignait un CARRÉ PLEIN

`css/geoleaf-navigation.css` déclarait `mask-size`, `mask-repeat` et `mask-position` sur
`.gl-nav-banner__icon` — et **aucun `mask-image`**, ni générique, ni par manœuvre. Sans masque, la
règle `background: currentcolor` peint le bloc entier : un carré de 2 rem, à la place de la flèche.
Rien ne pouvait le voir — les classes sont assemblées à l'exécution, donc invisibles à toute
analyse statique, et le bandeau lui-même était masqué par la barre de thèmes.

⚠️ **L'ORDRE DE DÉCLARATION des masques porte du comportement.** `maneuver-banner.ts` pose deux
classes de **même** spécificité (`--turn` ET `--left`) ; à spécificité égale, c'est la dernière
déclarée **dans la feuille** qui gagne, jamais la dernière écrite dans l'attribut. Les
modificateurs sont donc déclarés **d'abord** — ils portent la direction et servent de défaut aux
manœuvres qui n'ont volontairement pas de masque (`turn`, `continue`, `new-name`, `end-of-road`) —
et les manœuvres qui se décrivent seules **ensuite**, pour qu'un `arrive` + `left` rende un point
d'arrivée et non une flèche à gauche.

---

## Ce que le guidage DIT quand il ne peut pas recalculer

Livré le 22/08/2026 (tâche 5.6). `NavProgress` porte `rerouteFailure` — la cause de la dernière
tentative refusée, parmi les six que nomme le modèle de `@geoleaf-plugins/routing`.

🛑 **« Hors trajet » et « hors trajet, et je ne peux pas recalculer faute de réseau » étaient le
MÊME état à l'écran.** Ils appellent pourtant l'inverse l'un de l'autre : dans le premier cas on
attend quelques secondes que le nouvel itinéraire arrive ; dans le second on n'attend rien, et
mieux vaut revenir sur ses pas pendant qu'on sait encore où l'on est.

⚠️ Le champ est **omis** plutôt que mis à `null` quand il n'y a rien à signaler —
`rerouteFailure: null` se lit « il y a eu un échec, sans cause », ce qui n'est l'état de personne.
Et il est **effacé** dès qu'un recalcul aboutit : un motif qui survit à sa cause laisse un
avertissement permanent sous un guidage qui remarche depuis vingt minutes.

### 🛑 `online` est un INDICE, jamais un PRÉDICAT

`navigator.onLine` dit qu'un **lien** existe, pas que quelque chose répond : un portail captif, un
fournisseur hors service et une barre de réseau s'y lisent tous « en ligne ». Le runtime ne
l'interroge donc **jamais** pour décider s'il tente un recalcul — il tente, et lit la réponse.

Ce que l'événement `online` apporte est autre chose : _quelque chose vient de changer, ça vaut la
peine de réessayer maintenant_. Il **raccourcit l'attente en cours**, il n'autorise ni ne refuse
une tentative.

L'arbitrage se décide sur ce que coûte une erreur : un faux positif coûte une requête, qui échouera
et relancera l'espacement ; un faux négatif aurait coûté une attente **entière** alors que le
réseau était revenu — et c'est le seul des deux que l'utilisateur ressent, assis à un carrefour à
attendre un itinéraire.

⚠️ **L'espacement n'est PAS remis à son plancher.** Sur un réseau qui va et vient — un tunnel, une
vallée, une zone blanche traversée par intermittence —, chaque bascule remettrait le compteur à
zéro et l'espacement ne s'appliquerait plus jamais : on retrouverait exactement les rafales qu'il
existe pour éviter, et précisément là où la couverture est la pire.

### Une quatrième API de plateforme, et où elle vit

`window.addEventListener("online")` vit dans **`src/platform/`**, avec les trois autres, bien que
`PLATFORM-ISO` ne la garde pas nommément. La propriété que cette gate protège n'est pas sa liste :
c'est « un portage natif remplace trois fichiers ». Une quatrième API touchée ailleurs la casserait
sans qu'aucune gate ne le dise — et la gate resterait **verte**, ce qui est pire que si elle
n'existait pas.

---

## Le point d'entrée — et son garde est l'ABSENCE du handler

Livré le 21/08/2026 (tâche 4.15). `navigation` est enregistré **paresseux** dans l'`init.js` de
l'application ; le bouton qui le charge vit dans le panneau de `@geoleaf-plugins/routing`.

🛑 **Aucun `registerLazyForAction`, délibérément.** Un guidage n'a rien à suivre tant qu'aucun
itinéraire n'existe : un créneau de barre d'outils serait un contrôle qui ne fait rien la plupart du
temps, et `modules.navigation.showButton` reste `false` pour exactement cette raison. Le point
d'entrée vit là où vit l'itinéraire.

🛑 **Le panneau ne crée AUCUN bouton quand le handler n'est pas fourni** — plus fort qu'un bouton
caché ou désactivé. « Ça existe, mais pas pour vous » est faux : un intégrateur qui n'a pas installé
le plugin n'a pas cette fonctionnalité, et sa forme grisée l'enverrait chercher un réglage qui
n'existe pas.

⚠️ **La disponibilité se teste par `isLazyAvailable`, JAMAIS par `isLoaded`.** Un plugin paresseux
n'entre au registre qu'après son chargement, et le seul geste qui le chargerait est ce bouton :
gater sur `isLoaded` cacherait le point d'entrée derrière la condition qu'il sert à satisfaire.
C'est le piège que **D2** décrit pour `routing`, rencontré depuis l'autre côté.

### `recompute` et `decodeGeometry` sont des FERMETURES de l'appelant

Les deux exigent une **valeur** de `@geoleaf-plugins/routing` — un fournisseur à appeler, un codec
de polyline à exécuter — et ce paquet n'en importe que des **types**. Les lire sur
`GeoLeaf.Routing` fonctionnerait, c'est le canal sanctionné, mais cette surface ne porte ni codec ni
« calcule ceci » : il aurait fallu l'y ajouter pour un seul appelant. Le panneau, lui, tient déjà
les deux.

⚠️ **L'état de session vit dans `src/session.ts`, pas dans la façade** (`INV-FACADE`). Une façade
qui tient un état est une façade qu'on ne peut plus lire pour apprendre ce qu'est la surface : la
surface et sa machinerie s'y entremêlent.

## 🛑 Deux adaptateurs sur trois n'étaient reliés à RIEN

Câblés le 27/08/2026. Jusque-là, `platform/wake-lock.ts` et `platform/voice.ts` n'étaient importés
par **aucun fichier de production** — seulement par leurs tests. Donc `keepScreenAwake: true` et
`voiceEnabled: true`, documentés dans cette fiche et présents dans les deux profils du dépôt,
**ne faisaient rien** : l'écran s'éteignait en roulant, aucune manœuvre n'était annoncée.

⚠️ **C'est exactement le défaut que le §L'interface raconte avoir corrigé pour la caméra et le
bandeau** — écrits, testés, publiés en types, et injoignables. Deux modules y sont restés six jours
de plus, sous les mêmes instruments verts : knip tient pour utilisé tout ce qui est atteignable
depuis les `exports` du manifeste, et une suite qui interroge l'API ne distingue pas « le guidage
marche » de « le guidage marche et se tait ». **Le seul angle qui l'a vu, les deux fois, est de
compter les importeurs.**

### Où chaque moitié est câblée, et pourquoi pas ailleurs

| Moitié         | Domicile          | Motif                                                                                                                                                                                                                               |
| -------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verrou d'écran | `session.ts`      | Ce n'est pas ce qu'une session **dessine**, c'est ce qu'elle **tient** — au même titre que le runtime à côté. Et il doit survivre à une vue qui n'a jamais pu s'attacher : l'écran doit rester allumé qu'il y ait un bandeau ou non |
| Annonces       | `ui/announcer.ts` | Même cadence, mêmes échantillons et **mêmes deux composeurs de libellés** que le bandeau. Le poser près du module d'état aurait imposé un second abonnement à `onView` pour des données que la vue tient déjà                       |

🛑 **Le verrou de l'ancienne session est relâché AVANT d'en prendre un neuf.** Il installe un
écouteur `visibilitychange` ; un redémarrage qui sauterait la libération laisserait un écouteur
vivant **par session** pour la vie de la page, chacun redemandant un verrou pour un trajet fini, et
aucun d'eux joignable pour l'arrêter.

⚠️ **L'acquisition n'est jamais attendue.** Un verrou est refusé sur une origine non sûre, sur
batterie faible, sous une politique — tout cela est ordinaire. Un guidage qui attendrait, ou même
qui avertirait, serait pire qu'un écran qui s'éteint.

### 🛑 L'identité d'une étape est son OBJET, jamais son index

Une manœuvre s'annonce **exactement une fois**. La clé évidente est l'index de l'étape, et elle est
fausse dans le seul cas qui compte : après un recalcul, l'index 0 désigne une **autre** étape d'un
**autre** itinéraire, et s'y fier laisserait muette la première manœuvre du tracé neuf — celle qui
compte le plus, puisqu'on vient d'annoncer au conducteur qu'il est hors trajet.

Le moteur passe `ahead.step` à la vue, c'est-à-dire l'objet `RouteStep` pris tel quel dans le
tronçon : la référence est stable tant que l'itinéraire l'est, et change à l'instant où il est
remplacé. **Les deux moitiés de la règle en découlent gratuitement.**

⚠️ **Une manœuvre est marquée annoncée MÊME quand la voix est coupée.** Ne la marquer qu'après une
parole réussie ferait dire la manœuvre à l'instant où quelqu'un rétablit le son, si loin après le
virage soit-il.

⚠️ Une étape **plus courte que le seuil** est déjà dedans quand elle devient la suivante : elle est
donc annoncée immédiatement. Ce n'est pas un cas limite, c'est le comportement juste — attendre un
franchissement qui n'aura pas lieu la laisserait silencieuse.

### Les unités PARLÉES ne sont pas celles du bandeau

`navigation.voice.unit.metres` vaut « mètres » là où `navigation.unit.metres` vaut « m ». Ce n'est
pas une duplication : **un synthétiseur lit « m » comme la lettre**, et « dans deux cents m » n'est
pas une phrase. Deux sorties, deux jeux de libellés. La phrase se compose par un motif
(`navigation.voice.ahead`, `{0}` et `{1}`) plutôt que par concaténation, parce que l'ordre de la
distance et de la manœuvre change d'une langue à l'autre.

⚠️ **L'annonce ne porte PAS le nom de la voie.** Le bandeau l'affiche, comme donnée, sur sa propre
ligne. Le dire exigerait un second motif par langue — « tournez à gauche SUR x » ne se compose pas
avec tout le vocabulaire clos — pour un gain que la distance et la manœuvre rendent déjà.

---

---

⚠️ **Le README du paquet est la surface la plus LUE, et aucune gate ne la compare à la
configuration réelle.** Il part dans le tarball npm, il est immuable une fois publié, et
`check-config-coverage` ne le regarde pas — elle compare le schéma, l'inventaire et le code, trois
surfaces internes. Mesuré le 22/08/2026 : il documentait **2 clés sur 11**. La table y est
désormais complète ; c'est une relecture qui l'a corrigée, pas un instrument, et rien n'empêche la
divergence de revenir.

---

## 🛑 L'avertissement de début de session — et sa seconde phrase n'est pas juridique

`src/ui/session-notice.ts`, posé par `attachSessionView` à chaque session.

La première phrase est celle qu'on attend : la route et ses conditions réelles priment sur
l'itinéraire proposé. Elle se dit brièvement.

**La seconde est celle pour laquelle ce bandeau existe.** La géolocalisation en arrière-plan est
**impossible en navigateur** — iOS l'interrompt au verrouillage, Android gèle les onglets — donc le
guidage s'arrête dès que l'application cesse d'être ce que l'écran montre. ⚠️ **Un opérateur qui ne
le sait pas met son téléphone en poche et le découvre EN ROULANT**, au moment précis où il ne peut
pas y répondre. La limite était écrite dans cette fiche ; elle n'était dite **à l'utilisateur**
nulle part.

### Pourquoi il ne BLOQUE pas le guidage

La construction évidente conditionne `start()` à un accusé de réception. Elle est fausse : la veille
de position ne s'ouvrirait qu'après un tapotement, donc **le premier relevé — celui qui place le
conducteur sur le tracé — serait celui que personne n'a attendu.** Le moteur tourne derrière
l'avertissement ; l'accusé congédie le bandeau, pas la session.

### Pourquoi `role="region"` et non `alertdialog`

`alertdialog` piège le focus et exige une réponse avant tout le reste. Un piège à focus au moment
où quelqu'un s'apprête à conduire est le pire endroit possible pour en poser un. `region` avec un
nom l'annonce à un lecteur d'écran dans l'ordre du document et laisse la carte utilisable derrière.

### Pourquoi à chaque SESSION et non une fois par page

La spécification le dit, et le motif survit à la répétition : la limite d'arrière-plan est
exactement le genre de fait qu'on lit une fois, qu'on approuve, et qu'on a oublié au troisième
trajet. Un avertissement montré une fois par installation est montré à celui qui a installé.

## Frontières

- **Vers le cœur** : par `globalThis.GeoLeaf.*` uniquement (INV-NS).
- **Vers `routing`** : dépendance npm déclarée, **types seulement**. Aucune valeur importée.
- **Vers le navigateur** : par `src/platform/` uniquement, gaté par `PLATFORM-ISO`.
- **Vers le rendu** : par la couture du cœur. Aucune source MapLibre créée ici.
- **Vers le CHROME de l'hôte** : par `GeoLeaf.UI.setImmersive` uniquement. Ce paquet ne vise
  **aucun** sélecteur du cœur ni du shell d'application depuis sa feuille — sauf
  `.gl-user-location-marker`, nommé sur place avec son motif. Le corollaire vaut d'être écrit : un
  plugin qui masquerait `#gl-theme-primary-container` lui-même y arriverait, et rendrait le
  masquage invisible du côté masqué — la capacité ne pourrait ni le savoir, ni le tester.
