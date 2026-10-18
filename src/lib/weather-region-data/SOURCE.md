# Weather region reference data

`regions.json` contains 3,836 administrative rows derived from the Korea Meteorological Administration's official `기상청41_단기예보 조회서비스_오픈API활용가이드_격자_위경도(2607).xlsx`. The official September 2026 guide ZIP includes this July 2026 workbook.

- Provider page: https://www.data.go.kr/data/15084084/openapi.do
- Official attachment: https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000007696658&fileDetailSn=1
- Retrieved: 2026-10-18
- Location release: 2026-07; includes the 2026-07-01 Incheon administrative reorganization.
- Workbook SHA-256: `746b5e5be10430106abccc795a16c16d0f1fd0f081e8ab2765d0adc983a003c1`.
- Format: `[administrativeCode, parentCode, name, latitude, longitude]`.
- Coordinates identify the weather reference point for each administrative area; they are not area boundaries or area averages.
- Two non-administrative Ieodo rows are excluded from the administrative selector. Offshore observations remain the responsibility of their separate marine datasets.
- The workbook contains the new Jeonnam-Gwangju integrated city and Incheon's Jemulpo, Yeongjong, Seohae and Geomdan districts. These names come from the official workbook rather than a hardcoded historic list.
- Attribution: Korea Meteorological Administration, public data attribution license (Korea Open Government License Type 1).

The hierarchy uses the workbook's three administrative name levels. It does not invent intermediate counties or infer borders from names. Refresh from the official attachment when KMA publishes a new location release.
