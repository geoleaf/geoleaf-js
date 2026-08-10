# FlatGeobuf data prep — spatial index (bbox / HTTP Range)

The `plugin-flatgeobuf` bbox features (`loadBbox`, `loadBboxAsLayer`, declarative
`data.bbox`, `autoRefresh`) read only the features intersecting the viewport via the
file's **R-tree spatial index** and HTTP Range requests. A `.fgb` **without** an index
throws _"No index found, cannot read features filtered by bbox"_.

## ⚠️ The `flatgeobuf` JS `serialize()` produces NO index

`flatgeobuf@^4.4.0`'s `serialize()` writes the header with `indexNodeSize = 0`, i.e. **no
spatial index**. Files produced that way support full-file `load()` only. To get an
indexed `.fgb` you need external tooling — **GDAL** (its FlatGeobuf driver writes a
packed Hilbert R-tree index by default).

## Producing an indexed `.fgb` with GDAL `ogr2ogr`

GDAL ships with QGIS (`C:\Program Files\QGIS <ver>\bin\ogr2ogr.exe` on Windows) or via
`apt install gdal-bin` on Linux.

```bash
# From GeoJSON
ogr2ogr -f FlatGeobuf -lco SPATIAL_INDEX=YES out.fgb in.geojson

# Re-index an existing index-less .fgb (read full, rewrite with index)
ogr2ogr -f FlatGeobuf -lco SPATIAL_INDEX=YES out.fgb in.fgb
```

`SPATIAL_INDEX=YES` is GDAL's default for `.fgb`; it is spelled out here for clarity.

## Verifying the index

```bash
node scripts/check-fgb-index.mjs out.fgb
# → indexNodeSize=16 ... → INDEXED ✓ (bbox/Range OK)
```

`indexNodeSize > 0` ⇒ bbox / HTTP Range mode works. `indexNodeSize = 0` ⇒ full-file only.

## Repo demo datasets (regenerated indexed for S10)

| File                                                           | Mode used by the profile        |
| -------------------------------------------------------------- | ------------------------------- |
| `profiles/france-rail/data/zones_desserte_sncf.fgb`            | bbox + HTTP Range + autoRefresh |
| `profiles/tourism/layers/eco_regions_fgb/data/eco_regions.fgb` | full-file (no bbox)             |

Both were re-indexed via the `ogr2ogr` command above (validated S10). The server hosting
`.fgb` files must answer HTTP Range requests (206 Partial Content) — most static servers
(`http-server`, Nginx, Apache, S3, GitHub Pages) do by default.
