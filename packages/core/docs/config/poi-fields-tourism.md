---
title: "GeoLeaf – Profil tourism"
---

# GeoLeaf – Profil `tourism`

## Spécification des champs horaires, prix, avis voyageurs

### + Gestion officielle des sections accordéon (UI mobile)

Product Version: GeoLeaf Platform V3
**Date de création**: Décembre 2025
**Dernière vérification**: mars 2026

---

Ce document définit le **format officiel** des champs utilisés par le profil métier `tourism` pour les POI (MyLatinTrip, tourisme général) :

- `attributes.openingHours`
- `attributes.price`
- `attributes.reviews`
- Options UI de mise en page : `accordion` et `defaultOpen`

Ces formats servent de référence pour :

- la **génération** des données (backend, Odoo, API),
- le **rendu** dans le panneau latéral GeoLeaf (`poiProfiles.tourism.layout`),
- l’affichage optimisé mobile via les **panneaux repliables (accordéons)**.

---

## 0. Système d’accordéons (optimisation mobile)

Les sections riches ou longues du profil tourisme peuvent être affichées sous forme de panneaux **repliables** (accordéons) dans le panneau latéral.

Deux options UI sont supportées dans chaque entrée de `poiProfiles.tourism.layout` :

```json
{
    "accordion": true,
    "defaultOpen": false
}
```

- `accordion: true` → indique au moteur UI que la section doit être rendue dans un panneau pliable.
- `defaultOpen: false` → la section est repliée par défaut (recommandé sur mobile).

### Sections concernées (référence officielle GeoLeaf)

| Section               | Champ source                 | Accordéon recommandé |
| --------------------- | ---------------------------- | -------------------- |
| Description détaillée | `attributes.longDescription` | ✔ oui               |
| Horaires              | `attributes.openingHours`    | ✔ oui               |
| Tarifs                | `attributes.price`           | ✔ oui               |
| Galerie photos        | `attributes.gallery`         | ✔ oui               |
| Avis voyageurs        | `attributes.reviews`         | ✔ oui               |

**Objectif :**

- Améliorer la navigation sur mobile,
- Éviter un scroll excessif,
- Garder le panneau latéral lisible même avec un contenu riche.

---

## 1. Champ `attributes.openingHours`

### 1.1. Niveau 1 – Texte libre (fallback universel)

Le format le plus simple accepté est une **chaîne de caractères**.  
Dans ce cas, GeoLeaf affiche simplement le texte tel quel.

- Type : `string`
- Exemples :

```jsonc
"openingHours": "Tous les jours de 9h à 18h"
```

```jsonc
"openingHours": "Sur réservation uniquement"
```

---

### 1.2. Niveau 2 – Format structuré hebdomadaire

Pour exploiter au mieux l’information (tri futur, filtrage par jour ouvert, etc.), on définit un format structuré.

- Type : `object`
- Clés :

| Clé        | Type     | Obligatoire | Description                                                            |
| ---------- | -------- | ----------- | ---------------------------------------------------------------------- |
| `timezone` | `string` | oui         | Fuseau horaire IANA (ex. `"America/Argentina/Cordoba"`).               |
| `note`     | `string` | non         | Note générale facultative (fermetures saisonnières, conditions, etc.). |
| `rows`     | `array`  | oui         | Liste des plages horaires par groupe de jours.                         |

#### Structure de `rows`

Chaque entrée `rows[i]` est un objet :

| Clé     | Type       | Obligatoire | Description                                                                      |
| ------- | ---------- | ----------- | -------------------------------------------------------------------------------- |
| `days`  | `string[]` | oui         | Jours concernés (`"mon"`, `"tue"`, `"wed"`, `"thu"`, `"fri"`, `"sat"`, `"sun"`). |
| `open`  | `string`   | oui         | Heure d’ouverture au format `HH:MM` (24h).                                       |
| `close` | `string`   | oui         | Heure de fermeture au format `HH:MM` (24h).                                      |
| `note`  | `string`   | non         | Spécificité de la plage (ex. "haute saison", "sur réservation").                 |

#### Exemple complet

```jsonc
"openingHours": {
  "timezone": "America/Argentina/Cordoba",
  "note": "Fermé les jours fériés nationaux.",
  "rows": [
    {
      "days": ["mon", "tue", "wed", "thu", "fri"],
      "open": "09:00",
      "close": "18:00",
      "note": "Horaires standard."
    },
    {
      "days": ["sat"],
      "open": "10:00",
      "close": "16:00"
    },
    {
      "days": ["sun"],
      "open": "00:00",
      "close": "00:00",
      "note": "Fermé le dimanche."
    }
  ]
}
```

---

## 2. Champ `attributes.price`

### 2.1. Niveau 1 – Texte libre (fallback universel)

```jsonc
"price": "À partir de 25 000 ARS / nuit"
```

```jsonc
"price": "Gratuit, participation libre"
```

---

### 2.2. Niveau 2 – Format structuré tarifaire

- Type : `object`

| Clé        | Type     | Obligatoire | Description                         |
| ---------- | -------- | ----------- | ----------------------------------- |
| `currency` | `string` | oui         | Code ISO 4217                       |
| `from`     | `number` | oui         | Prix minimal                        |
| `to`       | `number` | non         | Prix max                            |
| `unit`     | `string` | oui         | Unité (per_night, per_person, etc.) |
| `note`     | `string` | non         | Info supplémentaire                 |

#### Exemple

```jsonc
"price": {
  "currency": "ARS",
  "from": 25000,
  "to": 42000,
  "unit": "per_night",
  "note": "Tarif indicatif basse saison, petit-déjeuner inclus."
}
```

---

## 3. Champ `attributes.reviews`

Liste d’avis voyageurs.

### Structure d’un avis

| Clé          | Type     | Obligatoire |
| ------------ | -------- | ----------- |
| `authorName` | `string` | oui         |
| `rating`     | `number` | non         |
| `title`      | `string` | non         |
| `comment`    | `string` | oui         |
| `date`       | `string` | non         |
| `source`     | `string` | non         |
| `language`   | `string` | non         |
| `url`        | `string` | non         |

#### Exemple

```jsonc
"reviews": [
  {
    "authorName": "Camille",
    "rating": 4.8,
    "title": "Vue incroyable sur la vallée",
    "comment": "Excellent accueil, chambre propre et calme.",
    "date": "2025-03-12",
    "source": "internal",
    "language": "fr-FR"
  }
]
```

---

## 4. Accordéon dans `poiProfiles.tourism.layout` (extrait officiel)

```jsonc
{
  "type": "text",
  "label": "Description détaillée",
  "field": "attributes.longDescription",
  "variant": "multiline",
  "accordion": true,
  "defaultOpen": false
},
{
  "type": "text",
  "label": "Horaires",
  "field": "attributes.openingHours",
  "accordion": true,
  "defaultOpen": false
},
{
  "type": "text",
  "label": "Tarifs",
  "field": "attributes.price",
  "accordion": true,
  "defaultOpen": false
},
{
  "type": "gallery",
  "label": "Galerie photos",
  "field": "attributes.gallery",
  "accordion": true,
  "defaultOpen": false
},
{
  "type": "reviews",
  "label": "Avis voyageurs",
  "field": "attributes.reviews",
  "accordion": true,
  "defaultOpen": false
}
```

---

## 5. Résumé des formats

### openingHours

- `string` **ou**
- `object { timezone, note?, rows[] }`

### price

- `string` **ou**
- `object { currency, from, to?, unit, note? }`

### reviews

- `array` d’objets `{ authorName, rating?, title?, comment, date?, source?, language?, url? }`

### UI accordéons

- `accordion: true`
- `defaultOpen: false`

---

Ce document constitue la **référence officielle GeoLeaf** pour le profil `tourism` et sa présentation UI optimisée dans le panneau latéral.
