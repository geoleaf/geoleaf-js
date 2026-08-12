# GeoLeaf-JS — Contrat du shell applicatif

**Source de vérité :** `apps/geoleaf-app/` (`index.html`, `init.js`)
**Gardé par :** `scripts/verify-app-template.cjs` (APP-01…APP-11), `scripts/build-deploy.cjs`
**Écrit le :** 09/08/2026

📌 **Ancrage des chemins.** Un chemin cité sans racine se lit depuis `apps/geoleaf-app/` — la
source de vérité ci-dessus. Un chemin qui commence par `packages/`, `scripts/`, `profiles/`,
`docs/` ou `deploy/` est relatif à la **racine du dépôt**.

> `apps/geoleaf-app/` est l'**application déployable** et la source unique des variantes de
> `deploy/`. Elle n'avait aucune fiche : son raisonnement de conception vivait dans les
> commentaires de ses deux fichiers, qui partent verbatim chez le client. Cette fiche est le
> domicile de ce raisonnement ; les fichiers sources n'en gardent qu'une ligne par décision.

---

## Ce que produit `build-deploy.cjs`

Quatre variantes, dont **deux seulement sont livrables** :

| Variante          | Livrable | `offline-ui` | `cog` | `editor` | bootstrap de poste |
| ----------------- | -------- | ------------ | ----- | -------- | ------------------ |
| `deploy-core`     | ✅       | ✗            | ✗     | ✗        | ✗                  |
| `deploy-full`     | ✅       | ✓            | ✓     | ✓        | ✗                  |
| `deploy-local`    | ✗        | selon flags  | …     | …        | ✓                  |
| `deploy-coverage` | ✗        | —            | —     | —        | ✗                  |

`deploy-coverage` est produite par `scripts/build-deploy-coverage.cjs`, qui la déclare non livrable.
⚠️ Ne jamais renommer `deploy/deploy-coverage/` — le nom est verrouillé par des littéraux du
dépôt **et** par un vhost nginx hors dépôt, donc invisible à toute gate.

### Ce qu'une variante livrable emporte EN PLUS de l'application (09/08/2026)

| Fichier              | Contenu                                                                                                                | Gate             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `SERVEUR.md`         | Le contrat serveur : une exigence par section, avec **le symptôme exact** si elle manque et la commande qui le vérifie | `SC-01`          |
| `nginx.conf.example` | Bloc `server` prêt à coller                                                                                            | `SC-01`, `SC-02` |
| `.htaccess`          | Équivalent Apache, **actif tout seul** si `AllowOverride` le permet                                                    | `SC-01`, `SC-02` |

Émis à l'étape **9b** de `scripts/build-deploy.cjs` depuis `scripts/lib/server-contract.cjs` (un seul
corpus), gardés par `scripts/verify-deploy-server-contract.cjs`, câblé des **deux** côtés de la CI.

🛑 **Le motif, parce qu'il se reproduira ailleurs.** Le 09/08/2026, un `deploy-full` copié tel quel
sur un serveur nginx de production a rendu un spinner infini : la table `mime.types` de nginx ne
connaît que `js`, les `.mjs` du moteur MapLibre partaient en `application/octet-stream`, et le
navigateur refuse d'exécuter un module sous ce type. **Le dépôt SAVAIT** — `docker/nginx.dev.conf`
porte la directive sous « SANS CETTE LIGNE, RIEN NE BOOTE », et admet dans la foulée : « ⚠️ Cette
contrainte VIT HORS DU DÉPÔT pour l'intégrateur — aucune gate ne peut la voir chez lui ».

Ce n'était donc **pas un trou de connaissance mais de DIFFUSION** : le fait était écrit, dans un
fichier de développement qui ne part pas avec le dossier. Le correctif n'est pas de mieux
documenter, c'est de faire **voyager** la recette avec l'artefact qu'elle concerne.

⚠️ Aucun des trois n'entre dans l'allowlist de pré-compression — pas de jumeau `.gz`/`.br`, et
c'est voulu : ils sont lus une fois, par un humain, avant que quoi que ce soit ne soit servi.

### Ce qu'une variante livrable N'emporte PAS

Le **backend de preuve** — l'hôte déclaré dans `DEV_BACKEND_HOSTS` (`scripts/lib/dev-backend.cjs`),
monté par `docker-compose.dev.yml` et résolu par le seul fichier `hosts` du poste. ⚠️ **Le nom de
cet hôte n'est pas écrit ici, et c'est délibéré** : cette fiche part dans le dépôt public, et
`scripts/lib/dev-backend.cjs` est la source unique — l'y recopier créerait une seconde liste qui divergerait,
et ferait de surcroît nommer une infrastructure de développement dans un document publié. Ses
liaisons — `offline.source`, `write.endpoint`,
`options.uploadEndpoint` de la couche `sites_rosario` — sont retirées à l'étape **9a**, par
`scripts/lib/dev-backend.cjs`, et l'absence est gardée par `DNS-05`.

- **Le discriminant est `includeDevConnector`**, le même que pour le jeton : la liaison et le
  jeton sont les deux moitiés d'une même chose, on n'écrit pas sur ce backend sans le second.
- **La règle nomme les hôtes de dev, jamais une allowlist de fournisseurs.** Une allowlist
  supprimerait en silence le backend de production d'un profil client — faux positif invisible
  jusqu'à l'exploitation. Un hôte de dev oublié, lui, se voit au premier essai.
- **L'affichage n'est pas touché** : la couche garde son `data.file` local. Seuls le rapatriement
  et l'écriture deviennent inertes, et `write.enabled` passe à `false` — jamais un `true` sans
  cible, qui promettrait une écriture impossible et ferait perdre sa saisie à l'utilisateur.
- **Porte de sortie**, pour éprouver le cycle hors-ligne complet sur `deploy-full` :
  `GEOLEAF_BACKEND_BASE_URL=https://<votre-backend> npm run build:deploy` — la recette vaut pour
  n'importe quel hôte, et c'est pourquoi elle n'en nomme aucun. Éprouvée de bout en
  bout le jour de sa pose — `e2e/30-sync-cycle.spec.js` repasse **9/9**, et saute avec un motif
  nommé sans elle. ⚠️ Ne **jamais** faire dépendre ce défaut d'un fichier présent sur la machine
  qui construit : ce serait un livrable dont le contenu varie selon qui lance le build.

---

## Les marqueurs fonctionnels — six paires, à garder au caractère près

`scripts/build-deploy.cjs` patche ces deux fichiers par regex `/gm` **sans** `/s` côté HTML, et par
`indexOf` côté JS. Un marqueur supprimé ou reformaté **ne casse pas le build : il cesse
silencieusement de matcher**. C'est la classe de faux vert que tout ce dispositif existe pour
empêcher.

| Fichier      | Marqueur                                         | Gate                           | Exigence                     |
| ------------ | ------------------------------------------------ | ------------------------------ | ---------------------------- |
| `index.html` | `<!-- __GEOLEAF_MODULEPRELOAD__ -->`             | APP-08                         | présent **et sur UNE ligne** |
| `index.html` | `<!-- Optional plugins — variant-gated: … -->`   | APP-04                         | présent **et sur UNE ligne** |
| `index.html` | `GEOLEAF-DEPLOY:DEV-CONNECTOR ─── START` / `END` | APP-11                         | la **paire** présente        |
| `index.html` | balise `<script src="connector.local.js">`       | APP-11                         | **sur UNE ligne**            |
| `init.js`    | `GEOLEAF-DEPLOY:GATED-BLOCK editor` START/END    | APP-07 + `stripGatedInitBlock` | la **paire** présente        |
| `init.js`    | `GEOLEAF-DEPLOY:GATED-BLOCK cog` START/END       | APP-07 + `stripGatedInitBlock` | la **paire** présente        |

Les deux gardes se complètent et aucune ne peut sortir verte en ne contrôlant plus rien :
`stripGatedInitBlock` **jette** quand il ne trouve pas une paire, et APP-07 tient la direction
inverse — une référence à un bundle gaté posée **hors** des marqueurs fait rougir.

⚠️ **APP-06 cherche les spécificateurs d'import par expression régulière sur le TEXTE BRUT**,
sans distinguer code et commentaire. Ne jamais écrire un appel d'import en toutes lettres dans
un commentaire d'`init.js` : la gate rougira, et elle aura raison — un commentaire n'est pas
une exemption.

---

## Politique de sécurité du contenu

La CSP d'`index.html` est validée pour **MapLibre GL JS v6**, sans `unsafe-eval` et sans aucune
origine tierce : le moteur est auto-hébergé et il n'y a plus de police web.

**Pourquoi `worker-src` et non `script-src blob:`** — tranché en navigateur, pas par
raisonnement. Sous MapLibre 6, le worker est chargé par `new Worker(url, {type:"module"})` sur
un `.mjs` same-origin : `page.workers()` liste bien `maplibre-gl-worker.mjs` chargé par son URL,
jamais un `blob:`. Cela relève de `worker-src` (conservé), avec `child-src` en repli CSP2. Le
code du moteur garde un repli `Blob → Worker` qui n'est emprunté sur aucun chemin mesuré ; s'il
le devenait, c'est `worker-src blob:` qui le couvrirait.

⚠️ **APP-09 compare une DÉCLARATION, pas un comportement.** Elle confronte la politique à
`EXPECTED_CSP` dans les deux sens et interdit `'unsafe-eval'`, `'unsafe-inline'` et `*` par une
seconde couche que la mise à jour de la constante ne lève pas. Toute modification se vérifie
**aussi** à la main, console ouverte, sur les deux variantes livrables.

**`X-Content-Type-Options` n'a pas sa place en `<meta>`.** Aucun navigateur ne l'honore hors
en-tête de réponse HTTP ; la balise ne produisait qu'une fausse assurance, ce qui est pire
qu'une absence. Le serveur le pose (`docker/nginx.dev.conf`), gardé par NGINX-01. En revanche
`<meta name="referrer">` **est** valide en balise — ne pas le retirer en croyant appliquer la
même leçon.

---

## MapLibre : auto-hébergement et ordre d'exécution

`scripts/build-deploy.cjs` copie le moteur depuis `node_modules` via `require.resolve`, donc **la
version servie est celle qui est installée** — aucun numéro écrit à la main ne peut diverger du
peerDep.

**Pas de SRI** : un hash ne protège que d'un tiers, qui n'existe plus en same-origin, et il
casserait à chaque montée de version.

`vendor/maplibre-gl/global.mjs` est un **shim de deux lignes** émis par le build : la v6 est
ESM-only et ne publie plus le global `maplibregl`, que l'adaptateur et trois plugins lisent
pourtant. Il l'importe et le repose.

⚠️ **L'ordre ne tient plus à `defer` mais à la spécification HTML** : deux `<script
type="module">` non-`async` du même document s'exécutent dans l'ordre du document. Ajouter un
`async` sur l'une des deux balises casserait la garantie, et silencieusement. Gardé par APP-10.

---

## Le partage eager / lazy

**Un plugin paresseux n'exécute rien tant qu'il n'est pas chargé — y compris ses
`addEventListener`.** C'est ce fait, et non une préférence de performance, qui décide la forme
du bloc d'enregistrement d'`init.js` : chaque entrée doit nommer **ce qui la charge**.

`offline-ui` reste **eager**, et ce n'est pas un oubli : son `wireEngineSignals()` remonte
`QuotaExceededError` et l'éviction de cache jusqu'à l'utilisateur. Chargé paresseusement,
l'écouteur n'existerait jamais et l'avertissement ne partirait pas — une régression silencieuse
qui ne coûte pas du temps mais des **données de terrain non synchronisées**.

Tout le reste est paresseux, en quatre familles de déclencheur :

| Famille             | Plugins                                            | Ce qui les charge                                              |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| API pure            | `cog`, `file-import`, `websocket`                  | `plugins.load(id)` explicite par le consommateur               |
| Couche déclarative  | `flatgeobuf`                                       | la couture `ensurePluginLoaded` du core                        |
| Créneau de barre    | `geocoding`, `table`, `print`, `measure`, `editor` | `registerLazyForAction`, qui déclare le bouton AVANT le bundle |
| Dépendant du profil | `realtime-layer`, `connector`, `geocoding`         | le hook `beforeBoot`                                           |

**`beforeBoot` est le seul point du cycle** qui court après le chargement du config de profil et
avant la création de la carte — donc avant `geoleaf:profile:loaded`, `geoleaf:map:ready` et
`geoleaf:app:ready`, les trois signaux auxquels ces plugins s'abonnent **à l'import**. Les
charger plus tard n'aurait servi à rien : l'écouteur serait posé après l'événement.

⚠️ **La détection des besoins du profil est un PARCOURS DE L'OBJET, pas une lecture de chemin.**
Un drapeau écrit `ui.showCredentialButton` dans une source de profil vit à
`ui.ui.showCredentialButton` une fois fusionné. Un chemin en dur rendrait `false` pour toujours,
le plugin ne serait jamais chargé, et la fonctionnalité disparaîtrait sans aucune erreur —
indiscernable d'un plugin légitimement non requis. On cherche la **clé**, pas le chemin
(`_scanProfileNeeds`).

---

## Les libellés des créneaux paresseux

🛑 **Ils se déclarent dans `init.js`, pas dans le paquet du plugin.** `labelKey` est résolu **au
boot** pour devenir l'`aria-label` et le `data-tooltip` du bouton, alors que le dictionnaire du
plugin n'est chargé qu'au premier clic — et `I18n.getLabel` rend **la clé brute** quand il ne la
connaît pas. Un libellé qui ne vit que dans le paquet produit donc un bouton dont le **nom
accessible est la clé**. Les valeurs déclarées dans `init.js` sont **dérivées** du catalogue du
paquet, jamais réécrites.

---

## Le bootstrap de poste

`connector.local.js` porte un jeton à privilège d'écriture. Il n'existe que dans `deploy-local`.
Le retrait de sa balise par marqueur est ce qui rend son absence **structurelle** plutôt que
disciplinaire : une variante livrable n'a ni le fichier, ni la balise qui le charge.

🛑 **Ne pas revenir à un `import()` depuis `init.js`.** C'est ce qu'il y avait, et c'était un
import **obligatoire** d'un fichier **optionnel** : il forçait un talon inerte dans chaque
variante, une entrée dans le `required` du build, une exemption nommée dans la gate, et un
fichier à la racine de ce qui part chez un client. Le chargement par balise gatée supprime les
quatre. Ne pas réintroduire de talon « par sécurité » non plus : il rendrait de nouveau
indiscernables « aucun bootstrap » et « un bootstrap qu'on n'a pas su lire ».

⚠️ Une garde sur `location.hostname` ne remplace pas ce retrait : elle borne l'**exécution**, or
**un secret se lit**. `curl https://<hôte>/connector.local.js` le rendait en clair. Gardé par
`scripts/verify-deploy-no-secrets.cjs` (DNS-01…04) et APP-11.

---

## Ce qui ne se documente pas ici

L'**historique** des décisions ci-dessus — quand elles ont changé, quel sprint, quelle ligne de
registre les a soldées. Il vit dans le journal et les registres du dépôt de travail, et dans les
messages de commit — pas dans ce dépôt-ci.
Le recopier ici recréerait le doublon que cette fiche existe pour retirer.
