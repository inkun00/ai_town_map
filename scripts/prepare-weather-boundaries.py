"""Prepare compact, attributed weather-map boundaries from a pinned public release.

Preparation only: pyarrow and shapely are not application/runtime dependencies.
See src/lib/weather-boundary-data/README.md for installation and usage.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
COMMIT = "d5d5a821c8de6cc337d47eeca604d7af76271c9b"
RELEASE = "20260701"
PREPARED_AT = "2026-10-18"
BASE_URL = f"https://raw.githubusercontent.com/vuski/admdongkor/{COMMIT}"
ARTIFACTS = {
    "emd": ("parquet/simplified/emd_20260701_light.parquet", "744e345cb46787a1662bcdf3a63e6c58f4312ecaa160eb1c2dce839e68876598"),
    "sgg": ("parquet/simplified/sgg_20260701_light.parquet", "785fae7e421fa657ad77489f5631b54e94f2b540a1f4739b64100ebc1ff3e4bc"),
    "sido": ("parquet/simplified/sido_20260701_light.parquet", "4948905c12ffaa9e2c3d3e679f4b74185a7f1453f3b61d70e947f6655e56844d"),
    "license": ("LICENSE-DATA", "d892791d5ba176e3bb7cc178937b26d3b33e2ad19da581af168c9e48428ba507"),
}
ATTRIBUTION = (
    "본 데이터는 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr)에서 "
    "공공누리 제1유형으로 개방한 행정동 경계를 가공한 것이며(가공: vuski/admdongkor, "
    "https://github.com/vuski/admdongkor), CC BY 4.0으로 배포됩니다."
)


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-cache", type=Path, default=ROOT / "outputs/weather-boundaries-research")
    parser.add_argument("--python-packages", type=Path, help="Optional preparation-only pyarrow/shapely installation directory")
    parser.add_argument("--output", type=Path, default=ROOT / "src/lib/weather-boundary-data")
    parser.add_argument("--offline", action="store_true", help="Use already downloaded, hash-verified source files only")
    args = parser.parse_args()
    if args.python_packages:
        sys.path.insert(0, str(args.python_packages.resolve()))

    import pyarrow.parquet as pq
    from shapely import from_wkb
    from shapely.geometry import mapping, shape

    args.source_cache.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    source_artifacts = []
    paths = {}
    for key, (relative, expected_hash) in ARTIFACTS.items():
        path = args.source_cache / Path(relative).name
        if not path.exists():
            if args.offline:
                raise ValueError(f"Missing cached source: {path}")
            request = urllib.request.Request(f"{BASE_URL}/{relative}", headers={"User-Agent": "map-of-all-boundary-preparation/1.0"})
            with urllib.request.urlopen(request, timeout=90) as response:
                path.write_bytes(response.read())
        data = path.read_bytes()
        actual_hash = hashlib.sha256(data).hexdigest()
        if actual_hash != expected_hash:
            raise ValueError(f"Source hash mismatch: {path.name}; expected {expected_hash}, received {actual_hash}")
        paths[key] = path
        source_artifacts.append({"file": relative, "url": f"{BASE_URL}/{relative}", "sha256": actual_hash, "bytes": len(data)})

    regions_path = ROOT / "src/lib/weather-region-data/regions.json"
    regions = json.loads(regions_path.read_text(encoding="utf-8"))
    by_id = {row[0]: row for row in regions}
    children = {}
    for region in regions:
        children.setdefault(region[1], []).append(region)
    cities = children[None]
    districts = [region for city in cities for region in children.get(city[0], [])]
    if len(cities) != 16 or len(districts) != 256:
        raise ValueError("KMA hierarchy changed; review source release and coverage before generating new assets")

    rows = {level: pq.read_table(paths[level]).to_pylist() for level in ["sido", "sgg", "emd"]}
    source_sido = {row["sidocd"]: row for row in rows["sido"]}
    source_sgg = {row["sggcd"]: row for row in rows["sgg"]}
    source_emd = {row["emdcd"]: row for row in rows["emd"]}
    precision_counts = {}

    def rounded(coordinates: object, precision: int) -> object:
        if isinstance(coordinates, (list, tuple)):
            return [rounded(value, precision) for value in coordinates]
        if not math.isfinite(coordinates):
            raise ValueError("Non-finite source coordinate")
        return round(coordinates, precision)

    def feature(region: list, source: dict) -> dict:
        original = from_wkb(source["geometry"])
        if original.geom_type not in {"Polygon", "MultiPolygon"} or original.is_empty or not original.is_valid:
            raise ValueError(f"Invalid source polygon: {region[0]}")
        # Keep the publisher's topology-preserving light polygons. Only coordinate
        # serialization is rounded; retain higher precision if rounding harms validity.
        original_mapping = mapping(original)
        for precision in [6, 7, 8, 9, 12, 15]:
            geometry = {"type": original_mapping["type"], "coordinates": rounded(original_mapping["coordinates"], precision)}
            candidate = shape(geometry)
            if candidate.is_valid and not candidate.is_empty and abs(candidate.area / original.area - 1) <= 0.001:
                break
        else:
            raise ValueError(f"Rounding would damage source polygon: {region[0]}")
        min_x, min_y, max_x, max_y = candidate.bounds
        if not (120 <= min_x <= max_x <= 140 and 30 <= min_y <= max_y <= 45):
            raise ValueError(f"Unexpected WGS84 extent: {region[0]}")
        largest = max(candidate.geoms, key=lambda item: item.area) if candidate.geom_type == "MultiPolygon" else candidate
        point = largest.representative_point()
        label = [round(point.x, 8), round(point.y, 8)]
        # Rounding a label near a very narrow coast must not move it outside land.
        if not candidate.covers(shape({"type": "Point", "coordinates": label})):
            label = [point.x, point.y]
        precision_counts[str(precision)] = precision_counts.get(str(precision), 0) + 1
        return {"id": region[0], "name": region[2], "geometry": geometry, "label": label}

    district_features = {}
    for region in districts:
        source = source_sgg.get(region[0][:5])
        if source is None:
            raise ValueError(f"Missing district polygon: {region[0]}")
        # Match exact codes and names; never relabel an old district with a new name.
        same_name = source["sggnm"].replace(" ", "") == region[2].replace(" ", "")
        # The source calls the Sejong lower-level entry "세종시" while KMA
        # repeats its full city name. Its exact MOIS code and city both agree.
        sejong_title_alias = region[0] == "3611000000" and source["sggnm"] == "세종시" and source["sidonm"] == region[2]
        if not same_name and not sejong_title_alias:
            raise ValueError(f"District name/code mismatch: {region[0]} {region[2]} vs {source['sggnm']}")
        district_features[region[0]] = feature(region, source)

    generated_paths = []
    missing_ids = []
    matched_dong_count = 0
    for region in districts:
        child_features = []
        child_missing = []
        for child in children.get(region[0], []):
            source = source_emd.get(child[0])
            if source is None:
                child_missing.append(child[0])
                continue
            if source["sggcd"] != region[0][:5]:
                raise ValueError(f"Dong parent mismatch: {child[0]}")
            child_features.append(feature(child, source))
        matched_dong_count += len(child_features)
        missing_ids.extend(child_missing)
        value = {"self": district_features[region[0]], "features": child_features, "missingIds": child_missing}
        path = args.output / "districts" / f"{region[0]}.json"
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(json_bytes(value))
        generated_paths.append(path)

    for region in cities:
        if region[0][:2] not in source_sido:
            raise ValueError(f"Missing source city: {region[0]}")
        features = [district_features[child[0]] for child in children.get(region[0], [])]
        path = args.output / "cities" / f"{region[0]}.json"
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(json_bytes({"features": features, "missingIds": []}))
        generated_paths.append(path)

    missing_ids.sort()
    coverage = {"cities": len(cities), "districts": len(districts), "matchedDongs": matched_dong_count, "missingDongs": len(missing_ids)}
    index = {"cities": [region[0] for region in cities], "districts": [region[0] for region in districts], "missingIds": missing_ids}
    (args.output / "index.json").write_bytes(json_bytes(index))
    source = {
        "schemaVersion": 1,
        "publisher": "vuski/admdongkor",
        "source": "SGIS 행정동 경계 가공 자료 · vuski/admdongkor · CC BY 4.0",
        "updatedAt": "2026-07-01",
        "preparedAt": PREPARED_AT,
        "release": RELEASE,
        "commit": COMMIT,
        "repositoryUrl": "https://github.com/vuski/admdongkor",
        "sourceArtifacts": source_artifacts,
        "kmaRegionsSha256": hashlib.sha256(regions_path.read_bytes()).hexdigest(),
        "coordinateSystem": "EPSG:4326",
        "license": "CC-BY-4.0; upstream SGIS KOGL Type 1 attribution retained",
        "attribution": ATTRIBUTION,
        "notice": "행정동 변경 이력을 반영한 민간 가공 참고 경계이며 정부가 직접 제공한 최신 법정경계나 측량용 경계가 아닙니다.",
        "transformations": ["Publisher light polygon release; no invented or Voronoi boundaries", "Exact administrative code matching; no replacement geometry for unmatched KMA codes", "Coordinate rounding with validity and area checks", "Interior label on the largest polygon of each region"],
        "coordinatePrecisionCounts": precision_counts,
        "coverage": coverage,
        "missingRegions": [{"id": identifier, "name": by_id[identifier][2], "parentId": by_id[identifier][1]} for identifier in missing_ids],
    }
    (args.output / "source.json").write_bytes(json_bytes(source))
    (args.output / "LICENSE-DATA").write_bytes(paths["license"].read_bytes())
    total_bytes = sum(path.stat().st_size for path in generated_paths)
    largest_path = max(generated_paths, key=lambda path: path.stat().st_size)
    print(json.dumps({"coverage": coverage, "files": len(generated_paths), "assetBytes": total_bytes, "largestAsset": str(largest_path.relative_to(args.output)), "largestAssetBytes": largest_path.stat().st_size, "missingIds": missing_ids}, ensure_ascii=False))


if __name__ == "__main__":
    main()
