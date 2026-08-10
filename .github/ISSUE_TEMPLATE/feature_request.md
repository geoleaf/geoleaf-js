---
name: Feature request
about: Propose a capability, a plugin, or a configuration parameter
title: ""
labels: enhancement
assignees: ""
---

## Le besoin

<!--
Le problème d'abord, la solution ensuite. Décrire ce qui est impossible ou pénible
aujourd'hui, et dans quel contexte — c'est la partie que personne d'autre ne peut écrire à
votre place.
-->

## Ce qui est fait aujourd'hui à la place

<!--
Le contournement en place, s'il y en a un. Un contournement qui marche déjà change beaucoup
la priorité : il dit que le besoin est réel ET qu'il n'est pas bloquant.
-->

## Où cela vivrait, à votre avis

<!--
Trois couches, et le choix n'est pas neutre pour le poids du bundle :

- **profil JSON** — un paramètre de configuration, aucune ligne de code
- **capacité in-core** — dans `@geoleaf/core`, activée par configuration
- **plugin** — un paquet `@geoleaf-plugins/*` séparé, chargé à la demande

La doctrine de placement du projet est dans `docs/specs/CDC_kernel.md`, §Dépendances et
frontières. Une réponse approximative suffit : la question sert surtout à savoir si la
demande peut être satisfaite sans alourdir le boot de tout le monde.
-->

## Cette proposition casse-t-elle quelque chose ?

- [ ] Non — elle ajoute, sans modifier de comportement existant
- [ ] Oui — elle change un comportement, une signature ou un nom déjà publié

<!--
Une rupture n'est pas rédhibitoire, mais elle appelle une majeure et une période de
dépréciation. Le dire tout de suite évite de le découvrir à la relecture.
-->

## Contexte

<!-- Liens, captures, extraits de profil, projets concernés. -->
