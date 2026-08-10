-- GeoLeaf — dev proof backend seed (task 4.H)
--
-- Derived from `profiles/tourism/layers/sites_rosario/data/sites_rosario.geojson`,
-- the file the layer already ships. Inventing rows here would let the pull prove
-- itself against data no other part of the project has ever rendered.
--
-- `local_id` is left NULL: these rows were created server-side and have never had a
-- client identity. That is precisely the state `serverId != null, localId == null`
-- that task 4.1 must be able to store, and it is not the same shape as a row created
-- offline -- which arrives with a local_id and no id.

BEGIN;

TRUNCATE api.sites_rosario RESTART IDENTITY;

INSERT INTO api.sites_rosario (title, description, description_longue, adresse, statut, mots_cles, services, horaires, site_web, photo_principale, galerie, category_id, subcategory_id, geom) VALUES (
    'Monumento Nacional a la Bandera', 'Monument national inauguré en 1957, sur le site où Belgrano créa le drapeau argentin en 1812.', 'Le Monumento Nacional a la Bandera s''élève à 70 mètres de hauteur. Conçu par Ángel Guido et Alejandro Bustillo, il abrite le mausolée du général Belgrano et offre une vue panoramique sur le río Paraná depuis son sommet accessible en ascenseur.', 'Av. Belgrano y Av. del Puerto, Rosario, Santa Fe', 'Ouvert', '["patrimoine", "histoire", "culture", "gratuit"]'::jsonb, '["Ascenseur panoramique", "Mausolée Belgrano", "Audioguide ES/EN/FR", "Cafétéria", "Boutique souvenirs", "Accès PMR"]'::jsonb, '[{"jour": "Lundi", "horaire": "Fermé"}, {"jour": "Mar–Ven", "horaire": "09h00–19h00"}, {"jour": "Sam–Dim", "horaire": "10h00–20h00"}]'::jsonb, 'https://www.monumentoabandera.gob.ar', 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Monumento_a_la_Bandera_%28Rosario%29.jpg/640px-Monumento_a_la_Bandera_%28Rosario%29.jpg', '["https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Monumento_a_la_Bandera_%28Rosario%29.jpg/320px-Monumento_a_la_Bandera_%28Rosario%29.jpg", "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Belgrano_Rosario.jpg/320px-Belgrano_Rosario.jpg"]'::jsonb, 'CULTURES', 'MUSEE',
    ST_GeomFromGeoJSON('{"type": "Point", "coordinates": [-60.6524, -32.9442]}')
);

INSERT INTO api.sites_rosario (title, description, description_longue, adresse, statut, mots_cles, services, horaires, site_web, photo_principale, galerie, category_id, subcategory_id, geom) VALUES (
    'Parque Independencia', 'Grand parc urbain de 104 hectares au cœur de Rosario, créé en 1900.', 'Le Parque Independencia est le poumon vert de Rosario. Il abrite le Museo Municipal de Bellas Artes Juan B. Castagnino, un hippodrome, des rosiers dans le Jardín Francés, un lac avec barques et des terrains de sport. Marchés artisanaux chaque week-end.', 'Av. Pellegrini 2202, Rosario, Santa Fe', 'Ouvert', '["nature", "culture", "enfants", "gratuit"]'::jsonb, '["Musée Castagnino", "Hippodrome", "Location barques", "Terrains de sport", "Marchés week-end", "Wi-Fi gratuit"]'::jsonb, '[{"jour": "Tous les jours", "horaire": "06h00–22h00"}, {"jour": "Musée", "horaire": "Mar–Ven 14h–20h"}]'::jsonb, 'https://www.rosario.gob.ar/parques', 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Parque_Independencia_Rosario.jpg/640px-Parque_Independencia_Rosario.jpg', '["https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Parque_Independencia_Rosario.jpg/320px-Parque_Independencia_Rosario.jpg"]'::jsonb, 'nature', 'parc',
    ST_GeomFromGeoJSON('{"type": "Point", "coordinates": [-60.6695, -32.9478]}')
);

COMMIT;

-- ── Pagination fixture ───────────────────────────────────────────────────────
--
-- 🛑 These 25 rows are NOT filler. The two rows above fit in a single page, and a pull
-- that never turns a page cannot prove the `next`-link mechanism that contract point 6
-- names. With pygeoapi's default `limit: 10`, 27 rows force THREE pages — so the walk
-- is exercised, and an implementation that stops after page one fails instead of
-- reporting success.
--
-- Measured at bring-up: 3 pages, 27 features accumulated.

BEGIN;

INSERT INTO api.sites_rosario (title, geom)
SELECT
    'Sonde pagination ' || g,
    ST_SetSRID(ST_MakePoint(-60.66 + g * 0.001, -32.94 + g * 0.001), 4326)
FROM generate_series(1, 25) g;

COMMIT;
