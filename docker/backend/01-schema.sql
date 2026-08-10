-- GeoLeaf — dev proof backend (task 4.H of roadmap_collecte-terrain-offline.md)
--
-- Stands up the backend the Sprint 4 proof criterion requires: pull a bounded set of
-- entities, edit them offline, push them back, and reconcile identity. Until 4.H this
-- backend did not exist -- its host resolved to 127.0.0.1 with no Traefik router
-- behind it, and the only authenticated E2E mocked every response.
--
-- DEV ONLY. Runs against the shared PostGIS on the `backend` network. Never deployed.
--
-- Two consumers, one table:
--   * pygeoapi  -> OGC API Features, the READ side (task 4.1). `ogc-api-loader.ts`
--     already speaks it: `next` link pagination, `bbox`, `limit`, `AbortSignal`.
--     ⚠️ pg_featureserv was tried first and REJECTED on a measurement -- it emits no
--     `next` link, so the pull would stop after page one and report success. See
--     docker/backend/README.md.
--   * PostgREST -> the WRITE side (tasks 4.4/4.5), `collection` dialect: the adapters
--     POST a flat `{ ...properties, geom }` body to `{baseUrl}/{layerId}`, which is
--     exactly PostgREST's table endpoint.

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS api;

-- ── Roles ────────────────────────────────────────────────────────────────────
--
-- `geoleaf_auth` is the role PostgREST connects as. It is NOINHERIT on purpose: it
-- holds no privilege of its own and can only reach what a JWT's `role` claim lets it
-- SET ROLE into. A token that carries no role therefore gets `geoleaf_anon`, never
-- write access -- which is the SQL-side mirror of contract invariant S6: pull never
-- grants write.

DO $$ BEGIN
    CREATE ROLE geoleaf_anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE ROLE geoleaf_editor NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    EXECUTE format(
        'CREATE ROLE geoleaf_auth NOINHERIT LOGIN PASSWORD %L',
        current_setting('geoleaf.auth_password')
    );
EXCEPTION WHEN duplicate_object THEN
    EXECUTE format(
        'ALTER ROLE geoleaf_auth PASSWORD %L',
        current_setting('geoleaf.auth_password')
    );
END $$;

GRANT geoleaf_anon, geoleaf_editor TO geoleaf_auth;

-- ── The layer table ──────────────────────────────────────────────────────────
--
-- Mirrors `profiles/tourism/layers/sites_rosario/sites_rosario_config.json` -- the one
-- test layer that grants `edition.create`/`edition.update` AND carries a `formSchema`. Column
-- names are the `formSchema` field ids, because the `collection` dialect sends
-- properties FLAT under their own names (`buildCollectionBody`, collection-rest-adapter.ts).
--
-- Three columns exist for the contract rather than for the business model:
--
--   * `local_id`   -- the client-minted `LocalId`. UNIQUE, so a replayed push collides
--                     instead of duplicating: this is what makes replay idempotent (4.5).
--                     Contract point 2: the queue references localId and never serverId.
--   * `id`         -- the `ServerId`, assigned here and returned to the client, which is
--                     the reconciliation 4.5 performs.
--   * `updated_at` -- the `VersionMarker` of kind `timestamp`. Read at pull, sent back at
--                     push so a conflict becomes DETECTABLE (4.6). Without it
--                     `lastWriteWins` could not be a declared policy, only an accident.

CREATE TABLE IF NOT EXISTS api.sites_rosario (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    local_id           text UNIQUE,
    title              text NOT NULL,
    description        text,
    description_longue text,
    adresse            text,
    statut             text,
    mots_cles          jsonb,
    services           jsonb,
    horaires           jsonb,
    site_web           text,
    photo_principale   text,
    galerie            jsonb,
    category_id        text,
    subcategory_id     text,
    geom               geometry(Point, 4326) NOT NULL,
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sites_rosario_geom_idx ON api.sites_rosario USING GIST (geom);
CREATE INDEX IF NOT EXISTS sites_rosario_updated_at_idx ON api.sites_rosario (updated_at);

-- The version marker must move on every UPDATE, and it must NOT be writable by the
-- client: a freshness marker the writer controls detects nothing.
CREATE OR REPLACE FUNCTION api.touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sites_rosario_touch ON api.sites_rosario;
CREATE TRIGGER sites_rosario_touch
    BEFORE INSERT OR UPDATE ON api.sites_rosario
    FOR EACH ROW EXECUTE FUNCTION api.touch_updated_at();

-- ── Privileges ───────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA api TO geoleaf_anon, geoleaf_editor;

GRANT SELECT ON api.sites_rosario TO geoleaf_anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.sites_rosario TO geoleaf_editor;

-- `GENERATED ALWAYS AS IDENTITY` needs no sequence grant, and deliberately so: the
-- client cannot choose a server id, which is the whole point of reconciliation.

COMMIT;

-- ── Read-side connection role (added at 4.H bring-up) ────────────────────────
--
-- 🛑 pg_featureserv does NOT `SET ROLE` per request the way PostgREST does: it queries
-- as its connection role directly. Pointing it at `geoleaf_auth` therefore showed
-- `"collections": []` -- not a configuration miss, a consequence of that role being
-- NOINHERIT. NOINHERIT is right for PostgREST (it is what makes an unauthenticated
-- request land on `geoleaf_anon` and nowhere else), so the fix is a second role rather
-- than weakening the first.
--
-- `geoleaf_ogc` is read-only AT THE DATABASE, not by convention: even a bug in the
-- read path cannot write. That is contract invariant S6 held twice over -- pull grants
-- no write access, and the puller has none to grant.

DO $$ BEGIN
    EXECUTE format(
        'CREATE ROLE geoleaf_ogc LOGIN PASSWORD %L',
        current_setting('geoleaf.auth_password')
    );
EXCEPTION WHEN duplicate_object THEN
    EXECUTE format(
        'ALTER ROLE geoleaf_ogc PASSWORD %L',
        current_setting('geoleaf.auth_password')
    );
END $$;

GRANT USAGE ON SCHEMA api TO geoleaf_ogc;
GRANT SELECT ON api.sites_rosario TO geoleaf_ogc;
