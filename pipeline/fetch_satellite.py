"""Download high-resolution satellite and seabed layers for Sri Lankan waters into pipeline/cache/.

No account needed. Sources (all public ERDDAP servers):
  chl_sat_*.nc  NOAA VIIRS S-NPP monthly chlorophyll-a, 0.0375 deg (~4 km), 2012-present
  kd490_*.nc    NOAA VIIRS S-NPP monthly Kd490 (water clarity), 0.0375 deg
  sst_*.nc      NOAA Coral Reef Watch CoralTemp daily sea-surface temperature, 0.05 deg (~5 km), every 3rd day
  bathy.nc      GEBCO 2021 elevation, 15 arc-second thinned to 0.025 deg

Time series are fetched in half-year chunks because the server proxy rejects large requests.
Re-running skips files that already exist.
"""
import sys
import time
from pathlib import Path

import requests

CACHE = Path(__file__).parent / "cache"
CACHE.mkdir(exist_ok=True)

LAT0, LAT1 = 3.0, 12.0
LON0, LON1 = 75.0, 87.0

NOAA = "https://coastwatch.noaa.gov/erddap/griddap"
IFREMER = "https://erddap.ifremer.fr/erddap/griddap"

CHUNKS = [
    ("2012a", "2012-01-01", "2012-06-30"), ("2012b", "2012-07-01", "2012-12-31"),
    ("2013a", "2013-01-01", "2013-06-30"), ("2013b", "2013-07-01", "2013-12-31"),
    ("2014a", "2014-01-01", "2014-06-30"), ("2014b", "2014-07-01", "2014-12-31"),
]

SST_CHUNKS = [
    (f"{y}q{q}", f"{y}-{m0:02d}-01", f"{y}-{m1:02d}-{d1}")
    for y in (2012, 2013, 2014)
    for q, (m0, m1, d1) in enumerate([(1, 3, 31), (4, 6, 30), (7, 9, 30), (10, 12, 31)], start=1)
]

# name -> url template for time series; VIIRS latitude is stored north-to-south.
SERIES = {
    "chl_sat": NOAA + "/noaacwNPPVIIRSSQchlaMonthly.nc?chlor_a[({t0}T00:00:00Z):1:({t1}T00:00:00Z)][(0.0):1:(0.0)]"
    f"[({LAT1}):1:({LAT0})][({LON0}):1:({LON1})]",
    "kd490": NOAA + "/noaacwNPPVIIRSSQkd490Monthly.nc?kd_490[({t0}T00:00:00Z):1:({t1}T00:00:00Z)][(0.0):1:(0.0)]"
    f"[({LAT1}):1:({LAT0})][({LON0}):1:({LON1})]",
    # CoralTemp is daily only: every 3rd day, averaged to a month in the build step.
    "sst": NOAA + "/noaacrwsstDaily.nc?analysed_sst[({t0}T12:00:00Z):3:({t1}T12:00:00Z)]"
    f"[({LAT0}):1:({LAT1})][({LON0}):1:({LON1})]",
}
STATIC = {
    "bathy": f"{IFREMER}/gebco2021.nc?elevation[({LAT0}):6:({LAT1})][({LON0}):6:({LON1})]",
}


def download(label: str, url: str, tries: int = 4) -> None:
    out = CACHE / f"{label}.nc"
    if out.exists():
        print(f"[skip] {out.name} already downloaded", flush=True)
        return
    for attempt in range(1, tries + 1):
        try:
            with requests.get(url, stream=True, timeout=(30, 600)) as r:
                if r.status_code != 200:
                    raise RuntimeError(f"HTTP {r.status_code}")
                tmp = out.with_suffix(".part")
                got = 0
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
                        got += len(chunk)
            tmp.replace(out)
            print(f"[done] {out.name} {got / 1e6:.1f} MB", flush=True)
            return
        except Exception as e:  # network or proxy error: back off and retry
            print(f"[retry {attempt}/{tries}] {label}: {e}", flush=True)
            time.sleep(5 * attempt)
    raise SystemExit(f"{label}: giving up after {tries} attempts")


def main() -> None:
    only = set(sys.argv[1:])
    for name, template in SERIES.items():
        if only and name not in only:
            continue
        for tag, t0, t1 in SST_CHUNKS if name == "sst" else CHUNKS:
            download(f"{name}_{tag}", template.format(t0=t0, t1=t1))
    for name, url in STATIC.items():
        if not only or name in only:
            download(name, url)


if __name__ == "__main__":
    main()
