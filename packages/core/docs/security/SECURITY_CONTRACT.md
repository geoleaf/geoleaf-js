---
title: "GeoLeaf Security Contract v3.0.0"
---

# GeoLeaf Security Contract v3.0.0

**Date :** 17 juillet 2026 (§1.1, §3.1 et §6 réinstruits — tâche 4.3)
**S'applique à :** `@geoleaf/core` v3.x — audit sécurité MapLibre GL JS

> Ce document est la reference de securite. Chaque vecteur d'injection identifie, la methode de sanitisation utilisee et le fichier de test correspondant sont listes ci-dessous. **Apres chaque sprint, verifier que tous les vecteurs listes ont toujours un test qui passe.**

```callout error label="Réinstruction du 17/07/2026 — les 12 lignes de §1.1 avaient dérivé, et 2 fichiers de test cités ne testaient pas ce qu'on croyait"
Ce tableau datait du **21 mars 2026** et n'avait pas suivi les refontes S9 (dissolution du sous-système POI), S13 (extraction du panneau de filtre) ni le passage du rendu de fiche à la capacité `feature-info`. **6 lignes sur 12 pointaient vers des fichiers supprimés**, et sur les 6 restantes, 4 avaient un chemin faux et 2 décrivaient une sanitisation inexacte.

🟢 **Aucun trou de sécurité.** Chaque contenu utilisateur encore rendu passe par une sanitisation **sur le chemin vivant** — vérifié un par un. Les protections ont suivi les refontes ; c'est la carte qui ne les a pas suivies.

🔴 **En revanche, la colonne « Fichier test » était en partie fictive** — voir §6 :

- **`xss-prevention.test.js` ne teste rien.** 269 lignes, 12 tests, **zéro `import`** : il crée lui-même un bouton, lui assigne lui-même `textContent`, puis vérifie que le navigateur échappe. **Il passerait si tout `packages/` était supprimé.** Tous les autres fichiers de `__tests__/security/` importent le code qu'ils testent.
- **`xss-injection-vectors.test.js` ne couvre aucun des 3 vecteurs pour lesquels il était cité.** Il n'importe que `Security` et `DOMSecurity` (`:17-18`) et teste les **primitives** — il n'atteint jamais le popup, le tooltip ni la toolbar.

**Convention de chemin — le piège qui a coûté l'enquête** : l'ancien tableau utilisait des chemins relatifs à `packages/core/src/modules/built-in/`, sans le dire. Le nouveau est relatif à **`packages/core/src/`**, sauf mention explicite d'un plugin.
```

---

## 1. Inventaire des vecteurs d'injection

### 1.1 Vecteurs DOM (injection HTML/SVG dans le DOM)

> Chemins relatifs à **`packages/core/src/`** (sauf mention d'un plugin). Tests sous `packages/core/__tests__/` (ou `packages/<plugin>/src/__tests__/`).

| Vecteur                                 | Fichier source (sink)                                                                          | Sanitisation                                                                                                                                                                                                                 | Fichier test                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Popup feature** (clic sur une entité) | `capabilities/feature-info/surfaces/popup.ts:131` → `.setDOMContent(node)`                     | **Plus aucun sink `innerHTML`** : le popup est un **nœud DOM construit**. Titre `render/popup-content.ts:132-138` + champs `render/fields.ts:95,109,152,189` en `textContent` ; URLs via `safeUrl` (`render/dom.ts:202-214`) | `capabilities/feature-info/popup.test.js` · `renderers.test.js:60,122,184`                                                                    |
| **Tooltip feature** (survol)            | `capabilities/feature-info/surfaces/tooltip.ts:84` et `:89` (`innerHTML`)                      | `escapeHtml(String(value))` — `render/popup-content.ts:310` ; `escapeHtml` = `render/dom.ts:185-189`                                                                                                                         | `capabilities/feature-info/tooltip.test.js:94-100` ✅ **couvre le chemin vivant**                                                             |
| **Sidepanel feature** (3ᵉ surface)      | `capabilities/feature-info/render/sidepanel-content.ts:140,144,146,224,228`                    | `textContent`                                                                                                                                                                                                                | ⚠️ **aucun test XSS**                                                                                                                         |
| **Catégories de filtre**                | `capabilities/filter/panel/render.ts:205` (catégorie), `:237` (sous-catégorie), `:308` (badge) | `createElement({ textContent })` → `modules/utils/general/dom-helpers.ts:92` _(l'alias `$create` a été déserté côté capacités — B.18)_                                                                                       | ✅ `capabilities/filter/panel-dom-golden.test.js` — payload `<img onerror>` sur les 3 sites, + `DOMSecurity.setSafeHTML` jamais appelé (B.18) |
| **Résultats de recherche d'adresse**    | `geocoding/src/control.ts:132` (`li.textContent = result.label`)                               | `textContent`                                                                                                                                                                                                                | `geocoding/src/__tests__/control.test.ts:130`                                                                                                 |
| **Noms de couches** (layer manager)     | `modules/built-in/layer-manager/section-renderer.ts:22,52`                                     | `textContent` _(le code est plus strict que ne le disait ce contrat, qui annonçait `setSafeHTML`)_                                                                                                                           | `layer-manager.test.js`                                                                                                                       |
| **Icônes toolbar mobile**               | `modules/built-in/ui/mobile/mobile-toolbar-pill.ts:324`                                        | `DOMSecurity.setSafeHTML(btn, icon.icon, _MOBILE_SVG_TAGS)` — whitelist `:32`                                                                                                                                                | ⚠️ **aucun** _(le fichier cité auparavant ne l'atteint pas)_                                                                                  |
| **Icônes toolbar desktop**              | `modules/built-in/ui/desktop/desktop-panel-registry.ts:156`                                    | `DOMSecurity.setSafeHTML(btn, btnDef.icon, _SVG_ALLOWED)`                                                                                                                                                                    | ⚠️ **aucun** _(jumeau de la ligne mobile, jamais recensé)_                                                                                    |
| **Icônes de marqueur** (SVG profil)     | `adapters/maplibre/maplibre-adapter.ts:431`                                                    | `DOMSecurity.setSafeHTML(el, iconHtml, SVG_ALLOWED_TAGS)`                                                                                                                                                                    | ⚠️ **aucun**                                                                                                                                  |
| **SVG du QR code de partage**           | `capabilities/permalink/share/share-modal.ts:125`                                              | `setSafeHTML(container, svg, QR_ALLOWED_TAGS)` ; URL en `:65` via `input.value`                                                                                                                                              | ⚠️ **aucun**                                                                                                                                  |
| **Labels sélecteur de thème**           | `capabilities/theme-selector/theme-selector-primary.ts:129,132` · `-secondary.ts:114`          | `textContent`                                                                                                                                                                                                                | `theme-selector.test.js`                                                                                                                      |
| **Barre de recherche (permalink → UI)** | `capabilities/filter/panel/write.ts:64` (`input.value = sf?.text ?? ""`)                       | `element.value` (jamais `innerHTML`) + troncature `MAX_TEXT_LEN = 200` (`permalink-url.ts:50,87,207`)                                                                                                                        | `permalink-injection.test.js`                                                                                                                 |
| **Couleurs de badge taxonomie** (CSSOM) | `capabilities/feature-info/render/fields.ts:155-157` ← `render/dom.ts:294-303`                 | Valeurs pré-validées par le seam taxonomy ; écriture propriété-par-propriété (CSP `style-src`)                                                                                                                               | ⚠️ **aucun**                                                                                                                                  |
| **Référence sprite SVG**                | `capabilities/feature-info/render/dom.ts:250-251` (`use.setAttribute("href", "#" + symbolId)`) | `symbolId` = id allowlisté résolu par taxonomy                                                                                                                                                                               | ⚠️ **aucun**                                                                                                                                  |
| **Flèches de navigation**               | `modules/built-in/ui/mobile/mobile-toolbar-pill.ts:377-378` et `:407-408`                      | Littéraux SVG codés en dur                                                                                                                                                                                                   | N/A (safe by design)                                                                                                                          |
| **Bannière iOS PWA**                    | `capabilities/pwa/ios-banner.ts:112` et `:122` (`innerHTML = SHARE_ICON_SVG`)                  | Constante SVG (`:26`). ⚠️ Le titre `:80` est **codé en dur, pas i18n** — ce contrat annonçait « i18n hardcodes »                                                                                                             | N/A (safe by design)                                                                                                                          |
| **Marqueur temporaire addpoi**          | `addpoi/src/poi/poi-placement.ts:280` (`el.innerHTML`)                                         | `color` (`:268`) est un ternaire de 2 littéraux hex — **aucune donnée utilisateur**                                                                                                                                          | N/A (safe by design)                                                                                                                          |

**Sorties du périmètre XSS** _(le vecteur lui-même a disparu — ne pas les rechercher)_ :

| Ancien vecteur                            | Ce qu'il est devenu                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Labels GeoJSON** (`textContent`)        | **N'atteint plus le DOM.** `capabilities/labels/label-renderer.ts:120` pose `"text-field": ["get", labelId]` sur une **couche `symbol` MapLibre native** (rendu GPU) : zéro `textContent`/`innerHTML` dans le fichier. La donnée ne rencontre jamais un parseur HTML.                                                                                |
| **Boutons delete POI**                    | **Vecteur disparu.** Le sous-système POI est dissous (S9) ; la suppression passe par un `confirm()` natif (`addpoi/src/add-form/controller.ts:404-405`), sans injection DOM. ⚠️ De plus, le fichier historiquement cité (`poi/renderers/field-renderers.ts`) ne contenait **aucune** occurrence de « delete » — la ligne était fausse dès l'origine. |
| **Résultats recherche → content-builder** | Ligne **fausse dès l'origine** : `ui/content-builder/core.ts` construisait les popups POI, pas les résultats de recherche (**zéro** occurrence de « search » sur ses 533 lignes). Le vrai vecteur est le plugin geocoding, désormais recensé ci-dessus.                                                                                              |

### 1.2 Vecteurs URL (injection via protocole ou parametres)

| Vecteur                                                      | Sanitisation                                                  | Fichier test                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------- |
| URLs POI (champs `url`, `website`, `image`, `photo`, `icon`) | `validateUrl()` — whitelist protocole (http/https/data:image) | `security.test.js`, `xss-injection-vectors.test.js` |
| Data URLs                                                    | `_validateDataUrl()` — whitelist MIME (image/\* uniquement)   | `security.test.js`                                  |
| Permalink lat/lng/zoom                                       | `validateNumber()` + `validateCoordinates()`                  | `permalink-injection.test.js`                       |
| Permalink layer IDs                                          | Filtrage string + cap 100 entrees                             | `permalink-injection.test.js`                       |
| Permalink texte filtre                                       | Troncature a 200 caracteres (`MAX_TEXT_LEN`)                  | `permalink-injection.test.js`                       |
| Permalink compact (base64)                                   | `JSON.parse(atob())` + `_validateRaw()` re-validation         | `permalink-injection.test.js`                       |
| Permalink rating                                             | `Number()` + validation `> 0`                                 | `permalink-injection.test.js`                       |

### 1.3 Vecteurs prototype pollution

> ⚠️ **Ce tableau a menti jusqu'au S5 (optimisation KERNEL, 18/07).** Il attribuait 3 vecteurs sur 4
> à `_safeAssign()` et à `normalizePoiArray()`. `_safeAssign()` n'avait plus **aucun appelant de
> production** depuis le 18/02/2026 (commit `15cc5cf7` — la copie par POI supprimée pour raison de
> perf) ; il a été retiré au S5. **`normalizePoiArray()` n'a jamais existé** (`grep` repo-wide : 0
> résultat) — deux vecteurs étaient donc documentés comme protégés par une fonction fantôme. Dans le
> même temps, `setValueByPath()` — le **seul** sink atteignable depuis le pipeline de chargement de
> couches — n'était gardé par rien. Corrigé au S5 ; le tableau ci-dessous est vérifié ligne par ligne
> contre le code.

| Vecteur | Protection | Fichier test |
| ------- | ---------- | ------------ |

> **Source unique depuis le S13.2** — toutes les protections ci-dessous appellent la même
> blocklist, `isUnsafeKey()` / `hasUnsafeSegment()` de
> `modules/utils/general/object-path-guard.ts`. Elle n'a **aucun import**, ce qui est ce
> qui la rend importable depuis n'importe quelle couche sans créer d'arête ni de cycle —
> l'objection qui avait maintenu quatre copies privées divergentes jusque-là.

| Vecteur                               | Protection                                                                                                                                | Fichier test                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Profil JSON config                    | `_isUnsafeKey()` (`built-in/config/storage.ts`, wrapper logueur) sur `set()`, `merge()` et `deepMerge()`                                  | `sprint1-sink-hardening.test.js` (M3)                    |
| Proprietes POI (mapping.json)         | `_isUnsafeKey()` sur `setValueByPath()` — le chemin d'écriture de `normalizePoiWithMapping`                                               | `prototype-pollution.test.js`                            |
| **Sac `modules` d'un profil** (S13.2) | `isUnsafeKey()` sur `mergeModulesBag()`, `mergeModuleBags()` et le chargeur `Files.modules` — 3 sinks ouverts jusqu'au S13.2              | `module-config-pollution.test.js`                        |
| Permalink compact base64              | `JSON.parse()` (safe) + `_validateRaw()` type checks                                                                                      | `permalink-injection.test.js`                            |
| Styles GeoJSON (normalisation paint)  | `_safeCopy()`, `_mergeNativePaint()`, `_resolveRuleStyle()` et `_buildPaintFromRules()` (`adapters/maplibre/maplibre-style-converter.ts`) | `s14-style-converter-paint.test.js`                      |
| Utilitaires publics par chemin        | `deepMerge()` (`utils/general/utils-base.ts`) et `setNestedValue()` (`utils/general/object-utils.ts`)                                     | `utils-base.test.js`, `object-utils.test.js` (@security) |
| **Inventaire lui-même** (S13.2)       | `check-dynamic-key-writes.cjs` — toute nouvelle écriture `X[k] = …` non gardée échoue au commit et en CI                                  | `guards/prototype-pollution-sinks.guard.test.js`         |

> 🟢 **Note de portée, mesurée au S5** — sur `setValueByPath` la pollution **globale** de
> `Object.prototype` n'était pas atteignable : le contrôle de propriété propre remplace
> l'intermédiaire par un objet neuf et casse la chaîne `constructor.prototype`. Ce qui l'était : une
> injection de prototype **scopée** aux POI en cours de construction (`"__proto__.x"` →
> propriété héritée sur chaque POI), qui coulait ensuite dans les properties de features, popups et
> colonnes de table. Sévérité moyenne, pas critique — le garde est posé, mais le contrat ne doit pas
> surestimer ce qu'il referme.
>
> ⚠️ Les propriétés de features GeoJSON ne sont **que lues** dans le pipeline core (validation par
> `feature-validator.ts`), jamais fusionnées dans un autre objet — il n'y a donc pas de sink à garder
> pour elles. La ligne « styles » ci-dessus couvre le seul chemin où elles sont recopiées.

---

## 2. API du module Security

### Fonctions de sanitisation

| Fonction                        | Entree                       | Garantie sortie                                                                   | Usage                     |
| ------------------------------- | ---------------------------- | --------------------------------------------------------------------------------- | ------------------------- |
| `escapeHtml(str)`               | String quelconque            | Caracteres HTML (`<`, `>`, `&`, `"`, `'`) echappes en entites                     | Contenu texte dans le DOM |
| `escapeAttribute(str)`          | String quelconque            | Memes caracteres + `'` echappes                                                   | Valeurs d'attributs HTML  |
| `containsDangerousHtml(str)`    | String quelconque            | `true` si patterns XSS detectes                                                   | Detection/rejet rapide    |
| `stripHtml(html)`               | String HTML                  | Texte brut sans aucun tag                                                         | Affichage texte pur       |
| `sanitizeSvgContent(svg)`       | String SVG brute             | SVGElement sans `<script>`, `<foreignObject>`, handlers `on*`, `javascript:` href | Icones SVG externes       |
| `parseHtmlSafely(html, tags)`   | String HTML + whitelist tags | DocumentFragment avec uniquement les tags autorises                               | Contenu riche controle    |
| `sanitizeHTML(el, html, opts)`  | Element DOM + HTML           | Injection sanitisee via `parseHtmlSafely`                                         | Wrapper principal         |
| `validateUrl(url, base, opts)`  | String URL                   | URL validee (protocole whiteliste) ou throw                                       | Liens, images, medias     |
| `validateCoordinates(lat, lng)` | Nombres                      | Tuple `[lat, lng]` valide ou throw                                                | Coordonnees carte         |
| `validateNumber(val, min, max)` | Valeur quelconque            | Nombre fini dans [min, max] ou `null`                                             | Parametres numeriques     |

### Fonctions DOM securisees

| Fonction                                          | Entree                                 | Garantie                                                    | Usage               |
| ------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------- | ------------------- |
| `DOMSecurity.setTextContent(el, text)`            | Element + texte                        | Assignation via `textContent` (jamais `innerHTML`)          | Tout texte non-HTML |
| `DOMSecurity.setSafeHTML(el, html, tags?)`        | Element + HTML + whitelist optionnelle | Passe par `Security.sanitizeHTML()`, fallback `textContent` | HTML controle       |
| `DOMSecurity.clearElement(el)`                    | Element                                | Suppression enfants via `removeChild` loop                  | Nettoyage DOM       |
| `DOMSecurity.createElement(tag, attrs, children)` | Tag + attributs + enfants              | Element cree via DOM API safe                               | Creation elements   |
| `DOMSecurity.createSVGIcon(w, h, path, opts)`     | Dimensions + path data                 | SVGElement via `createElementNS` (pas `innerHTML`)          | Icones SVG internes |

### Protection CSRF

| Fonction                                     | Description                                          |
| -------------------------------------------- | ---------------------------------------------------- |
| `CSRFToken.init()`                           | Genere un token crypto-random (32 octets, base64url) |
| `CSRFToken.getToken()`                       | Retourne le token courant, regenere si expire        |
| `CSRFToken.validateToken(token)`             | Validation constante-time du token                   |
| `CSRFToken.rotateToken()`                    | Rotation manuelle + event `geoleaf:csrf:rotated`     |
| `CSRFToken.addTokenToHeaders(opts)`          | Ajoute `X-CSRF-Token` aux headers                    |
| `CSRFToken.addTokenToForm(form)`             | Ajoute `<input type="hidden" name="csrf_token">`     |
| `CSRFToken.setSecureCookie(name, val, opts)` | Cookie avec `Secure`, `SameSite`, `HttpOnly`         |

---

## 3. Patterns dangereux — resultat audit

| Pattern                    | Occurrences         | Statut                                       |
| -------------------------- | ------------------- | -------------------------------------------- |
| `eval()`                   | 0                   | OK                                           |
| `new Function(`            | 0                   | OK                                           |
| `setTimeout(string, ...)`  | 0                   | OK                                           |
| `setInterval(string, ...)` | 0                   | OK                                           |
| `document.write`           | 0                   | OK                                           |
| `insertAdjacentHTML`       | 0                   | OK                                           |
| `outerHTML` (ecriture)     | 0                   | OK (1 lecture dans label-renderer.ts — safe) |
| `innerHTML` (total)        | 31 dans 14 fichiers | Tous safe — voir section 3.1                 |

### 3.1 Classification innerHTML

> ⚠️ **Comptage à rejouer.** Cette classification date du 21/03/2026 et cite **4 fichiers supprimés depuis** (`poi/normalizers.ts`, `geojson/popup-tooltip.ts`, `renderers/abstract-renderer.ts`, `ui/filter-panel/lazy-loader.ts`) ainsi que 2 chemins déplacés (`ui/mobile-toolbar-pill.ts` → `ui/mobile/`). Le total « 31 occ. dans 14 fichiers » du tableau ci-dessus n'a pas été rejoué. Les **catégories** restent justes ; ce sont les fichiers et les chiffres qui ont bougé. Les sinks réels sont recensés en §1.1, à jour au 17/07.

- **Construction DOM (aucun `innerHTML`)** 🆕 — le popup de fiche : `capabilities/feature-info/surfaces/popup.ts:131` passe un **nœud** à `.setDOMContent()`. C'est le remplaçant de l'ancien « escape pattern » de `geojson/popup-tooltip.ts`, et c'est plus sûr.
- **Escape pattern** (textContent→innerHTML read) : `modules/built-in/security/index.ts` · `capabilities/feature-info/surfaces/tooltip.ts:84,89` (via `escapeHtml`, `render/popup-content.ts:310`).
- **`DOMSecurity.setSafeHTML` wrapper** : `modules/utils/general/dom-helpers.ts` · `modules/built-in/ui/mobile/mobile-toolbar-pill.ts:324` · `modules/built-in/ui/desktop/desktop-panel-registry.ts:156` · `adapters/maplibre/maplibre-adapter.ts:431` · `capabilities/permalink/share/share-modal.ts:125`.
- **Clearing** (`innerHTML = ""`) : `modules/built-in/ui/mobile/mobile-toolbar.ts` · `mobile-toolbar-sheet.ts`.
- **Constantes codées en dur** (SVG) : `capabilities/pwa/ios-banner.ts:112,122` · `capabilities/theme-selector/theme-selector-primary.ts` · `modules/built-in/ui/mobile/mobile-toolbar-pill.ts:377-378,407-408` · `addpoi/src/poi/poi-placement.ts:280`.

---

## 4. Compatibilite CSP (Content Security Policy)

Directives minimales requises pour GeoLeaf + MapLibre GL JS v6 :

| Directive     | Valeur                | Raison                                                                                                                                                                                                                                 |
| ------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src`  | `'self'`              | Zero `eval`/`Function`/inline scripts. Workers meme-origine.                                                                                                                                                                           |
| `style-src`   | `'self'`              | Styles dynamiques posés via le **CSSOM** (`element.style.setProperty` / helper `applyCssText`) ou des **classes CSS** — non soumis à `style-src`. `'unsafe-inline'` **retiré** (roadmap B.5, gardé par e2e `18-security`, 0 violation) |
| `img-src`     | `'self' data: https:` | Data URLs pour markers/icones, tuiles HTTPS                                                                                                                                                                                            |
| `connect-src` | `'self' https:`       | Fetch GeoJSON, profils, URLs de tuiles                                                                                                                                                                                                 |
| `worker-src`  | `'self' blob:`        | GeoJSON worker via blob URLs (`worker-manager.ts`)                                                                                                                                                                                     |
| `font-src`    | `'self'`              | Aucune fonte externe chargee par le core                                                                                                                                                                                               |
| `default-src` | `'self'`              | Fallback securise                                                                                                                                                                                                                      |

**Points notables :**

- `unsafe-eval` **non requis** — confirme pour MapLibre GL JS v6 et GeoLeaf
- `unsafe-inline` **non requis** (depuis B.5) — les styles dynamiques passent par le CSSOM (`element.style.setProperty`, helper `applyCssText`) ou des classes CSS ; les écritures CSSOM propriété-par-propriété échappent à `style-src`. Les styles inline résiduels (string-emitters, sprite SVG, `<style>` démo) ont été refactorés ; gardé par l'e2e `18-security` (0 violation)
- Apres migration MapLibre : verifier si MapLibre GL exige des directives supplementaires (WebGL, workers)

---

## 5. Checklist de revue

> **La migration MapLibre est terminée** (v3.0.0, moteur natif de bout en bout) : cette
> section n'est plus une checklist de migration mais **la revue à passer sur ce contrat**
> à chaque sprint qui touche un rendu. La leçon du 17/07 en dicte la première ligne.

- [ ] **Chaque `Fichier source` de §1.1 existe-t-il encore ?** _(6/12 pointaient dans le vide au 17/07 — une refonte déplace les protections, jamais la carte)_
- [ ] **Chaque `Fichier test` de §1.1 IMPORTE-t-il le code qu'il prétend tester ?** _(un test sans `import` ne teste que le navigateur — cf. §6)_
- [ ] Chaque test cité atteint-il le **sink réel**, pas seulement la primitive de sanitisation ?
- [ ] Le rendu de fiche (popup / tooltip / sidepanel) construit-il toujours du **DOM** ou passe-t-il par `escapeHtml` avant `innerHTML` ?
- [ ] Les marqueurs et icônes SVG passent-ils toujours par `DOMSecurity.setSafeHTML` + whitelist ?
- [ ] `validateUrl` couvre-t-il les URLs de tuiles et de médias ?
- [ ] Toute **nouvelle** surface d'injection est-elle inscrite en §1.1 ? _(7 vecteurs protégés existaient sans y figurer au 17/07)_
- [ ] CSP : une nouvelle dépendance exige-t-elle `unsafe-eval` / `unsafe-inline` ? _(non requis à ce jour)_
- [ ] Prototype pollution : les nouveaux points d'entrée de configuration sont-ils couverts ?
- [ ] Prototype pollution : tout nouveau writer par chemin (`a.b.c`) applique-t-il un garde **sur chaque segment, le dernier inclus** ? _(un chemin d'un seul segment saute la boucle de descente — c'est le trou du S5)_
- [ ] Le garde est-il testé **contre l'implémentation réelle**, sans mock du sink ? _(le mock était le camouflage du S5)_
- [ ] `npm run check:dynamic-key-writes` est-il vert **sans nouvelle entrée de baseline** ? _(mécanise les deux points ci-dessus depuis le S13.2 ; une entrée ajoutée doit être justifiée en message de commit)_
- [ ] Le garde importe-t-il `object-path-guard.js` plutôt que de redéclarer sa liste ? _(le test-garde `prototype-pollution-sinks.guard.test.js` refuse une 5ᵉ copie)_
- [ ] **Le nouveau test MEURT-il quand on neutralise le garde ?** _(protocole de mutation manuelle : faire retourner `false` à `isUnsafeKey`, vérifier que le test rougit, restaurer. Au S13.2 la mutation tue 13 tests sur 4 fichiers. Un test de sécurité jamais vu rouge ne prouve rien — `sprint1-sink-hardening.test.js:174-184` documente un cas qui passait pour une raison sans rapport avec la blocklist)_
- [ ] Tous les tests `__tests__/security/` passent

---

## 6. Fichiers de test securite

| Fichier                                          | Tests | Couverture                                                                                                                                                                                                                                       |
| ------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `security/security.test.js`                      | 42    | escapeHtml, escapeAttribute, validateUrl, validateCoordinates                                                                                                                                                                                    |
| `security/sprint1-sink-hardening.test.js`        | 12    | Gardes câblés au sink : sprite loader (M1), Config `deepMerge`/`set`/`merge` (M3), `setValueByPath` (S5) — **StorageHelper réel, non mocké**                                                                                                     |
| `security/csrf-token.test.js`                    | 23    | CSRFToken lifecycle complet                                                                                                                                                                                                                      |
| `security/security-comprehensive.test.js`        | ~60   | Couverture etendue escapeHtml, coordinates                                                                                                                                                                                                       |
| `security/security-extended.test.js`             | ~50   | sanitizeSvgContent, validateNumber, parseHtmlSafely                                                                                                                                                                                              |
| `security/security.esm.test.js`                  | ~70   | Tests ESM de toutes les fonctions                                                                                                                                                                                                                |
| `security/prototype-pollution.test.js`           | 6     | **Réécrit S5** — pipeline réel `normalizePoiWithMapping` → `setValueByPath`, **sans mock** du sink. L'ancienne version (annoncée « 16 tests » alors qu'elle en avait 7) testait `_safeAssign` — sans appelant prod — **en mockant** le vrai sink |
| 🔴 `security/xss-prevention.test.js`             | 12    | **RIEN — 269 lignes, ZÉRO `import`.** Voir l'encadré ci-dessous                                                                                                                                                                                  |
| ⚠️ `security/xss-injection-vectors.test.js`      | ~90   | **Les PRIMITIVES uniquement** (`Security`, `DOMSecurity` — seuls imports, `:17-18`). Ne couvre **aucun** vecteur de §1.1                                                                                                                         |
| `security/permalink-injection.test.js`           | ~30   | Injection URL params + compact mode                                                                                                                                                                                                              |
| `security/file-validator.test.js`                | ~25   | Upload securise (taille, extension, MIME)                                                                                                                                                                                                        |
| `security/dom-security.test.js`                  | 24    | DOMSecurity wrapper complet                                                                                                                                                                                                                      |
| 🆕 `capabilities/feature-info/tooltip.test.js`   | —     | ✅ `:94-100` — injecte `<b>x</b>`, assert `querySelector("b")` null. **Vrai test sur le chemin vivant**                                                                                                                                          |
| 🆕 `capabilities/feature-info/renderers.test.js` | —     | ✅ `:60,122,184` — payloads `javascript:`. Écrits après la refonte, jamais reportés ici                                                                                                                                                          |

**Total :** ~440 tests annoncés — **à rejouer**, et à minorer d'au moins 12 (voir ci-dessous).

```callout error label="🔴 xss-prevention.test.js ne teste rien — et il compte dans le total"
**269 lignes, 12 tests, ZÉRO `import` / `require`.** Il ne charge aucun code de GeoLeaf.

Son premier bloc, « POI Fields Renderer - Delete Button XSS Prevention », fait
`document.createElement("button")`, **assigne lui-même** `deleteBtn.textContent = "✕"`
(`:41`), puis vérifie que… le navigateur a bien échappé (`:47-48`). **Il teste l'API DOM
de Chrome, pas GeoLeaf.** Il passerait si l'intégralité de `packages/` était supprimée.

Son commentaire (`:35`) dit « as in fields-renderer.js » — un fichier disparu avec la
dissolution du sous-système POI (S9). Le test a survécu à son sujet **et à sa raison
d'être**, en continuant de compter dans le total affiché ci-dessus.

**Contrôle qui le prouve** : tous les autres fichiers de `__tests__/security/` importent
le code qu'ils testent (`security.test.js` : 1 · `prototype-pollution.test.js` : 2 ·
`permalink-injection.test.js` : 1 · `xss-injection-vectors.test.js` : 2). Celui-ci : **0**.

C'est le 3ᵉ test tautologique démasqué sur ce projet (après le S3 et le C-8) — et le
premier dans `__tests__/security/`. **Action : à réécrire sur un sink réel de §1.1, ou à
supprimer. Ne pas le laisser gonfler un compteur de sécurité.**
```

### 6.1 🕳️ Vecteurs protégés mais NON testés (trous d'assurance, pas de code)

Ces vecteurs sont **réellement protégés** (§1.1) — mais aucun test ne le vérifie. La
protection tient à la relecture, pas à un filet.

| Vecteur                                  | Sanitisation en place                          |
| ---------------------------------------- | ---------------------------------------------- |
| Catégories de filtre                     | `createElement({ textContent })`               |
| Icônes toolbar **mobile** et **desktop** | `DOMSecurity.setSafeHTML` + whitelist SVG      |
| Icônes de marqueur (SVG profil)          | `DOMSecurity.setSafeHTML` + `SVG_ALLOWED_TAGS` |
| SVG du QR code de partage                | `setSafeHTML` + `QR_ALLOWED_TAGS`              |
| Sidepanel feature-info                   | `textContent`                                  |
| Couleurs de badge taxonomie (CSSOM)      | Valeurs pré-validées par le seam taxonomy      |
