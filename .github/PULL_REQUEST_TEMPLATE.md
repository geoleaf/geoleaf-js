<!--
Le détail du processus est dans CONTRIBUTING.md (§Pull Request process, §Contribution rules).
Ce gabarit ne le redit pas — il ne demande que ce qu'une relecture ne peut PAS retrouver seule.
-->

## Ce que ça change

<!-- Une ou deux phrases. Le « quoi », pas le « comment » : le diff porte déjà le comment. -->

## Pourquoi

<!--
Le problème résolu, et — si le lien existe — le ticket ou la ligne de registre qui le porte.
Un correctif sans motif écrit est indiscernable, six mois plus tard, d'une préférence de style.
-->

Closes #

## Ce qui le prouve

<!--
🛑 La partie qui compte, et la seule qu'un relecteur ne peut pas reconstituer.

Pour une CORRECTION : le test qui a été **vu rougir avant** le correctif, et vert après. Un
test écrit après coup passe toujours — il ne prouve rien du défaut qu'il prétend fermer.

Pour une GARDE ou une règle neuve : la mutation qui l'a fait rougir, et le témoin inverse qui
la laisse verte. Une garde jamais vue rouge ne garde rien : elle peut être vide, mal ciblée,
ou sortir verte en n'ayant rien scanné.

Pour un CHIFFRE annoncé dans la description : la commande qui le rend, pas le chiffre seul.
-->

## Vérification

- [ ] `npm run ci:local` **entièrement vert** — voir le protocole de push de `CONTRIBUTING.md`
      (le quota GitHub Actions est limité : un run distant se mérite par un vert local)
- [ ] `npm run lint` sans avertissement
- [ ] Documentation à jour pour toute API touchée — TSDoc **et** la phrase en prose, pas
      seulement les tags : aucune gate ne peut vérifier qu'une description dit vrai

## Périmètre

- [ ] Aucun `.skip` / `.todo` / `.fixme` ajouté sans un commentaire disant **pourquoi** et
      **quand** il sera réactivé
- [ ] Aucun seuil de couverture abaissé, aucune baseline tamponnée pour faire verdir une gate
- [ ] Aucune règle `security/*`, `no-eval`, `no-implied-eval` ou `no-new-func` abaissée sans
      justification écrite **à côté de la règle**
- [ ] Aucun artefact généré édité à la main (`dist/`, `deploy/`, `docs/api/`, l'arborescence
      qualifiée)

## Rupture d'API

- [ ] Non
- [ ] Oui — décrire ci-dessous ce qui casse, ce qui remplace, et le chemin de migration

<!--
Une rupture appelle une majeure. Si un symbole publié disparaît, dire par quoi il est remplacé :
un consommateur qui découvre la disparition à l'exécution n'a aucun moyen de deviner le nom neuf.
-->
