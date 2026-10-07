"""Download monthly CMEMS fields for Sri Lankan waters into pipeline/cache/*.nc.

Requires `pip install copernicusmarine` and a prior `copernicusmarine login`.
Re-running skips files that already exist, so it is safe to resume.
"""
from pathlib import Path

import copernicusmarine as cm

CACHE = Path(__file__).parent / "cache"
CACHE.mkdir(exist_ok=True)

# Covers the Sri Lanka EEZ (roughly 4-11N, 76-86E) with a margin.
BBOX = dict(
    minimum_longitude=75.0,
    maximum_longitude=87.0,
    minimum_latitude=3.0,
    maximum_latitude=12.0,
)
START = "2012-01-01T00:00:00"
END = "2014-12-31T00:00:00"
MAX_DEPTH = 320.0  # metres; deeper than this is irrelevant for pelagic habitat

JOBS = {
    "bgc": (
        "cmems_mod_glo_bgc_my_0.25deg_P1M-m",
        ["o2", "chl", "nppv", "ph", "no3", "po4"],
    ),
    "phy": (
        "cmems_mod_glo_phy_my_0.083deg_P1M-m",
        ["thetao", "so", "uo", "vo", "mlotst"],
    ),
}


def main() -> None:
    for name, (dataset_id, variables) in JOBS.items():
        out = CACHE / f"{name}.nc"
        if out.exists():
            print(f"[skip] {out.name} already downloaded")
            continue
        print(f"[fetch] {dataset_id} -> {out.name} ({', '.join(variables)})", flush=True)
        cm.subset(
            dataset_id=dataset_id,
            variables=variables,
            minimum_depth=0.0,
            maximum_depth=MAX_DEPTH,
            start_datetime=START,
            end_datetime=END,
            output_filename=out.name,
            output_directory=str(CACHE),
            overwrite=True,
            **BBOX,
        )
        print(f"[done] {out.name} {out.stat().st_size / 1e6:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
