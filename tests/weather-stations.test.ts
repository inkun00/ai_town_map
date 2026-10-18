import { describe, expect, it } from "vitest";
import { WEATHER_STATION_REFERENCE_DATE, WEATHER_STATION_REFERENCE_SOURCE, weatherStationReference } from "@/lib/weather-stations";
import history from "@/lib/weather-station-data/asos-history.json";
import source from "@/lib/weather-station-data/source.json";

describe("official KMA ASOS station reference", () => {
  it("covers every ASOS station in the 2026-10-18 live observation response exactly once", () => {
    // Independently cross-checked against kma_sfctm2.php's complete STN column on the retrieval date.
    const liveIds = "90,93,95,98,99,100,101,102,104,105,106,108,112,114,115,119,121,127,129,130,131,133,135,136,137,138,140,143,146,152,155,156,159,162,165,168,169,170,172,174,177,181,184,185,188,189,192,201,202,203,211,212,216,217,221,226,232,235,236,238,239,243,244,245,247,248,251,252,253,254,255,257,258,259,260,261,262,263,264,266,268,271,272,273,276,277,278,279,281,283,284,285,288,289,294,295,296".split(",");
    const stations = weatherStationReference("2026-10-18");
    expect(stations.map((station) => station.id)).toEqual(liveIds);
    expect(new Set(stations.map((station) => station.id)).size).toBe(97);
    for (const station of stations) {
      expect(station.name).not.toBe("");
      expect(station.lat).toBeGreaterThan(32);
      expect(station.lat).toBeLessThan(40);
      expect(station.lng).toBeGreaterThan(123);
      expect(station.lng).toBeLessThan(133);
    }
  });
  it("uses the documented date-specific coordinates, including transition days", () => {
    expect(weatherStationReference("2013-10-21").find((station) => station.id === "112")).toMatchObject({ name: "인천", lat: 37.4776, lng: 126.6244 });
    expect(weatherStationReference("2013-10-22").find((station) => station.id === "112")).toMatchObject({ name: "인천", lat: 37.4777, lng: 126.6249 });
    expect(weatherStationReference("2017-08-24").find((station) => station.id === "143")?.lat).toBe(35.8282);
    expect(weatherStationReference("2017-08-25").find((station) => station.id === "143")?.lat).toBe(35.878);
  });
  it("does not extend stations before their first or after their final documented date", () => {
    expect(weatherStationReference("2016-09-30").some((station) => station.id === "93")).toBe(false);
    expect(weatherStationReference("2016-10-01").some((station) => station.id === "93")).toBe(true);
    expect(weatherStationReference("1989-01-01").some((station) => station.id === "116")).toBe(true);
    expect(weatherStationReference("1991-01-01").some((station) => station.id === "116")).toBe(false);
    expect(weatherStationReference("1900-01-01")).toEqual([]);
  });
  it("retains attributable provenance and rejects malformed calendar dates", () => {
    expect(WEATHER_STATION_REFERENCE_DATE).toBe("2026-10-18");
    expect(WEATHER_STATION_REFERENCE_SOURCE).toContain("기상청");
    expect(source.downloadUrl).toContain("mddlClssCd=SFC01");
    expect(source.license).toContain("제1유형");
    expect(source.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.rowCount).toBe(history.length);
    for (const value of ["", "2026-02-30", "20261018", "2026-10-18T00:00:00Z"]) expect(() => weatherStationReference(value)).toThrow(RangeError);
  });
  it("returns detached station records so consumers cannot change the reference", () => {
    const stations = weatherStationReference("2026-10-18");
    stations[0].name = "changed";
    expect(weatherStationReference("2026-10-18")[0].name).toBe("속초");
  });
});
