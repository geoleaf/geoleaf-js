# RFC-004 — Cinq apports natifs de MapLibre 6 face au code maison

**Statut :** Acceptée → Arbitrée (aucune migration engagée)
**Date :** 26 août 2026
**Auteur :** Mattieu Pottier
**Cible :** `packages/core/src/adapters/maplibre/` · `packages/core/src/capabilities/cluster/` · `packages/core/src/kernel/basemaps/`
**Contrat :** aucun changement de contrat — cette RFC **décide**, elle ne modifie rien.

---

## Contexte

Un inventaire daté du 08/08/2026 relevait cinq API de MapLibre GL JS recouvrant du travail que ce
dépôt fait à la main, et concluait « rien ici n'est engagé ». Il n'avait aucun domicile : versé au
registre de backlog le 26/08, il en sort ici, arbitré piste par piste.

⚠️ **L'inventaire se datait « moteur 6.2.0 », et le dépôt en installe une autre.** La version
courante se mesure, elle ne se recopie pas :

```bash
npm ls maplibre-gl
```

Les apports des versions intermédiaires n'avaient **jamais** été inventoriés. Ils le sont
ci-dessous, par comparaison des déclarations de types publiées — la seule méthode qui ne dépende
pas d'un journal de version que ce paquet ne publie pas.

## Ce que les versions non inventoriées ont apporté

Relevé par diff des `.d.ts` entre la version de l'inventaire et celle installée : **une classe
publique neuve, `PatternAtlas`**, et une vingtaine de membres dont trois familles pèsent sur les
pistes ci-dessous —

- **rendu WebGL d'images** : `renderWithWebGL`, `patternAtlas`, `isWebGLImage`,
  `needsFirstWebGLRender`, `getMesh`, `getWarp` / `setWarp`, `imageWarp` ;
- **sprites par lot** : `setSpriteImages`, `removeSpriteImages`, `removeAllSpriteImages` ;
- **gestes sur terrain** : `aroundOnSurface`, `aroundElevation`,
  `screenPointToLocationAtElevation`.

📌 **Ce relevé change le verdict d'une piste au moins** : `renderWithWebGL` et `PatternAtlas` sont
arrivés **dans la fenêtre non inventoriée**. L'inventaire d'origine les citait sans savoir qu'ils
étaient neufs, donc sans pouvoir dire qu'ils sont encore peu éprouvés en aval.

**Les cinq API restent absentes du code.** Se re-mesure, ne se recopie pas :

```bash
grep -rn 'renderWithWebGL\|setMissingStyleImageResolver\|getClusterOptions\|terrainSkirtLength\|fill-layer-opacity' packages/
```

---

## Méthode d'arbitrage

Chaque piste est jugée sur **trois** questions, dans cet ordre — et la deuxième est celle qui
tranche le plus souvent, parce que c'est celle qu'un inventaire d'API ne pose jamais :

1. **La cible existe-t-elle ?** Le code maison décrit est-il encore là, sous cette forme ?
2. **Le motif tient-il ?** La contrainte qui a fait écrire ce code maison est-elle encore vraie —
   et l'API native répond-elle bien à la MÊME question ?
3. **Le remplacement est-il éprouvable ?** Quelle épreuve dirait que la migration est réussie ?
   Une piste dont la réussite ne se constate pas se juge sur une impression.

---

## Piste ① — Motifs de hachures rendus en canvas 2D CPU

**Cible :** `packages/core/src/adapters/maplibre/maplibre-hatch-patterns.ts` — un module dédié qui
génère six familles de hachures en `ImageData`, puis les enregistre par `map.addImage()` pour
alimenter `fill-pattern`. **La cible existe**, et son en-tête dit qu'elle a déjà remplacé une
approche SVG antérieure.

**Le motif tient**, et c'est le seul cas des cinq : `PatternAtlas` et `renderWithWebGL` font
nativement, sur le GPU, ce que ce module fait sur le CPU au chargement du style.

**L'épreuve manque, et c'est ce qui décide.** Le résultat d'une hachure est **visuel**, et aucune
gate de ce dépôt ne juge un rendu : ni `ci:local`, ni la suite E2E, qui vérifie des états du DOM et
non des pixels. Une migration réussie et une migration qui décale les motifs d'un demi-pixel
sortiraient **identiquement vertes**.

> **Verdict — ACCEPTÉE EN DETTE.** Le code maison est conservé, la décision est écrite, et sa
> condition de réouverture est nommée : **une épreuve de rendu comparant les pixels avant/après**.
> Tant qu'elle n'existe pas, la migration ne peut pas être déclarée réussie, seulement espérée.
> ⚠️ L'API étant arrivée dans la fenêtre non inventoriée, elle est aussi la moins éprouvée en aval
> des cinq — deuxième raison d'attendre, indépendante de la première.

## Piste ② — Rastérisation ANTICIPÉE des icônes de taxonomie

**Cible :** `packages/core/src/adapters/maplibre/maplibre-poi-icons.ts` — il convertit **chaque**
`<symbol>` du sprite de profil en `ImageData` par canvas 2D, puis appelle `map.addImage()`.

**Le motif se partage en deux, et l'inventaire les confondait.** L'en-tête du module dit pourquoi
le canvas est utilisé : charger le SVG comme `<img>` est peu fiable dans Chrome pour les SVG en
trait seul, et tombe sous la politique `img-src`. **Ce motif-là reste entier** — et
`setMissingStyleImageResolver` ne le touche pas : il ne change pas **comment** on rastérise, il
change **quand**. La piste porte donc sur l'anticipation, jamais sur le canvas.

**L'épreuve manque, mais elle est facile à définir** — et son absence est le vrai constat : personne
n'a jamais mesuré ce que la passe anticipée coûte au boot. Sans ce chiffre, on ne sait pas si le
paresseux gagne des millisecondes ou une seconde, ni sur quel profil.

> **Verdict — ACCEPTÉE EN DETTE.** Condition de réouverture nommée : **une mesure du coût de la
> passe anticipée au boot**, par profil. Si elle est négligeable, la piste se ferme définitivement ;
> si elle ne l'est pas, elle devient chiffrée au lieu d'être supposée. Le premier livrable est le
> nombre, pas la migration.

## Piste ③ — Opacité par couche simulée dans chaque propriété de paint

**La cible N'EXISTE PAS.** Le balayage ne trouve aucune propagation d'une alpha de couche dans les
propriétés de paint MapLibre. Ce que le dépôt fait avec l'opacité est d'une autre nature :
`maplibre-style-converter.ts` **traduit** des propriétés de style déclarées une à une
(`fillOpacity` → `fill-opacity`, `opacity` → `line-opacity`), et `capabilities/taxonomy/marker-paint.ts`
pose `circle-opacity: 0` dans un cas nommé — masquer le disque d'une icône nue. Aucun des deux ne
simule une opacité de couche.

> **Verdict — PISTE RETIRÉE.** C'est le **mode d'échec n° 3** du pré-vol : l'énoncé décrivait un
> mécanisme qui n'est plus, ou n'a jamais été, sous cette forme. `fill-layer-opacity` reste sans
> emploi ici — non parce qu'on renonce, mais parce qu'il n'y a rien à remplacer.

## Piste ④ — État de clustering redéduit du profil au lieu d'être relu sur la source

**La cible existe** — `capabilities/cluster/strategy.ts`, `getClusteringStrategy()` — mais **la
prémisse est inversée**, et c'est le cœur de l'arbitrage.

Cette fonction ne relit pas un état que le moteur détiendrait : elle rend une **décision de
politique** que le moteur n'a jamais eue. Elle combine la configuration de capacité, l'éventuelle
surcharge par couche, une sonde sur la présence de géométries `Point` dans la donnée, et une
stratégie par défaut, pour répondre à « **faut-il** clusteriser cette couche, et en partageant la
source ou non ? ». `getClusterOptions()` répond à une autre question — « avec quelles options cette
source a-t-elle été créée ? » — dont la réponse **descend** de la première.

Lire l'aval pour retrouver l'amont serait un aller-retour, pas une simplification.

> **Verdict — ACCEPTÉE EN DETTE, prémisse requalifiée.** Un seul cas ferait diverger les deux : une
> configuration modifiée **après** la création de la source. Il vaut d'être connu et il est écrit
> ici ; il ne justifie pas de renverser le sens de lecture.

## Piste ⑤ — Artefact visuel de terrain sur fond transparent

**La cible est vide et le motif est invérifiable.** `kernel/basemaps/terrain.ts` ne mentionne aucun
réglage de jupe, et `terrainSkirtLength` n'apparaît nulle part — ce qui est cohérent avec l'énoncé,
qui décrivait un **symptôme** (un artefact au rendu) et non du code.

Or un symptôme visuel qu'on ne sait pas reproduire ne se corrige pas : on ne saurait pas dire que
c'est fait. C'est le **mode d'échec n° 5** — un verdict invérifiable ne se périme pas, il se
fossilise.

> **Verdict — ACCEPTÉE EN DETTE.** Condition de réouverture nommée : **une reproduction** — un
> profil, un fond, une capture. Avec elle, le réglage se pose en une ligne et se vérifie ; sans
> elle, poser le réglage revient à modifier un rendu qu'on n'a pas vu.

---

## Ce que cette RFC décide, en une ligne

**Une piste retirée pour absence de sujet, quatre acceptées en dette avec leur condition de
réouverture écrite.** Aucune migration n'est engagée, et c'est le résultat de la méthode, pas un
renoncement : sur les cinq, **une seule avait encore sa cible ET son motif ET une épreuve
concevable** — la ①, dont l'épreuve reste à construire.

📌 **Le constat de méthode vaut d'être gardé.** Un inventaire d'API est fait pour dire _ce que le
moteur sait faire_ ; il ne dit ni si le code maison correspondant existe encore, ni si la contrainte
qui l'a fait écrire est tombée, ni comment on saurait que le remplacement a réussi. Les trois se
vérifient séparément, et deux pistes sur cinq sont tombées sur la première question.

## Renvois

- Les quatre lignes de dette ouvertes par cette RFC vivent dans le registre de dette technique de
  l'atelier, chacune avec la condition écrite ci-dessus.
- La doctrine de placement d'une fonctionnalité neuve : [`CDC_kernel.md`](../CDC_kernel.md)
  §Dépendances et frontières.
