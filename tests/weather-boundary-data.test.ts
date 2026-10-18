import {readFile} from "node:fs/promises";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {NextRequest} from "next/server";
import index from "../src/lib/weather-boundary-data/index.json";
import metadata from "../src/lib/weather-boundary-data/source.json";
import {weatherRegion,weatherRegionChildren} from "../src/lib/weather-regions";
import {clearWeatherBoundaryCacheForTests,getWeatherBoundaries} from "../src/server/services/weather-boundaries";
import {GET} from "../src/app/api/v1/weather/boundaries/route";
import type {WeatherBoundaryFeature} from "../src/domain/weather-boundaries";

afterEach(clearWeatherBoundaryCacheForTests);
describe("published administrative boundaries",()=>{
  it("serves all eleven current Incheon districts without adding the city-wide value",async()=>{
    const result=await getWeatherBoundaries("2800000000");
    expect(result.features.map(feature=>feature.id).sort()).toEqual(weatherRegionChildren("2800000000").map(region=>region.id).sort());
    expect(result.features.map(feature=>feature.name)).toEqual(expect.arrayContaining(["제물포구","영종구","서해구","검단구","연수구"]));
    expect(result.features).toHaveLength(11);expect(result.missingIds).toEqual([]);
    expect(result.features.some(feature=>feature.id==="2800000000")).toBe(false);
    expect(result.source).toContain("SGIS");expect(result.source).toContain("vuski/admdongkor");expect(result.updatedAt).toBe("2026-07-01");
  });
  it("serves a district's dongs and a single dong without changing their identity",async()=>{
    const district=await getWeatherBoundaries("2818500000");
    expect(district.features.map(feature=>feature.id).sort()).toEqual(weatherRegionChildren("2818500000").map(region=>region.id).sort());
    const selected=district.features.find(feature=>feature.name==="송도1동")!;
    const dong=await getWeatherBoundaries(selected.id);
    expect(dong.features).toEqual([selected]);expect(dong.missingIds).toEqual([]);
    const sejong=await getWeatherBoundaries("3600000000");expect(sejong.features[0].id).toBe("3611000000");
  });
  it("reports unavailable geometry explicitly rather than renaming or inventing polygons",async()=>{
    expect(index.missingIds).toHaveLength(8);
    const anyang=await getWeatherBoundaries("4117100000");
    expect(anyang.missingIds).toEqual(["4117158000","4117158100"]);
    expect(anyang.features.some(feature=>["4117158200","4117158300"].includes(feature.id))).toBe(false);
    const missing=await getWeatherBoundaries("4794033000");expect(missing.features).toEqual([]);expect(missing.missingIds).toEqual(["4794033000"]);
  });
  it("validates regions before touching file paths and returns a public read-only endpoint",async()=>{
    await expect(getWeatherBoundaries("../../.env.local")).rejects.toMatchObject({status:422});
    await expect(getWeatherBoundaries("9999999999")).rejects.toMatchObject({status:404});
    const response=await GET(new NextRequest("http://localhost/api/v1/weather/boundaries?regionId=2800000000"));
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect((await response.json()).data.features).toHaveLength(11);
    const invalid=await GET(new NextRequest("http://localhost/api/v1/weather/boundaries"));expect(invalid.status).toBe(422);
  });
  it("ships bounded, closed WGS84 geometries for every matched region with documented omissions",async()=>{
    expect(index.cities).toHaveLength(16);expect(index.districts).toHaveLength(256);
    let bytes=0;const seen=new Set<string>();
    for(const [kind,ids] of [["cities",index.cities],["districts",index.districts]] as const){
      for(const id of ids){
        const text=await readFile(path.join(process.cwd(),"src/lib/weather-boundary-data",kind,`${id}.json`),"utf8");bytes+=Buffer.byteLength(text);
        expect(Buffer.byteLength(text)).toBeLessThan(350_000);
        const bundle=JSON.parse(text) as {self?:WeatherBoundaryFeature;features:WeatherBoundaryFeature[]};
        for(const feature of [...bundle.features,...(bundle.self?[bundle.self]:[])]){
          seen.add(feature.id);expect(weatherRegion(feature.id)?.name).toBe(feature.name);
          expect(feature.label.every(Number.isFinite)).toBe(true);
          const polygons=feature.geometry.type==="Polygon"?[feature.geometry.coordinates]:feature.geometry.coordinates;
          for(const polygon of polygons)for(const ring of polygon){
            if(ring.length<4||JSON.stringify(ring[0])!==JSON.stringify(ring.at(-1)))throw new Error(`Unclosed ring: ${feature.id}`);
            for(const [lng,lat] of ring)if(!Number.isFinite(lng)||!Number.isFinite(lat)||lng<123||lng>133||lat<32||lat>40)throw new Error(`Invalid coordinate: ${feature.id}`);
          }
        }
      }
    }
    expect(seen.size).toBe(3812);expect(bytes).toBeLessThan(8_000_000);
    expect(metadata.coverage.matchedDongs).toBe(3556);expect(metadata.license).toContain("KOGL Type 1");
    for(const missing of index.missingIds)expect(seen.has(missing)).toBe(false);
  });
});
