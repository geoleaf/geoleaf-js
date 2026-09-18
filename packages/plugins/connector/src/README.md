# plugin-connector — Internals (`src/`)

Ce document décrit les **interactions entre modules** du plugin `@geoleaf-plugins/connector` :
l'ordre dans lequel `configure()` installe ses crochets, par quel canal chaque requête reçoit son
en-tête, et comment le pont MapLibre se raccroche à une carte qui n'existe pas encore.

**Ne pas importer ces modules directement** — utiliser l'API publique via `GeoLeaf.Connector` ou
`createConnector()`.

> ⚠️ **Ce document ne liste plus les exports, ni les interfaces, ni l'arbre des imports** — et
> l'omission est délibérée. Il l'a fait jusqu'au 14/08/2026, et **toutes ses erreurs étaient là** :
> un champ `auth.credentials` qui n'a jamais existé, `configure()` et `ConnectorInstance` attribués
> à `entry.ts` alors qu'ils vivent dans `connector-api.ts`, `TokenRecord` et `DataFormat` annoncés
> exportés sans l'être, trois modules sur onze absents de la table. Une signature recopiée à la main
> rediverge ; celle du fichier, non. **Pour un module : lire son fichier.** Ce qui reste ici est ce
> qu'aucun fichier ne porte seul.

---

## Modules

Rôle seulement — les exports se lisent dans le fichier.

| Fichier                | Rôle                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `entry.ts`             | Point d'entrée — boot, auto-bootstrap du bouton, ré-exports ESM                                                              |
| `connector-api.ts`     | **L'orchestrateur** — `configure()`, le singleton global, la fabrique                                                        |
| `public-api.ts`        | Construction du namespace `GeoLeaf.Connector`                                                                                |
| `config.ts`            | Types et validation de `ConnectorConfig`                                                                                     |
| `auth-client.ts`       | Appels HTTP vers l'endpoint d'authentification ; le renouvellement rend un verdict (renouvelé, refusé, indisponible)         |
| `token-store.ts`       | Persistance IndexedDB + cache RAM + refresh JWT silencieux ; verdict de session, comparer-et-échanger, pause après une panne |
| `fetch-interceptor.ts` | Monkey-patch `window.fetch` — injection de l'en-tête `Authorization`, archives PMTiles comprises                             |
| `maplibre-bridge.ts`   | `map.setTransformRequest()` pour les tuiles vectorielles (MVT)                                                               |
| `host-token.ts`        | Le jeton de l'hôte (`getToken`) tiré pour l'ouvrier et les tuiles, sans jamais jeter                                         |
| `session-resume.ts`    | Reprise de la file d'écriture quand une session revient                                                                      |
| `renewal-retry.ts`     | Relance du renouvellement après une panne : réseau, premier plan, saisie en file                                             |
| `credential-button.ts` | Injection du bouton credential (desktop + mobile)                                                                            |
| `login-ui.ts`          | Modal de connexion accessible (feuille de style adoptée)                                                                     |
| `format-detector.ts`   | Détection du format de données depuis une URL — fonction pure                                                                |
| `lang/`                | Dictionnaires i18n de la modal                                                                                               |

⚠️ **L'orchestrateur est `connector-api.ts`, pas `entry.ts`.** C'est l'erreur que l'ancien arbre des
dépendances portait, et elle induit en erreur sur le point qui compte : `entry.ts` délègue ; c'est
`connector-api.ts` qui importe le reste et tient l'état. Le décompte se lit dans ses `import`, il ne
s'écrit pas ici.

---

## Flux — `configure()`

```mermaid
flowchart TD
    A["GeoLeaf.Connector.configure(config)"] --> B["validateConfig(config)\nconfig.ts"]
    B -->|ConfigError| ERR["throw ConfigError"]
    B -->|valide| R0["disarmRenewalRetry()\nla relance de la session précédente"]
    R0 --> R{"une instance\nexiste déjà ?"}
    R -->|oui| R2["uninstallCredentialButton()\ndestroy() + uninstallFetchInterceptor()"]
    R -->|non| C{"auth.endpoint\nprésent ?"}
    R2 --> C
    C -->|oui| D["délégué de refresh"]
    C -->|non| W["reconnexion guidée\n+ reprise de la file armées"]
    D --> W
    W --> S{"auth.endpoint ?"}
    S -->|oui| S2["TokenStore.resolveSession()\nwarm du cache + ce qu'est la session"]
    S -->|non| G["installFetchInterceptor(config)\n+ hook worker-headers"]
    S2 --> G
    G --> H["installMapLibreBridge(config)\nmaplibre-bridge.ts"]
    H --> I{"la session ?"}
    I -->|jeton, ou getToken| K["installCredentialButton(config)"]
    I -->|renouvellement injoignable| RR["armRenewalRetry()\nni fenêtre ni ConfigError"]
    I -->|absente ou refusée, auth.ui| J["showLoginModal()\nlogin-ui.ts"]
    I -->|absente ou refusée, sans ui| ERR2["throw ConfigError"]
    RR --> K
    J --> K
    K --> L["createConnector(config)\n→ ConnectorInstance"]
```

Quatre étapes sont faciles à manquer en lisant le code de haut en bas :

- **`configure()` est ré-entrant.** Un second appel démonte l'instance précédente avant tout le
  reste — bouton, `destroy()`, interception `fetch`. Sans quoi deux monkey-patches se
  superposeraient sur `window.fetch`.
- **Le hook worker.** L'interception pose aussi `__GEOLEAF_WORKER_HEADERS_HOOK__` sur le global :
  un Worker n'hérite pas du `window.fetch` patché, il doit demander ses en-têtes. En `getToken`, il
  rend le jeton de l'hôte — une promesse seulement à un cœur qui l'annonce (`acceptsPromise`).
- **La reprise est armée AVANT la lecture de la session** : un renouvellement au démarrage émet
  `token-refreshed`, que la reprise de la file doit entendre.
- **La décision vient APRÈS l'installation** : une fenêtre fermée par l'utilisateur rejette
  `configure()`, et un jeton obtenu ensuite par `openLoginModal()` doit trouver l'intercepteur en
  place.

---

## Routage des requêtes

| Format détecté                                            | Canal d'injection                                    |
| --------------------------------------------------------- | ---------------------------------------------------- |
| `geojson`, `flatgeobuf`, `kml`, `csv`, `oapif`, `pmtiles` | monkey-patch de `window.fetch`                       |
| `mvt`                                                     | `map.setTransformRequest()` via `maplibre-bridge.ts` |

La séparation est **nécessaire**, pas esthétique : MapLibre charge ses tuiles vectorielles dans son
propre ouvrier, qui n'utilise pas le `window.fetch` patché. Le partage se lit dans
`fetch-interceptor.ts`, sur une seule condition — l'intercepteur se retire pour `mvt`, et le pont le
reprend.

⚠️ **Les archives PMTiles restent sur `window.fetch`, et c'est ce qui les authentifie.** La
bibliothèque `pmtiles` lit l'archive par le `fetch` global, sur le fil principal ; le pont ne voit que
l'URL `pmtiles://…`, dont l'origine est `"null"`, et le protocole ignore les en-têtes d'une requête.
Longtemps exclues « parce que le pont s'en charge », elles ne recevaient le jeton dans aucun mode.
Leur `Range` voyage dans un objet `Headers` : l'injection construit donc ses en-têtes avec la
sémantique de `fetch`, jamais en les étalant comme un objet.

⚠️ **En mode `auth.endpoint`, le pont lit le token par `getTokenSync()`** — le cache RAM seul.
Conséquence à connaître avant de s'étonner : **si la RAM est froide, la requête de tuile part SANS
en-tête.** Le pont déclenche au passage un `getTokenAsync()` non bloquant, qui réchauffe le cache
pour les requêtes suivantes ; le warm IDB au début de `configure()` réduit la fenêtre, il ne la
ferme pas.

⚠️ **En mode `getToken`, le pont tire le jeton de l'hôte à chaque tuile** (`host-token.ts`), sans
lire le magasin, que l'hôte ne remplit jamais. Un fournisseur synchrone répond synchrone ; un
fournisseur asynchrone donne une promesse de la requête — que MapLibre attend depuis la 5.21 —, qui
se résout toujours en une requête (`{ url }` sans jeton). Sur un moteur plus ancien, la valeur rendue
ÉTAIT la requête : la tuile part alors sans jeton, et un avertissement le dit une fois.

---

## Pont MapLibre — stratégie de résolution

Le pont s'installe en **trois temps**, parce que la carte peut naître avant ou après le plugin :

1. **Immédiat** — si la carte est disponible au moment de `configure()`.
2. **Différé** — via un écouteur `geoleaf:map:ready` si elle ne l'est pas encore.
3. **Défensif** — ré-installation sur `geoleaf:basemap:change`, un `setStyle()` pouvant emporter le
   hook.

L'accès à la carte passe par `globalThis.GeoLeaf.Core.getMap().getNativeMap()` — **aucun import de
`@geoleaf/core`**. Ce n'est pas une commodité : le plugin doit rester chargeable sans que le core
soit un module de son graphe.
