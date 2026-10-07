# Sri Lanka fishing-effort verification dashboard

A Next.js dashboard that puts `data/Fishing_sl.csv` (fishing hours per 0.1° cell per month, Feb 2012 to Oct 2014)
on a map and overlays what fish need to survive: oxygen, temperature, salinity, chlorophyll, nutrients,
currents, water clarity and seabed depth. It then tests whether the fishing effort sits in suitable water.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

The processed data is already in `public/data`, so no accounts are needed to view the dashboard.

## Rebuild the data

Raw downloads go to `pipeline/cache` (git-ignored). Needs Python 3 with `numpy pandas xarray scipy h5netcdf requests copernicusmarine`.

```bash
copernicusmarine login          # once, free account
npm run data:fetch              # Copernicus oxygen, chemistry, physics (0.25° / 1/12°)
npm run data:fetch:sat          # NOAA satellite chlorophyll, clarity, SST (4–5 km) and GEBCO seabed
npm run data:build              # writes public/data
```

| Layer | Source | Resolution |
|---|---|---|
| Oxygen, nitrate, phosphate, pH, primary production, model chlorophyll | Copernicus Marine `GLOBAL_MULTIYEAR_BGC_001_029` | 0.25° (~28 km), 9 depths to 300 m |
| Temperature, salinity, currents, mixed layer | Copernicus Marine `GLOBAL_MULTIYEAR_PHY_001_030` | 1/12° resampled to 0.25° |
| Chlorophyll-a, water clarity (Kd490) | NOAA VIIRS S-NPP via CoastWatch ERDDAP | 0.0375° (~4 km) |
| Sea-surface temperature | NOAA Coral Reef Watch CoralTemp | 0.05° (~5 km) |
| Seabed depth and coastline | GEBCO 2021 via IFREMER ERDDAP | 0.05° (~5 km) |

Oxygen has no satellite source, so it stays at the Copernicus model resolution.

## What the dashboard does

- **Map** with month and depth sliders, a layer picker, opacity and colour-range controls, and fishing effort as sized markers.
- **Habitat criteria**: tick conditions (oxygen, temperature, salinity, chlorophyll, clarity, pH, current, seabed depth),
  set min/max values, or pick a General / Strict / Lenient preset. No target species is assumed.
- **Data checks**: duplicates, land positions, zero-effort share, outliers, missing months, spatial coverage.
- **Habitat test**: share of fishing effort in suitable water versus the share of the surrounding sea that is suitable
  (lift), monthly chart, conditions at fishing cells versus the sea, and distribution histograms.
- **Inspector**: click the map to read every variable at that point and see which criteria fail.

## Caveats

- Fishing hours show where vessels went, not where fish are. Satellite AIS misses most small boats
  (`lka_hours` is zero everywhere in this file).
- Only 19 of the 500 rows have any effort, so the habitat test is indicative only.
- Habitat thresholds are generic defaults, not species-specific. Tune them.
- The Esri basemap is for development; check its terms before public deployment.
- `npm run lint` also scans the vendored MapLibre worker in `public/` and reports warnings for it. Run `npx eslint src` for
  our own code (the repo's config-protection hook blocks editing the ESLint config).
