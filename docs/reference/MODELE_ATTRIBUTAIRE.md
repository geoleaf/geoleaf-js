# Modèle attributaire des profils — vue dérivée

> 🛑 **GÉNÉRÉ — ne pas éditer à la main.** Régénérer par `npm run gen:attributes-report`.
> Gaté par `gen:attributes-report:check` dans `npm run ci:local` : une édition manuelle,
> ou un profil modifié sans régénération, fait rougir la CI.

C'est la **lisibilité en tableau plat** que la décision **Q1** a refusé de satisfaire par un
fichier de configuration global — un `attributes.json` par profil aurait pu pointer une couche
supprimée, et la garde d'écriture **A14** y serait redevenue un script maison au lieu d'une règle
de schéma pure. Le besoin de LECTURE est réel ; il se sert par une vue dérivée, qui ne peut pas
diverger de sa source.

## Comment lire ce tableau

- **`I B P`** — les trois surfaces de lecture : **I**nfobulle, **B**ulle, **P**anneau. Un `·`
  signifie que le champ n'y apparaît pas.
- **★** marque le champ désigné par `attributes.titleField` de sa couche.
- **`primitive`** dit ce que la valeur **EST** dans le GeoJSON ; **`widget`** dit comment on la
  montre. Le couple est contraint par une liste blanche que `validate:profiles` oppose au build.
- ⚠️ Une colonne **`uses`** a figuré ici du 02/08 au 06/08/2026 — bloc de liaisons vers les
  sous-systèmes secondaires, **retiré** parce qu'il ajoutait une 4ᵉ liste de noms de champs sans en
  remplacer aucune (décision **A3‴**).

## Décompte

| Mesure | Valeur |
| --- | --- |
| Couches portant un bloc `attributes` | 18 |
| Champs déclarés | 87 |
| Couches **non migrées** (bloc legacy restant) | 0 |
| Couches sans aucune déclaration de lecture | 6 |

✅ **Aucune couche ne reste sur le bloc legacy.** Le compteur de migration de la tâche 2.10 est à zéro.

⚠️ Les couches sans aucune déclaration n'ont **rien à migrer** : elles n'entrent jamais dans le
chemin de rendu, et le retrait du mode `"all"` ne les touche donc pas.

## Le tableau

| Profil | Couche | Champ | Libellé | primitive | widget | I B P | mode | présentation | edit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _reference | reference-points | `name ★` | Nom | `string` | `text` | `T P S` | rendered | — | requis |
| _reference | reference-points | `categoryId` | Catégorie | `string` | `text` | `· P S` | rendered | — | — |
| reunion-eclairage | armoires | `properties.id ★` | id | `string` | `text` | `T P S` | rendered | title | — |
| reunion-eclairage | armoires | `properties.secteur` | Secteur | `string` | `text` | `· P S` | rendered | — | — |
| reunion-eclairage | armoires | `properties.puissance_kw` | Puissance totale (kW) | `string` | `text` | `· P S` | rendered | — | — |
| reunion-eclairage | candelabres | `properties.id ★` | Identifiant | `string` | `text` | `T P S` | rendered | title | — |
| reunion-eclairage | candelabres | `properties.secteur` | Secteur | `string` | `text` | `· P ·` | rendered | — | — |
| reunion-eclairage | candelabres | `properties.altitude` | Altitude (m) | `string` | `text` | `· P ·` | rendered | — | — |
| reunion-eclairage | candelabres | `properties.puissance_w` | Puissance (W) | `string` | `text` | `· P ·` | rendered | — | — |
| reunion-eclairage | candelabres | `properties.statut` | Statut | `string` | `badge` | `· P S` | rendered | category | — |
| reunion-eclairage | candelabres | `attributes.short_desc` | Description | `string` | `longtext` | `· P S` | rendered | accordéon+ | — |
| reunion-eclairage | candelabres | `attributes.photo` | Photo | `string` | `image` | `· · S` | rendered | hero | — |
| reunion-eclairage | candelabres | `attributes.informations` | Caractéristiques techniques | `string[]` | `list` | `· · S` | rendered | accordéon | — |
| reunion-eclairage | candelabres | `attributes.highlights` | Observations | `string[]` | `list` | `· · S` | rendered | accordéon | — |
| reunion-eclairage | candelabres | `attributes.link_official` | Documentation technique | `string` | `link` | `· · S` | rendered | — | — |
| reunion-eclairage | candelabres | `attributes.tags` | Tags | `string[]` | `tags` | `· · S` | rendered | — | — |
| reunion-eclairage | communes_reunion | `properties.nom_officiel ★` | nom_officiel | `string` | `text` | `T P S` | rendered | — | — |
| reunion-eclairage | secteurs_eclairage | `properties.nom ★` | nom | `string` | `text` | `T P S` | rendered | title | — |
| reunion-eclairage | secteurs_eclairage | `properties.nb_candelabres` | Nb candélabres | `string` | `text` | `· P S` | rendered | — | — |
| reunion-eclairage | secteurs_eclairage | `properties.puissance_kw` | Puissance totale (kW) | `string` | `text` | `· P S` | rendered | — | — |
| tourism | aires_protegees_nationales_sib | `properties.Name ★` | Nom | `string` | `text` | `T P S` | rendered | title | — |
| tourism | aires_protegees_nationales_sib | `attributes.photo` | Image principale | `string` | `image` | `· P S` | rendered | hero | — |
| tourism | aires_protegees_nationales_sib | `attributes.short_desc` | Résumé | `string` | `longtext` | `· P S` | rendered | accordéon+ | — |
| tourism | aires_protegees_nationales_sib | `attributes.categoryId` | Catégorie | `string` | `badge` | `· P S` | rendered | category | — |
| tourism | aires_protegees_nationales_sib | `attributes.subCategoryId` | Sous-catégorie | `string` | `badge` | `· P S` | rendered | subcategory | — |
| tourism | aires_protegees_nationales_sib | `attributes.informations` | Informations | `string[]` | `list` | `· · S` | rendered | accordéon | — |
| tourism | aires_protegees_nationales_sib | `attributes.highlights` | Points forts | `string[]` | `list` | `· · S` | rendered | accordéon | — |
| tourism | aires_protegees_nationales_sib | `attributes.gallery` | Galerie photos | `string[]` | `gallery` | `· · S` | rendered | accordéon | — |
| tourism | aires_protegees_nationales_sib | `attributes.link_official` | Site officiel | `string` | `link` | `· · S` | rendered | — | — |
| tourism | aires_protegees_nationales_sib | `attributes.link_wikipedia` | Wikipedia | `string` | `link` | `· · S` | rendered | — | — |
| tourism | aires_protegees_nationales_sib | `attributes.tags` | Tags | `string[]` | `tags` | `· · S` | rendered | — | — |
| tourism | cultures | `properties.NAME` | NAME | `string` | `text` | `T · ·` | rendered | — | — |
| tourism | cultures | `properties.name ★` | Nom | `string` | `text` | `· P S` | rendered | title | — |
| tourism | cultures | `properties.fclass` | Type | `string` | `text` | `· P ·` | rendered | — | — |
| tourism | cultures | `properties.categoryId` | Catégorie | `string` | `badge` | `· P S` | rendered | category | — |
| tourism | cultures | `properties.subcategoryId` | Sous-catégorie | `string` | `badge` | `· P S` | rendered | subcategory | — |
| tourism | cultures | `attributes.reviews.rating` | Note globale | `number` | `rating` | `· P S` | rendered | — | — |
| tourism | cultures | `attributes.photo` | Image principale | `string` | `image` | `· · S` | rendered | hero | — |
| tourism | cultures | `properties.short_desc` | Résumé | `string` | `longtext` | `· · S` | rendered | accordéon+ | — |
| tourism | cultures | `properties.informations` | Informations | `string[]` | `list` | `· · S` | rendered | accordéon | — |
| tourism | cultures | `properties.highlights` | Points forts | `string[]` | `list` | `· · S` | rendered | accordéon | — |
| tourism | cultures | `attributes.gallery` | Galerie photos | `string[]` | `gallery` | `· · S` | rendered | accordéon | — |
| tourism | cultures | `properties.link_official` | Site officiel | `string` | `link` | `· · S` | rendered | — | — |
| tourism | cultures | `properties.link_wikipedia` | Wikipedia | `string` | `link` | `· · S` | rendered | — | — |
| tourism | cultures | `properties.tags` | Tags | `string[]` | `tags` | `· · S` | rendered | — | — |
| tourism | cultures | `attributes.reviews.recent` | Avis récents | `object[]` | `reviews` | `· · S` | rendered | accordéon | — |
| tourism | eco_regions | `properties.ecorregion ★` | ecorregion | `string` | `text` | `T P S` | rendered | — | — |
| tourism | eco_regions_fgb | `properties.ecorregion ★` | ecorregion | `string` | `text` | `T P S` | rendered | — | — |
| tourism | epicentres_seismes | `properties.place ★` | Lieu | `string` | `text` | `T P S` | rendered | — | — |
| tourism | epicentres_seismes | `properties.mag` | Magnitude | `string` | `text` | `T P S` | rendered | — | — |
| tourism | epicentres_seismes | `properties.time` | Date | `string` | `text` | `T P S` | rendered | — | — |
| tourism | hebergements | `properties.name ★` | Nom | `string` | `text` | `T P S` | rendered | title | — |
| tourism | hebergements | `properties.fclass` | Type | `string` | `text` | `· P S` | rendered | — | — |
| tourism | hebergements | `properties.categoryId` | Catégorie | `string` | `text` | `· P S` | rendered | — | — |
| tourism | hebergements | `properties.subcategoryId` | Sous-catégorie | `string` | `text` | `· P S` | rendered | — | — |
| tourism | observations_gbif | `properties.species ★` | Espèce | `string` | `text` | `T P S` | rendered | — | — |
| tourism | observations_gbif | `properties.vernacularName` | Nom vernaculaire | `string` | `text` | `T P S` | rendered | — | — |
| tourism | observations_gbif | `properties.kingdom` | Règne | `string` | `text` | `T P S` | rendered | — | — |
| tourism | observations_gbif | `properties.eventDate` | Date | `string` | `text` | `T P S` | rendered | — | — |
| tourism | parcours | `properties.nom ★` | nom | `string` | `text` | `T P ·` | rendered | title | — |
| tourism | parcours | `properties.type_parcours` | Type | `string` | `badge` | `· P S` | rendered | — | — |
| tourism | parcours | `properties.distance_km` | Distance (km) | `string` | `text` | `· P S` | rendered | — | — |
| tourism | parcours | `properties.difficulte` | Difficulté | `string` | `badge` | `· · S` | rendered | — | — |
| tourism | parcours | `properties.description` | Description | `string` | `longtext` | `· · S` | rendered | — | — |
| tourism | sites_de_conservation_wdpa | `properties.NAME ★` | Nom | `string` | `text` | `T P S` | rendered | title | — |
| tourism | sites_de_conservation_wdpa | `properties.DESIG` | Désignation | `string` | `text` | `· P S` | rendered | — | — |
| tourism | sites_de_conservation_wdpa | `properties.IUCN_CAT` | Catégorie IUCN | `string` | `text` | `· P S` | rendered | — | — |
| tourism | sites_de_conservation_wdpa | `properties.STATUS` | Statut | `string` | `text` | `· P S` | rendered | — | — |
| tourism | sites_de_conservation_wdpa | `properties.STATUS_YR` | Année de désignation | `number` | `number` | `· P S` | rendered | — | — |
| tourism | sites_de_conservation_wdpa | `properties.REP_AREA` | Superficie | `number` | `metric` | `· P S` | rendered | — | — |
| tourism | sites_rosario | `properties.title ★` | title | `string` | `text` | `T P ·` | rendered | title | requis |
| tourism | sites_rosario | `properties.adresse` | Adresse | `string` | `text` | `· P S` | rendered | — | oui |
| tourism | sites_rosario | `properties.statut` | Statut | `string` | `badge` | `· P S` | rendered | — | oui |
| tourism | sites_rosario | `properties.description` | Description courte | `string` | `longtext` | `· · ·` | — | — | oui |
| tourism | sites_rosario | `properties.description_longue` | Description détaillée | `string` | `longtext` | `· · S` | rendered | — | oui |
| tourism | sites_rosario | `properties.services` | Services disponibles | `string[]` | `list` | `· · S` | rendered | — | oui |
| tourism | sites_rosario | `properties.mots_cles` | Mots-clés | `string[]` | `tags` | `· · S` | rendered | — | oui |
| tourism | sites_rosario | `properties.horaires` | Horaires d'ouverture | `object[]` | `table` | `· · S` | rendered | — | oui |
| tourism | sites_rosario | `properties.site_web` | Site web | `string` | `url` | `· · S` | rendered | — | oui |
| tourism | sites_rosario | `properties.photo_principale` | Photo principale | `string` | `image` | `· · S` | rendered | — | oui |
| tourism | sites_rosario | `properties.galerie` | Galerie photos | `string[]` | `gallery` | `· · S` | rendered | — | oui |
| tourism | villes_principales | `properties.ville ★` | ville | `string` | `text` | `T · ·` | rendered | — | — |
| tourism | zones | `properties.nom ★` | nom | `string` | `text` | `T P ·` | rendered | title | — |
| tourism | zones | `properties.categorie` | Catégorie | `string` | `badge` | `· P S` | rendered | — | — |
| tourism | zones | `properties.surface_ha` | Surface (ha) | `string` | `text` | `· P S` | rendered | — | — |
| tourism | zones | `properties.description` | Description | `string` | `longtext` | `· · S` | rendered | — | — |
| tourism | zones_de_conservation_wdpa | `properties.NAME ★` | NAME | `string` | `text` | `T · ·` | rendered | — | — |

---

_Généré par `scripts/gen-attributes-report.cjs`._
