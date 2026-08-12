# RFC-003 — Périmètre d'origine d'un plugin, et solde du champ `type` dans INV-REG

**Statut :** Acceptée → Appliquée
**Date :** 8 août 2026
**Auteur :** Mattieu Pottier
**Cible :** [`PLUGIN_ARCHITECTURE_SPEC.md`](../contrats/PLUGIN_ARCHITECTURE_SPEC.md) §0 (Portée — sous-section neuve), §3 (tableau des invariants, ligne `INV-REG`)
**Contrat :** Plugin Contract v1 — changement **non cassant** (une exigence morte retirée, un périmètre explicité) → spec **1.4.1 → 1.5.0**

---

## Contexte

Deux points sans rapport de fond, réunis parce qu'ils exigent la même autorisation : éditer la
Partie I figée (§10). Aucun des deux n'ajoute d'obligation à un plugin conforme.

Le pré-vol de cette RFC a **infirmé un tiers de son énoncé d'origine** (tâche 10.5 de
`roadmap_socle-init.md`), et les écarts sont consignés au §Pré-vol ci-dessous plutôt que corrigés
en silence.

---

## ① `INV-REG` exige encore `type`, que RFC-002 a supprimé

**RFC-002** (19/07/2026) a retiré le champ de manifeste `type` : du contrat d'enregistrement §4,
de la règle `PC-03`, des types du core, des 13 `entry.ts` et du gabarit. Sa ligne **Cible**
nomme « §1 (vocabulaire), §4 (contrat d'enregistrement), §7 ».

Elle ne nomme pas le **tableau des invariants**, et c'est là que le champ a survécu. `INV-REG`
dit aujourd'hui :

> `meta` **DOIT** porter `version`, `type`, `label`, `healthCheck`

Or `PluginMetadata` (`packages/core/src/kernel/api/api-types.ts`) n'a **plus** de champ `type` —
mesuré : `version`, `requires`, `optional`, `label`, `healthCheck`, tous optionnels.

⚠️ **Le défaut est plus net qu'un oubli de portée : l'invariant contredit son propre exemple.**
L'exemple canonique du §4, dans le **même document**, passe `version`, `label`, `requires`,
`optional`, `healthCheck` — et pas `type`. Un lecteur qui applique le tableau produit un manifeste
que l'exemple dément, et réciproquement.

**Changement :** retirer `type` de l'énumération de `INV-REG`. Rien d'autre sur cette ligne.

---

## ② Le chargement d'un plugin depuis une origine tierce, AU RUNTIME, est hors contrat

La question « et si les plugins fonctionnaient comme un marketplace ? » a été posée le
29/07/2026 et **entièrement instruite**. La réponse fut non. Cette instruction ne vit aujourd'hui
que dans une **ligne de révision de roadmap** — donc nulle part où un lecteur du contrat la
trouve, et la question se ré-instruit de zéro à chaque fois qu'elle revient.

**Les quatre motifs, chacun vérifié sur le code :**

1. **Aucun sandbox, et l'autorité est totale.** `INV-NS` donne au plugin l'accès au cœur
   « exclusivement via `globalThis.GeoLeaf.*` » — c'est-à-dire **tout** `GeoLeaf.*`, dont
   `Storage` et les jetons du Connector. Un plugin d'origine tierce hérite de la même autorité
   qu'un plugin du dépôt, sans frontière d'aucune sorte.
2. **SRI est inapplicable.** L'intégrité de sous-ressource se déclare sur une balise
   (`<script integrity>`), pas sur un `import()` dynamique — le mécanisme par lequel les plugins
   paresseux se chargent. Il n'existe donc aucun moyen de figer l'empreinte d'un bundle tiers.
3. **Le registre n'a aucune notion d'origine.** `registerLazy(name, resolver)` prend un
   `LazyResolver`, et ce type vaut `() => Promise<void>` (`packages/core/src/kernel/api/api-types.ts`) : une **closure**,
   jamais une URL. Il n'existe aucun point du registre où une origine pourrait être déclarée,
   vérifiée ou refusée. Ce n'est pas une lacune d'implémentation, c'est la forme du contrat.
4. **Le coût est net et mesurable.** Un descripteur récupéré au runtime ajoute **une requête
   sérialisée par plugin avant `boot()`**, là où un descripteur de build ne coûte aucune E/S.

**Et le dépôt va déjà dans la direction inverse, sprint après sprint** : les tâches 5.3/5.4 ont
retiré `unpkg.com` du déployé et 5.5 a resserré la CSP. Autoriser une origine tierce au runtime
contredirait un travail livré.

**Changement :** une sous-section « Chargement depuis une origine tierce (hors contrat) » au §0,
sœur de la sous-section « Bibliothèques partagées internes (hors contrat) » qui existe déjà.
C'est une **clarification de périmètre**, pas un invariant neuf : elle ne restreint aucun plugin
conforme, elle nomme ce que le contrat ne couvre pas.

⚠️ **Ce qui n'est PAS interdit, et doit se lire comme tel** : l'installation d'un plugin tiers
reste possible — c'est un **acte de build**, servi ensuite depuis `'self'`. C'est la voie que
décrit la ligne B.1 du backlog de `roadmap_socle-init.md` (CLI `geoleaf plugin add`), avec un
lockfile comme substitut build-time à SRI.

---

## ③ Correction factuelle mineure — `addpoi` n'existe plus

La sous-section « Bibliothèques partagées internes » liste `@geoleaf/field-renderer` comme
« consommée par `editor` et `addpoi` ». Le plugin `addpoi` a **fusionné dans `editor`** au
Sprint 5 (05/08/2026) ; il n'y a plus qu'un consommateur nommé.

Trouvé au pré-vol de cette RFC, corrigé ici parce qu'une RFC acceptée est la seule occasion
d'éditer cette partie — l'annoter aurait ajouté une troisième phrase là où une correction d'un
mot suffit.

---

## Pré-vol — un tiers de l'énoncé d'origine était faux

La tâche 10.5 annonçait **trois** gestes de ménage. La mesure en laisse **un**.

| Énoncé de 10.5                                                           | Mesure du 08/08/2026                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| « retirer `type` de la ligne INV-REG (`:117`) »                          | ✅ **Vrai, mal localisé** — `INV-REG` est en **`:126`**. La ligne 117 est vide.                                                                                                                                                                                                                                       |
| « corriger 2 chemins morts (`:151`, `:403` citent `modules/built-in/`) » | 🛑 **SANS OBJET — déjà corrigés le 27/07/2026**, et la correction est tracée dans le journal des versions de la spec elle-même (v1.4.1). `:151` parle de dépendances npm, `:403` est un en-tête. **Mode d'échec n° 4** : le travail avait été fait entre-temps, et il se voyait en relisant le document, pas le code. |
| « consigner le hors-contrat du chargement tiers »                        | ✅ **Vrai** — aucune trace dans `specs/`, et la seule occurrence de « marketplace » dans tout l'atelier interne du dépôt de travail est une ligne d'un CDC **archivé**.                                                                                                                                               |

⚠️ **Deux citations de code de l'énoncé étaient également décalées** : `registerLazy` ne vit pas
là où `:80` le plaçait — c'est `register()` qui s'y trouve —, et le fait qui compte est ailleurs
encore, dans le **type** qui porte l'argument : `LazyResolver`, déclaré par `packages/core/src/kernel/api/api-types.ts`.

> 🛑 **Annotation du 11/08/2026 (tâche 6.11) — cette correction s'était périmée à son tour, et
> c'est la démonstration la plus courte de la classe qu'elle instruit.** Elle écrivait
> « `registerLazy` est en `plugin-registry.ts:87` » ; au 11/08 la déclaration est en **`:88`**,
> `:87` étant le `*/` fermant du bloc TSDoc au-dessus. **Une ligne ajoutée dans un commentaire
> a suffi** — et rien, dans aucune des 78 gates d'alors, ne pouvait le dire. Les deux citations
> sont donc réécrites **par membre**, sans numéro : ce que l'énoncé de 10.5 ratait n'était pas
> un numéro, c'était l'endroit. C'est ce constat qui a fait poser la gate **SPECS-PATHS**
> (`audit-report-freshness.cjs --source specs`), laquelle garde le **fichier** ; le numéro de
> ligne, lui, n'est gardable par rien, et la seule réponse est de ne pas l'écrire.

---

## Pourquoi non cassant

- **①** retire une exigence. Aucun plugin conforme ne cesse de l'être en cessant de devoir
  déclarer un champ que le type n'accepte plus. `PC-03` avait déjà été allégée par RFC-002 :
  aucun vérificateur ne change ici, c'est le texte qui rejoint le code.
- **②** ne contraint aucun plugin. Elle nomme un périmètre que rien n'implémente : il n'existe,
  à la date de cette RFC, aucun mécanisme de chargement par origine à retirer.
- **③** est une correction de fait sur une liste informative.

---

## Alternatives écartées

- **Annoter plutôt qu'éditer** (le régime appliqué le 27/07/2026 pour six énoncés faux). Justifié
  quand aucune RFC n'est ouverte — annoter n'exige pas d'autorisation. Ici l'autorisation existe,
  et une annotation sous une ligne d'invariant laisserait l'invariant faux, en obligeant chaque
  lecteur à lire les deux.
- **Interdire explicitement l'origine tierce par un invariant `INV-ORIGIN`.** Écarté : un
  invariant énonce une obligation **vérifiable** sur un plugin. Il n'y a rien à vérifier — le
  registre n'a pas de notion d'origine, donc aucune gate ne pourrait porter cet invariant, et il
  serait né invérifiable. Une clarification de périmètre dit la même chose sans promettre une
  garde qui ne peut pas exister.
- **Ouvrir le sujet marketplace en le bornant** (allowlist d'origines, sandbox iframe). Hors
  périmètre : c'est une fonctionnalité, pas une clarification. Elle exigerait sa propre RFC, et
  les quatre motifs du §② en sont l'instruction préalable.

---

## Impact

- **Spec** : §0 (une sous-section neuve, une correction d'un mot), §3 (un mot retiré de
  `INV-REG`), journal des versions **1.4.1 → 1.5.0**.
- **Vérificateurs** : aucun. `PC-03` n'exige plus `type` depuis RFC-002.
- **Code** : aucun. `PluginMetadata` est déjà dans l'état que le texte rejoint.
- **Tests** : aucun.

---

## Décision

**Acceptée** le 2026-08-08 (Mattieu Pottier — validation du plan de préparation du Sprint 10, qui
porte explicitement ces gestes). **Appliquée** dans le même changement : spec **1.4.1 → 1.5.0**,
journal §10 mis à jour.
