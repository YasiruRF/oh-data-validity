"""Turn cached downloads + data/Fishing_sl.csv into compact files for the dashboard.

Inputs  (pipeline/cache): bgc.nc, phy.nc (Copernicus Marine), chl_sat.nc, kd490.nc, sst.nc, bathy.nc
Output  (public/data):
  meta.json          months, depth levels, analysis grid, per-variable grid + scaling + labels
  <var>.bin          int16 little-endian, layout [time][depth][lat][lon], -32768 = no data
  fishing.json       rows [monthIdx, lat, lon, fishing_h, longline_h, lka_h, onLand]
  verification.json  data-quality checks on the fishing file

Every variable keeps its own native grid, so 4 km satellite fields are not blurred to 28 km.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "pipeline" / "cache"
OUT = ROOT / "public" / "data"
CSV = ROOT / "data" / "Fishing_sl.csv"

LEVELS = [0.5, 10, 30, 50, 75, 100, 150, 200, 300]
ANALYSIS_STEP = 0.05  # grid used for habitat scoring and the comparison domain
BBOX = dict(lat0=3.0, lat1=12.0, lon0=75.0, lon1=87.0)

CMEMS_BGC = "Copernicus Marine"
CMEMS_PHY = "Copernicus Marine"

# key -> (source file, source variable, label, unit, has depth axis, provider)
CMEMS_VARS = {
    "o2": ("bgc", "o2", "Dissolved oxygen", "mmol/m³", True),
    "temp": ("phy", "thetao", "Temperature", "°C", True),
    "sal": ("phy", "so", "Salinity", "PSU", True),
    "chl": ("bgc", "chl", "Chlorophyll-a (model)", "mg/m³", True),
    "npp": ("bgc", "nppv", "Primary production", "mg C/m³/day", True),
    "ph": ("bgc", "ph", "pH", "", True),
    "no3": ("bgc", "no3", "Nitrate", "mmol/m³", True),
    "po4": ("bgc", "po4", "Phosphate", "mmol/m³", True),
    "current": (None, None, "Current speed", "m/s", True),
    "mld": ("phy", "mlotst", "Mixed layer depth", "m", False),
}


def month_floor_index(times) -> pd.DatetimeIndex:
    return pd.to_datetime(times).to_period("M").to_timestamp()


def month_floor(ds: xr.Dataset) -> xr.Dataset:
    return ds.assign_coords(time=month_floor_index(ds.time.values))


def pick_levels(ds: xr.Dataset) -> xr.Dataset:
    return ds.sel(depth=LEVELS, method="nearest") if "depth" in ds.dims else ds


def as_4d(da: xr.DataArray) -> np.ndarray:
    """[time][depth][lat][lon] float32, adding a length-1 depth axis if absent."""
    if "depth" not in da.dims:
        da = da.expand_dims("depth", axis=1)
    return da.transpose("time", "depth", "latitude", "longitude").values.astype("float32")


def grid_meta(lat: np.ndarray, lon: np.ndarray) -> dict:
    return dict(
        lat0=float(lat[0]), lon0=float(lon[0]),
        dlat=float(np.median(np.diff(lat))), dlon=float(np.median(np.diff(lon))),
        ny=int(len(lat)), nx=int(len(lon)),
    )


def quantise(arr: np.ndarray):
    valid = np.isfinite(arr)
    vmin, vmax = float(np.nanmin(arr)), float(np.nanmax(arr))
    scale = (vmax - vmin) / 65000.0 or 1.0
    q = np.full(arr.shape, -32768, dtype="<i2")
    q[valid] = np.round((arr[valid] - vmin) / scale).astype("<i2") - 32500
    offset = vmin + 32500 * scale  # value = q * scale + offset
    p02, p98 = (float(x) for x in np.nanpercentile(arr, [2, 98]))
    return q, scale, offset, vmin, vmax, p02, p98


def load_sat(name: str, var: str, months: pd.DatetimeIndex) -> xr.DataArray:
    parts = []
    for path in sorted(CACHE.glob(f"{name}_*.nc")):
        da = xr.open_dataset(path, engine="scipy")[var]
        for extra in ("altitude", "level"):
            if extra in da.dims:
                da = da.isel({extra: 0}, drop=True)
        parts.append(da.sortby("latitude").sortby("longitude").load())
    if not parts:
        raise SystemExit(f"no cached files for {name}; run pipeline/fetch_satellite.py first")
    da = xr.concat(parts, dim="time")
    da = da.assign_coords(time=month_floor_index(da.time.values)).groupby("time").mean()
    return da.reindex(time=months)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in ("mask.bin",):
        (OUT / old).unlink(missing_ok=True)

    bgc = pick_levels(month_floor(xr.open_dataset(CACHE / "bgc.nc"))).sortby("latitude").sortby("longitude")
    phy = pick_levels(month_floor(xr.open_dataset(CACHE / "phy.nc"))).sortby("latitude").sortby("longitude")
    months = pd.DatetimeIndex(bgc.time.values)
    month_keys = [m.strftime("%Y-%m") for m in months]
    clat, clon = bgc.latitude.values, bgc.longitude.values
    coarse_grid = grid_meta(clat, clon)

    # Physics (1/12 deg) -> smooth lightly and sample on the 0.25 deg chemistry grid.
    phy_c = phy.rolling(latitude=3, longitude=3, center=True, min_periods=1).mean()
    phy_c = phy_c.reindex(time=months).interp(latitude=clat, longitude=clon, method="linear")

    meta_vars: dict = {}

    def add_var(key: str, arr: np.ndarray, grid: dict, label: str, unit: str, has_depth: bool,
                provider: str, static: bool = False) -> None:
        q, scale, offset, vmin, vmax, p02, p98 = quantise(arr)
        (OUT / f"{key}.bin").write_bytes(q.tobytes())
        meta_vars[key] = dict(
            label=label, unit=unit, depth=has_depth, static=static, source=provider, grid=grid,
            scale=scale, offset=offset, min=vmin, max=vmax, p02=p02, p98=p98,
            coverage=float(np.isfinite(arr).mean()),
        )
        print(f"[var] {key:8s} {arr.shape} {grid['dlat']:.4f} deg range {vmin:.3g}..{vmax:.3g} coverage {meta_vars[key]['coverage']:.0%}")

    for key, (src, name, label, unit, has_depth) in CMEMS_VARS.items():
        if key == "current":
            arr = np.sqrt(as_4d(phy_c["uo"]) ** 2 + as_4d(phy_c["vo"]) ** 2)
        else:
            arr = as_4d((bgc if src == "bgc" else phy_c)[name])
        if not has_depth:
            arr = arr[:, :1]
        add_var(key, arr, coarse_grid, label, unit, has_depth, "Copernicus Marine")

    # ---- high-resolution satellite fields (single surface layer) ----
    for key, (name, var, label, unit) in {
        "chl_sat": ("chl_sat", "chlor_a", "Chlorophyll-a (satellite)", "mg/m³"),
        "kd490": ("kd490", "kd_490", "Water clarity Kd490 (satellite)", "1/m"),
    }.items():
        da = load_sat(name, var, months)
        add_var(key, as_4d(da), grid_meta(da.latitude.values, da.longitude.values), label, unit, False, "NOAA VIIRS")

    sst = load_sat("sst", "analysed_sst", months)
    if float(sst.mean()) > 200:  # Kelvin
        sst = sst - 273.15
    add_var("sst", as_4d(sst), grid_meta(sst.latitude.values, sst.longitude.values),
            "Sea-surface temperature (satellite)", "°C", False, "NOAA CoralTemp")

    # ---- seabed depth (GEBCO) doubles as the land mask ----
    bathy_ds = xr.open_dataset(CACHE / "bathy.nc", engine="scipy")
    elev = bathy_ds["elevation"].sortby("latitude").sortby("longitude")
    elev = elev.coarsen(latitude=2, longitude=2, boundary="trim").mean()
    seabed = (-elev).where(elev < 0)  # metres below the surface; NaN on land
    blat, blon = elev.latitude.values, elev.longitude.values
    bgrid = grid_meta(blat, blon)
    add_var("bathy", seabed.values.astype("float32")[None, None], bgrid, "Seabed depth", "m", False,
            "GEBCO 2021", static=True)
    seabed_np = seabed.values

    # ---- fishing data ----
    f = pd.read_csv(CSV, parse_dates=["month"])
    f["mkey"] = f["month"].dt.strftime("%Y-%m")
    f["mi"] = f["mkey"].map({k: i for i, k in enumerate(month_keys)})
    iy = np.clip(np.round((f.latitude.values - bgrid["lat0"]) / bgrid["dlat"]).astype(int), 0, bgrid["ny"] - 1)
    ix = np.clip(np.round((f.longitude.values - bgrid["lon0"]) / bgrid["dlon"]).astype(int), 0, bgrid["nx"] - 1)
    inside = (
        (f.latitude >= BBOX["lat0"]) & (f.latitude <= BBOX["lat1"])
        & (f.longitude >= BBOX["lon0"]) & (f.longitude <= BBOX["lon1"])
    )
    f["land"] = (np.isnan(seabed_np[iy, ix]) & inside).astype(int)
    rows = [
        [int(r.mi) if pd.notna(r.mi) else -1, round(r.latitude, 3), round(r.longitude, 3),
         round(r.fishing_hours, 4), round(r.longline_hours, 4), round(r.lka_hours, 4), int(r.land)]
        for r in f.itertuples()
    ]
    (OUT / "fishing.json").write_text(json.dumps(rows, separators=(",", ":")))

    nz = f[f.fishing_hours > 0]
    q1, q3 = nz.fishing_hours.quantile([0.25, 0.75]) if len(nz) else (0, 0)
    fence = float(q3 + 3 * (q3 - q1))
    top = f.sort_values("fishing_hours", ascending=False).iloc[0]
    verification = dict(
        rows=int(len(f)),
        monthsInFile=int(f.mkey.nunique()),
        monthRange=[f.mkey.min(), f.mkey.max()],
        uniqueCells=int(f[["latitude", "longitude"]].drop_duplicates().shape[0]),
        duplicateKeys=int(f.duplicated(["month", "latitude", "longitude"]).sum()),
        nulls=int(f.isna().sum().sum()),
        nonZeroRows=int(len(nz)),
        zeroShare=float(1 - len(nz) / len(f)),
        totalFishingHours=float(f.fishing_hours.sum()),
        totalLonglineHours=float(f.longline_hours.sum()),
        lkaAllZero=bool((f.lka_hours == 0).all()),
        longlineExceedsFishing=int((f.longline_hours > f.fishing_hours + 1e-9).sum()),
        onLandRows=int(f.land.sum()),
        onLandNonZeroRows=int(f[f.fishing_hours > 0].land.sum()),
        outsideEnvGridRows=int((~inside).sum()),
        outlierFence=fence,
        outlierRows=int((f.fishing_hours > fence).sum()),
        topCell=dict(month=top.mkey, lat=float(top.latitude), lon=float(top.longitude), hours=float(top.fishing_hours)),
        topCellShare=float(top.fishing_hours / f.fishing_hours.sum()) if f.fishing_hours.sum() else 0.0,
        monthsMissingFromRange=[k for k in month_keys if k not in set(f.mkey)],
    )
    (OUT / "verification.json").write_text(json.dumps(verification, indent=1))

    analysis = dict(
        lat0=BBOX["lat0"], lon0=BBOX["lon0"], dlat=ANALYSIS_STEP, dlon=ANALYSIS_STEP,
        ny=int(round((BBOX["lat1"] - BBOX["lat0"]) / ANALYSIS_STEP)) + 1,
        nx=int(round((BBOX["lon1"] - BBOX["lon0"]) / ANALYSIS_STEP)) + 1,
    )
    meta = dict(
        months=month_keys,
        depths=LEVELS,
        analysis=analysis,
        vars=meta_vars,
        sources=dict(
            cmems="Copernicus Marine: GLOBAL_MULTIYEAR_BGC_001_029 (0.25°) and GLOBAL_MULTIYEAR_PHY_001_030 (1/12°, resampled to 0.25°)",
            viirs="NOAA CoastWatch VIIRS S-NPP monthly chlorophyll-a and Kd490, 0.0375° (~4 km)",
            sst="NOAA Coral Reef Watch CoralTemp sea-surface temperature, 0.05° (~5 km), monthly mean of every 3rd day",
            gebco="GEBCO 2021 seabed depth, thinned to 0.05° (~5 km); also used as the coastline",
            fishing="Fishing_sl.csv (Ocean-Hackathon-Futoura/data-source)",
        ),
    )
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"[done] {len(month_keys)} months, {len(meta_vars)} variables, {len(rows)} fishing rows -> {OUT}")


if __name__ == "__main__":
    main()
