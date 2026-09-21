# Backend de preuve — dev uniquement (tâche 4.H)

Le critère de preuve du cycle hors-ligne dit : _coupure réseau → édition d'une entité **rapatriée** →
rechargement → **l'édition est toujours visible** → retour du réseau → push → **l'entité porte son
identifiant serveur**, et une seconde synchronisation ne produit **aucune** requête._

Chaque verbe de cette phrase exige un serveur. Avant le 03/08/2026 il n'y en avait aucun : l'hôte du
backend résolvait sur `127.0.0.1` sans routeur Traefik derrière (404), aucun conteneur d'API ne
tournait, et `e2e/11-connector.spec.js` — le seul E2E authentifié — mockait chaque réponse par
`page.route()`. **Le dépôt n'avait jamais parlé à un backend réel.**

⚠️ **DEV UNIQUEMENT.** Rien de tout ceci n'est déployé, ni publié sur npm.

---

## `GEOLEAF_DEV_BACKEND_HOST` — l'hôte n'est pas écrit dans ce qui SERT à router

Le nom d'hôte du backend de preuve est un nom d'**infrastructure de poste** : il ne résout que là où
son entrée `hosts` et son certificat existent. Il vit donc dans le `.env` de la racine (git-ignoré, à
côté de `GEOLEAF_PG_PASSWORD` et `GEOLEAF_JWT_SECRET`), et **trois fichiers** le lisent pour router :

⚠️ **Ce paragraphe a longtemps dit « écrit nulle part dans le dépôt », et c'était FAUX.** Mesuré le
20/09/2026 : `git grep` rend une vingtaine d'occurrences suivies, dont
`scripts/lib/dev-backend.cjs` — **par nécessité**, c'est la liste des hôtes que `build-deploy.cjs`
doit reconnaître pour les RETIRER des livrables, et une liste qui ne nomme pas ne retire rien — et
`e2e/30-sync-cycle.spec.js`, qui le porte en dur. La propriété vraie est plus étroite que celle qui
était écrite : la variable évite l'hôte **dans la configuration de routage**, pas dans le dépôt.

| Fichier                              | Ce qu'il en fait                                                       |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `docker-compose.dev.yml`             | les 3 règles `Host(…)` des routeurs Traefik, et l'injection ci-dessous |
| `docker/backend/pygeoapi.config.yml` | `server.url` et `metadata…url`, étendus par pygeoapi au chargement     |
| ce README                            | les recettes `curl` ci-dessous                                         |

```bash
# .env, à la racine du dépôt — git-ignoré
GEOLEAF_DEV_BACKEND_HOST=<votre-hôte-de-backend>
```

🛑 **La variable est déclarée `${…:?message}` côté compose, jamais `${…:-défaut}`.** Un défaut
ré-écrirait l'hôte en clair dans un fichier suivi, ce qui annulerait le retrait ; une substitution
nue rendrait une règle `Host` à hôte **vide**, c'est-à-dire un backend qui ne route plus, découvert
au prochain appel du navigateur et pas au démarrage. La forme retenue fait échouer
`docker compose` au premier geste, **en nommant la variable manquante**.

⚠️ **Côté pygeoapi, il n'y a pas d'équivalent de `:?`** : `os.path.expandvars` laisse un `${…}` non
résolu **tel quel**, donc le serveur servirait cette chaîne comme base URL au lieu d'échouer. C'est
la raison pour laquelle `docker-compose.dev.yml` déclare la variable avec `:?` **au moment de
l'injecter dans le conteneur** — l'échec est déplacé là où il est bruyant.

Les recettes `curl` de ce document supposent la variable exportée :

```bash
set -a; . ./.env; set +a
```

---

## Ce qui tourne

Une seule origine — `https://$GEOLEAF_DEV_BACKEND_HOST` —, deux services derrière, parce que le
cycle a deux bouts et qu'ils ne parlent pas le même protocole :

| Chemin | Service       | Rôle                            | Consommé par               |
| ------ | ------------- | ------------------------------- | -------------------------- |
| `/`    | **PostgREST** | écriture, dialecte `collection` | 4.4 / 4.5, les adaptateurs |
| `/ogc` | **pygeoapi**  | lecture, OGC API Features       | 4.1, `ogc-api-loader.ts`   |

Aucun code de transport n'a été écrit d'un côté ni de l'autre : les deux formes existaient déjà.
`POST {baseUrl}/{layerId}` avec un corps plat `{...properties, geom}` **est** un endpoint de table
PostgREST, et `ogc-api-loader.ts` parle déjà OGC API Features (contrat, point 6).

### 🛑 pygeoapi et non pg_featureserv — sur une mesure, pas une préférence

pg_featureserv 1.3.1 a été monté en premier. Il sert `bbox` et `limit` correctement, mais **n'émet
aucun lien `next` dans son JSON** — vérifié sur 27 lignes avec `limit=10` : `links` ne portait que
`self` et `alternate`, et `numberMatched` était absent.

Or `_extractNextUrl()` pilote la pagination **uniquement** sur `links[rel="next"]`. Contre
pg_featureserv, le rapatriement s'arrête après la première page **et sort en succès**. L'un des
quatre mécanismes que nomme le point 6 du contrat aurait été improuvable en ayant l'air prouvé.

pygeoapi est l'implémentation de référence et émet `next`/`prev` nativement. Mesuré au montage :
**3 pages, 27 features accumulées.**

---

## Le même banc, sur un runner — `docker-compose.ci.yml`

`docker-compose.dev.yml` ne monte nulle part ailleurs qu'ici : réseaux `external: true`,
étiquettes Traefik, un hôte qui ne résout que sur ce poste, et un PostGIS **partagé**, hors
compose. Le banc de CI apporte sa base, n'a ni TLS d'infrastructure ni entrée `hosts`, et sert
sur `localhost`.

Ce que les deux partagent est délibéré : le **schéma**, la **graine** et la **config pygeoapi**.
Un second fichier de config aurait dérivé du premier sans que rien ne le dise — et c'est la config
qui porte `time_field`, donc la garantie 1 du contrat. D'où deux variables
(`GEOLEAF_BENCH_BASE_URL`, `GEOLEAF_PG_HOST`) plutôt qu'un fichier jumeau.

**Une seule commande, ici comme sur le runner :**

```bash
node scripts/run-backend-contract.cjs
```

Elle monte le banc en deux temps, fabrique le bootstrap, reconstruit la variante repointée et
joue `e2e/30-sync-cycle.spec.js` et `e2e/31-delta-contract.spec.js`. `ci:local -- --e2e` la
lance aussi. Côté `ci.yml`, l'étape porte **la même condition que l'E2E** — donc rien ne monte
sur un push d'atelier.

### Trois défauts que SEUL le banc de CI a montrés

| Ce qui a mordu                                                                                                       | Pourquoi le poste ne pouvait pas le voir                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| PostgREST et pygeoapi meurent s'ils démarrent **avant** le schéma                                                    | ici la base est graine depuis des semaines ; un runner en apporte une **neuve** à chaque run                           |
| Un banc **en clair** fait rendre « Failed to fetch » à tout `fetch` partant de la page — `connect-src 'self' https:` | le banc du poste est servi en HTTPS, donc il satisfait `https:` ; l'écart ne se voit que sur une autre origine en HTTP |
| pygeoapi complète les microsecondes à six chiffres (`…711140`), PostgREST sert la forme canonique (`…71114`)         | ~1 ligne sur 10, et la ligne échantillonnée ici n'en était pas une. **Il a fallu un second couple de serveurs.**       |

Le troisième a corrigé le **contrat** : ce qui compte n'est pas que les deux textes soient égaux,
c'est que le marqueur servi par la lecture **sélectionne** la ligne à l'écriture. Il le fait,
parce que PostgREST transtype au lieu de comparer des chaînes (§2.3 de `SERVER_CONTRACT.md`).

⚠️ Le premier a aussi appris ceci : **nginx résout ses upstreams au DÉMARRAGE**. Avec un upstream
littéral, la passerelle sortait `[emerg] host not found in upstream` — elle démarre plus vite que
ce qu'elle sert, et `depends_on` n'attend pas leur DNS. D'où le `resolver` et le `proxy_pass` par
variable de `docker/ci/nginx.conf`.

---

## Le delta — deux faces sur une table (20/09/2026)

`offline.source.delta` demande au serveur **ce qui a changé depuis un instant, suppressions
comprises**. Le banc ne savait pas le dire : ni colonne de suppression, ni `time_field`. Il le sait
depuis le 20/09/2026, et la forme retenue n'est pas un détail de montage.

| Face                            | Ce qu'elle sert                      | Qui la lit                                        |
| ------------------------------- | ------------------------------------ | ------------------------------------------------- |
| `api.sites_rosario` (table)     | l'écriture du dialecte `collection`  | PostgREST, `/sites_rosario`                       |
| `api.sites_rosario_live` (vue)  | les lignes vivantes **seulement**    | collection pygeoapi `sites_rosario`               |
| `api.sites_rosario_delta` (vue) | tout, pierres tombales **comprises** | collection `sites_rosario_delta`, et son écriture |

🛑 **Deux collections et non un drapeau sur une seule.** Un client qui ne déclare pas de
`deletedProperty` ne consulte jamais de pierre tombale : lui en servir une la lui ferait stocker
comme une entité **vivante**. La face du complet ne doit donc jamais en porter.

🛑 **`time_field: updated_at` est la garantie 1 du §1.3 rendue exécutable.** OGC API Features laisse
le serveur choisir sur quelle propriété temporelle `datetime` s'applique ; le contrat exige que ce
soit le marqueur de fraîcheur. Mesuré **avant** de le poser : pygeoapi répond **500** à un `datetime`
sur une collection qui n'en déclare pas (`pygeoapi/provider/sql.py`, `time_field not enabled`). Un
échec bruyant, donc le bon — un serveur qui aurait répondu en **ignorant** le filtre aurait servi sa
collection entière à chaque delta, et le rapatriement serait sorti en succès.

### 🛑 La suppression douce doit RENDRE la ligne — mesuré dans les deux sens

C'est la trouvaille de ce montage, et elle est sur le chemin d'**écriture**, pas sur le delta.

| Montage                                        | Réponse de PostgREST au `DELETE` filtré | Ce que §2.2 en lit |
| ---------------------------------------------- | --------------------------------------- | ------------------ |
| `BEFORE DELETE` sur la table, rendant `NULL`   | `200` avec `[]`                         | un **conflit**     |
| `INSTEAD OF DELETE` sur une vue, rendant `OLD` | `200` avec `[ligne]`                    | un **succès**      |

Les deux suppriment correctement. Mais avec le premier, la file relit la ligne, garde la pierre
tombale sur l'appareil **comme une entité vivante**, et renvoie l'écriture sans filtre : la
suppression finit par passer, après un détour qu'on ne distingue pas d'une course. Le contrat ne
disait rien de ce cas ; la clause y est désormais (§2.3 de `SERVER_CONTRACT.md`).

⚠️ **Aucun faux ne pouvait montrer ça.** Il y fallait un vrai serveur câblé des deux façons.

### Re-mesurer

```bash
set -a; . ./.env; set +a
CA=~/dev/infra/traefik/certs/rootCA.pem
# le `next` reporte-t-il `datetime` ? (la clause qui a écarté pg_featureserv, sur le delta)
curl -s -G --cacert $CA "https://$GEOLEAF_DEV_BACKEND_HOST/ogc/collections/sites_rosario_delta/items" \
  --data-urlencode "f=json" --data-urlencode "limit=2" \
  --data-urlencode "datetime=2000-01-01T00:00:00+00:00/.." \
  | python3 -c "import sys,json;print([l['href'] for l in json.load(sys.stdin)['links'] if l['rel']=='next'])"
```

---

## Monter le backend

```bash
docker compose -f docker-compose.dev.yml up -d geoleaf-postgrest geoleaf-featureserv
```

🛑 **Après avoir touché `pygeoapi.config.yml`, RECRÉER — ne pas `docker restart`.** Mesuré le
20/09/2026, trois fois de suite : `docker restart geoleaf-featureserv` rend `Exited (127)`, sans une
ligne de log du nouveau démarrage, tandis que la commande ci-dessus repart proprement. Le symptôme
est traître — le conteneur est mort, la sonde du `beforeAll` répond `404`, et `e2e/31` se **saute**
au lieu de rougir : on lit « la mutation n'a rien cassé » là où rien n'a été joué.

Prérequis, tous déjà en place sur la machine de dev :

- `shared-postgis-1` et `shared-traefik-1` démarrés (`~/dev/infra/shared/compose.yml`) ;
- l'hôte de `GEOLEAF_DEV_BACKEND_HOST` dans le fichier hosts **Windows** (WSL lit le DNS de Windows) ;
- son certificat et son entrée TLS, dans `~/dev/infra/traefik/dynamic/` ;
- un `.env` à la racine du dépôt (git-ignoré) portant `GEOLEAF_PG_PASSWORD`, `GEOLEAF_JWT_SECRET`
  **et `GEOLEAF_DEV_BACKEND_HOST`** — sans ce dernier, `docker compose` refuse de démarrer en le
  nommant, ce qui est le comportement voulu.

### Base et graine

Les deux commandes ci-dessous prennent le rôle Postgres en variable : `PGROLE` est le rôle
propriétaire de **votre** conteneur PostGIS partagé, et il n'est pas déduit du dépôt. Posez-le
d'abord — `docker exec shared-postgis-1 psql -U postgres -c '\du'` le liste si vous l'ignorez.

```bash
docker exec -i -e PGOPTIONS="-c geoleaf.auth_password=$(grep -oP '(?<=^GEOLEAF_PG_PASSWORD=).*' .env)" shared-postgis-1 psql -U "$PGROLE" -d geoleaf -v ON_ERROR_STOP=1 < docker/backend/01-schema.sql
```

```bash
docker exec -i shared-postgis-1 psql -U "$PGROLE" -d geoleaf -v ON_ERROR_STOP=1 < docker/backend/02-seed.sql
```

La graine est **idempotente** (elle tronque d'abord) et remet l'état reproductible : 27 lignes,
aucune identité cliente.

---

## Le spec qui s'appuie dessus

`e2e/30-sync-cycle.spec.js` — joué avec **le connector actif**, contre ce backend :

```bash
E2E_TARGET=nginx npx playwright test e2e/30-sync-cycle.spec.js
```

✅ **Il prouve le parcours complet depuis le 19/09/2026**, et plus aucun `test.fixme` n'y subsiste :
rapatriement, coupure, édition, retour du réseau, drain de lui-même, rechargement, identité serveur
réconciliée, et une seconde synchronisation qui ne produit aucune requête. ⚠️ **Ce paragraphe a dit
le contraire — « deux `test.fixme` nommés » — jusqu'au 20/09/2026** : les tâches qu'il citait ont été
livrées sous une autre numérotation, et le fichier n'avait pas suivi. Un README qui décrit un spec
ne se relit pas de mémoire.

🛑 **Le spec se saute intégralement quand ce backend ne répond pas** — le cas d'un runner
GitHub — mais il le fait **bruyamment** : un test témoin, hors de portée du saut, s'exécute
quand même et asserte que le motif du saut est nommé. Vérifié dans les deux états, conteneurs
arrêtés puis rallumés. ⚠️ **La première rédaction ratait ça** : le `beforeEach` sautait aussi le
témoin, et le fichier sortait « 9 skipped » sans qu'une ligne ne dise pourquoi — le silence
même que le témoin existe pour empêcher, dans le mécanisme censé l'empêcher.

⚠️ **Le spec écrit dans cette base.** Il préfixe ses identités clientes par `e2e30-` et les
supprime en `afterAll`, y compris après un échec en cours de route : sans ça, une exécution
répétée ferait grossir la table et le décompte de pagination (27, 3 pages) cesserait d'être
vrai — un test qui casse le test d'à côté.

---

## Les quatre propriétés que le cycle exige, et comment les re-mesurer

Toutes vérifiées au montage. `$CA` vaut `~/dev/infra/traefik/certs/rootCA.pem` — curl ne connaît pas
la CA mkcert, seul le navigateur la connaît ; sans `--cacert` toute commande ci-dessous rend
`HTTP 000`, ce qui ressemble à « le service est mort » et n'est que « curl ne fait pas confiance ».

**① Pagination par lien `next`** (4.1) — 3 pages, 27 features :

```bash
curl -s --cacert ~/dev/infra/traefik/certs/rootCA.pem "https://$GEOLEAF_DEV_BACKEND_HOST/ogc/collections/sites_rosario/items?f=json&limit=10" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['numberMatched'],[l['rel'] for l in d['links']])"
```

**② Le rapatriement ne confère PAS l'écriture** (invariant S6) — doit rendre **401** :

```bash
curl -s --cacert ~/dev/infra/traefik/certs/rootCA.pem -o /dev/null -w "%{http_code}\n" -X POST "https://$GEOLEAF_DEV_BACKEND_HOST/sites_rosario" -H "Content-Type: application/json" -d '{"title":"intrus","geom":"SRID=4326;POINT(-60.6 -32.9)"}'
```

**③ Le push rend l'identifiant serveur** (4.5) — **201**, et la réponse porte `id` :

```bash
curl -s --cacert ~/dev/infra/traefik/certs/rootCA.pem -X POST "https://$GEOLEAF_DEV_BACKEND_HOST/sites_rosario" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"local_id":"loc-demo-1","title":"Saisie","geom":"SRID=4326;POINT(-60.65 -32.94)"}'
```

**④ Le rejeu est idempotent** (4.5) — le même `local_id` rend **409** (`23505`), et la table garde
**une seule** ligne. C'est la contrainte `UNIQUE` qui le tient, pas une convention d'appelant.

Et le marqueur de version (4.6) bouge à chaque `UPDATE` **sans que le client puisse le forger** :
une tentative de poser `updated_at` à `2000-01-01` est écrasée par le trigger. Un marqueur de
fraîcheur que l'écrivain contrôle ne détecte rien.

---

## Rôles, et pourquoi il y en a quatre

| Rôle             | Login | Peut                          | Pour                |
| ---------------- | ----- | ----------------------------- | ------------------- |
| `geoleaf_anon`   | non   | `SELECT`                      | requête sans token  |
| `geoleaf_editor` | non   | `SELECT/INSERT/UPDATE/DELETE` | claim `role` du JWT |
| `geoleaf_auth`   | oui   | **rien en propre**            | connexion PostgREST |
| `geoleaf_ogc`    | oui   | `SELECT`                      | connexion pygeoapi  |

`geoleaf_auth` est `NOINHERIT` **délibérément** : il ne détient aucun privilège et ne peut atteindre
que ce dans quoi le claim `role` d'un JWT l'autorise à `SET ROLE`. Un jeton sans rôle retombe donc
sur `geoleaf_anon`, jamais sur l'écriture — c'est l'invariant S6 tenu côté SQL.

🛑 **`geoleaf_ogc` existe à cause de ce `NOINHERIT`.** Un serveur OGC interroge **comme son rôle de
connexion** et ne fait pas de `SET ROLE` par requête, contrairement à PostgREST. Pointé sur
`geoleaf_auth`, pg_featureserv servait `"collections": []` — ce qui se lit comme une erreur de
configuration et n'était qu'une question de privilèges.

---

## Le jeton de dev

`apps/geoleaf-app/connector.local.js` (git-ignoré) porte un JWT `HS256`, claim
`role: geoleaf_editor`, 30 jours. Il est signé avec `GEOLEAF_JWT_SECRET` du `.env` racine.

⚠️ **Régénérer les deux ensemble.** Un jeton signé contre un secret périmé échoue en **401**, ce qui
ressemble à un défaut de routage et n'en est pas un.

```bash
python3 -c "
import hmac,hashlib,base64,json,re,time
s=re.search(r'^GEOLEAF_JWT_SECRET=(.+)$',open('.env').read(),re.M).group(1).strip()
b=lambda o: base64.urlsafe_b64encode(json.dumps(o,separators=(',',':')).encode()).rstrip(b'=')
h,p=b({'alg':'HS256','typ':'JWT'}),b({'role':'geoleaf_editor','exp':int(time.time())+30*86400})
print((h+b'.'+p+b'.'+base64.urlsafe_b64encode(hmac.new(s.encode(),h+b'.'+p,hashlib.sha256).digest()).rstrip(b'=')).decode())"
```

---

## Ce que ce montage ne fait PAS

- **Il ne parle à aucun backend métier réel.** La cible en production est un backend métier SIG
  atteint via OGC ou par son API ; ceci en est un substitut fidèle au **dialecte** (`collection`,
  corps plat, bearer) et au **cycle**, pas au serveur. Un défaut propre à ce backend-là — le champ
  d'horodatage qu'il expose comme marqueur de synchronisation, sa façon de découper les
  collections par modèle métier — ne se verra pas ici. **C'est la limite qui compte le plus de ce
  montage** : il prouve que le cycle tient, jamais que l'intégration tient.
- **Il ne sert aucune tuile.** A7′ reste un sujet de cache, sans rapport avec ce backend.
- **Il ne parle à aucun backend métier réel** (déjà dit plus haut, et c'est sa limite principale).

⚠️ **« Il n'est pas dans la CI » a cessé d'être vrai le 20/09/2026.** Voir ci-dessous.
