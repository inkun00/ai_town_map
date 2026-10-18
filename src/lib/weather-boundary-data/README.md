# Weather outline reference boundaries

These assets are reference administrative polygons for the weather map's outline mode. They are derived from the public `vuski/admdongkor` release `20260701`, pinned to commit `d5d5a821c8de6cc337d47eeca604d7af76271c9b`. The publisher updates SGIS administrative-dong boundaries using administrative change history. These are processed reference boundaries, not a government-certified current cadastral or surveying dataset.

- Publisher and change history: https://github.com/vuski/admdongkor/tree/d5d5a821c8de6cc337d47eeca604d7af76271c9b
- Dataset license: https://github.com/vuski/admdongkor/blob/d5d5a821c8de6cc337d47eeca604d7af76271c9b/LICENSE-DATA
- Original government boundary provider: https://sgis.mods.go.kr/view/pss/openDataIntrcn
- Region hierarchy and weather reference coordinates: `../weather-region-data/SOURCE.md`
- Boundary effective date: 2026-07-01.
- Downloaded and prepared: 2026-10-18.
- Coordinates: WGS84, EPSG:4326, longitude before latitude.

The July release matches the application's KMA July 2026 region hierarchy. It includes Incheon's Jemulpo, Yeongjong, Seohae and Geomdan district reorganization and the Jeonnam-Gwangju integrated city. A later October publisher release exists, but its subsequent Sejong and Daegu changes do not match this KMA hierarchy snapshot.

## Files and matching

- `index.json`: the 16 city and 256 district bundle IDs, plus explicitly unavailable KMA leaf IDs.
- `cities/<cityId>.json`: the selected city's immediate district polygons.
- `districts/<districtId>.json`: the district's own polygon, available immediate dong polygons and unavailable leaf IDs.
- `source.json`: exact public URLs, pinned revision, source SHA-256 values, transformation details and coverage.
- `LICENSE-DATA`: the publisher's unmodified data license and required upstream attribution.

Each feature contains `{ id, name, geometry, label }`. IDs match the KMA hierarchy's ten-digit administrative codes. `geometry` is a real Polygon or MultiPolygon, including interior rings. `label` is an interior point on the region's largest polygon; it is not the weather station position or a fabricated district location.

SGG source `sggcd` values are the five-digit MOIS codes, and EMD source `emdcd` values are ten-digit MOIS codes. The application pads SGG codes with five zeroes. District names and codes are checked before generation. One explicit naming alias exists: the source's `세종시` lower-level entry and KMA's `세종특별자치시` both identify code `3611000000` under the same Sejong city.

Coverage is 256 district polygons and 3,556 matching dong polygons. Eight KMA leaf IDs have no exact matching source feature:

| KMA ID | KMA name | Reason |
| --- | --- | --- |
| 4117158000 | 안양8동 | Publisher changed to 명학동, with a different code; no silent remapping. |
| 4117158100 | 안양9동 | Publisher changed to 병목안동, with a different code; no silent remapping. |
| 4794033000 | 독도 | No separate source feature; source includes these islands within 울릉읍. |
| 5178034000 | 근동면 | No matching source feature. |
| 5178035000 | 원동면 | No matching source feature. |
| 5178036000 | 원남면 | No matching source feature. |
| 5178037000 | 임남면 | No matching source feature. |
| 5182034000 | 수동면 | No matching source feature. |

Missing leaf geometries remain unavailable. They are not replaced with Voronoi cells, boxes, circles or old boundaries with new names. District geometry comes directly from the publisher's district file, not from unions of the matched KMA children; this retains source district coverage even where a KMA child is unavailable.

## Preparation

The application needs no Python packages or network requests to the publisher at runtime. Bundle JSON is read on demand for the requested region; do not import every region into the browser bundle.

Preparation requires Python 3.11 or newer, `pyarrow` and `shapely`. An isolated preparation-only package directory keeps these outside application dependencies:

```powershell
python -m pip install --target outputs/weather-boundaries-research/python pyarrow==21.0.0 shapely==2.1.2
python scripts/prepare-weather-boundaries.py --python-packages outputs/weather-boundaries-research/python
```

Use the same Python executable for installation and preparation. For the Codex bundled Python, substitute the runtime path returned by `load_workspace_dependencies`. `--offline` uses cached source files and still verifies every SHA-256. `--output` can generate a second directory for reproducibility checks.

The script verifies pinned source hashes, WGS84 extents, polygon validity, administrative codes and names, and interior labels. It retains the publisher's topology-preserving light release. Coordinate serialization normally uses six decimals; higher precision is retained when rounding would invalidate a polygon or change its area by more than 0.1%. No invented geometry or additional simplification is applied.

The 272 generated region JSON files total approximately 7 MB. A request needs only its selected bundle; the largest bundle is approximately 319 KB before HTTP compression.

## Attribution

The publisher's modifications use CC BY 4.0. Upstream SGIS attribution under KOGL Type 1 remains required. Preserve `LICENSE-DATA` when redistributing and show the source in the map UI.

> 본 데이터는 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr)에서 공공누리 제1유형으로 개방한 행정동 경계를 가공한 것이며(가공: vuski/admdongkor, https://github.com/vuski/admdongkor), CC BY 4.0으로 배포됩니다.

The required full attribution is also stored in `source.json`; a linked compact source label may open this information.
