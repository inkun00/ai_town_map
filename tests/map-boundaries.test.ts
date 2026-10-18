import {readFile} from "node:fs/promises";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {NextRequest} from "next/server";
import {clearMapBoundaryCacheForTests,getMapBoundaries,parseMapBounds} from "../src/server/services/map-boundaries";
import {GET} from "../src/app/api/v1/map-boundaries/route";
import type {WeatherBoundaryFeature} from "../src/domain/weather-boundaries";

afterEach(clearMapBoundaryCacheForTests);

describe("public spatial administrative boundaries",()=>{
  it("validates ordered, finite WGS84 bounds before reading asset paths",async()=>{
    expect(parseMapBounds(" 126.5, 37.2, 127, 37.8 ")).toEqual([126.5,37.2,127,37.8]);
    for(const value of [null,undefined,{},"","../../.env.local","126,37,127","126,,127,38","NaN,37,127,38","126,37,Infinity,38","181,37,182,38","126,-91,127,38","126,37,127,91","127,37,126,38","126,38,127,37","126,37,126,38"]){
      await expect(getMapBoundaries(value)).rejects.toMatchObject({status:422,code:"MAP_BOUNDS_INVALID"});
    }
  });
  it("serves all 256 actual district polygons for a nationwide view",async()=>{
    const data=await getMapBoundaries("120,30,140,45");
    expect(data.level).toBe("district");expect(data.features).toHaveLength(256);expect(data.missingIds).toEqual([]);
    expect(data.features.map(feature=>feature.name)).toEqual(expect.arrayContaining(["제물포구","영종구","서해구","검단구"]));
    expect(new Set(data.features.map(feature=>feature.id)).size).toBe(256);
    expect(data.source).toContain("SGIS");expect(data.updatedAt).toBe("2026-07-01");
    expect(Buffer.byteLength(JSON.stringify(data))).toBeLessThan(3_000_000);
  });
  it("returns a limited set of dong polygons for a close neighborhood view",async()=>{
    const data=await getMapBoundaries("126.62,37.37,126.68,37.42");
    expect(data.level).toBe("dong");expect(data.features.length).toBeGreaterThan(0);expect(data.features.length).toBeLessThan(40);
    expect(data.features.some(feature=>feature.name==="송도1동")).toBe(true);
    expect(data.features.every(feature=>!feature.id.endsWith("00000"))).toBe(true);
  });
  it("falls back to district geometry when a narrow urban view matches more than eight districts",async()=>{
    const data=await getMapBoundaries("126.9,37.45,127.15,37.7");
    expect(data.level).toBe("district");expect(data.features.length).toBeGreaterThan(8);expect(data.features.every(feature=>feature.id.endsWith("00000"))).toBe(true);
  });
  it("preserves island polygons and interior rings exactly instead of drawing substitute shapes",async()=>{
    const city=JSON.parse(await readFile(path.join(process.cwd(),"src/lib/weather-boundary-data/cities/2800000000.json"),"utf8")) as {features:WeatherBoundaryFeature[]};
    const original=city.features.find(feature=>feature.name==="옹진군")!;
    const data=await getMapBoundaries("120,30,140,45");expect(data.features.find(feature=>feature.id===original.id)).toEqual(original);
    expect(original.geometry.type).toBe("MultiPolygon");
  });
  it("reports unmatched KMA leaf codes without silently assigning renamed dong polygons",async()=>{
    const data=await getMapBoundaries("126.90,37.37,126.96,37.40");
    expect(data.level).toBe("dong");expect(data.missingIds.sort()).toEqual(["4117158000","4117158100"]);
    expect(data.features.some(feature=>["4117158200","4117158300"].includes(feature.id))).toBe(false);
  });
  it("accepts large WGS84 views and returns empty data outside the supported area",async()=>{
    expect((await getMapBoundaries("-180,-90,180,90")).features).toHaveLength(256);
    expect(await getMapBoundaries("0,0,1,1")).toMatchObject({features:[],missingIds:[],level:"district"});
  });
  it("coalesces equal concurrent lookups and bounds the final result cache",async()=>{
    const same=await Promise.all(Array.from({length:5},()=>getMapBoundaries("126.62,37.37,126.68,37.42")));
    expect(same.every(value=>value===same[0])).toBe(true);
    const first=await getMapBoundaries("120,30,140,45");
    for(let i=1;i<=33;i++)await getMapBoundaries(`${120+i*.001},30,140,45`);
    expect(await getMapBoundaries("120,30,140,45")).not.toBe(first);
  });
  it("exposes a public read-only route with bounded input errors and cache headers",async()=>{
    const response=await GET(new NextRequest("http://localhost/api/v1/map-boundaries?bounds=126.62,37.37,126.68,37.42"));
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect((await response.json()).data.level).toBe("dong");
    const invalid=await GET(new NextRequest("http://localhost/api/v1/map-boundaries?bounds=invalid"));expect(invalid.status).toBe(422);expect((await invalid.json()).error.code).toBe("MAP_BOUNDS_INVALID");
    expect((await GET(new NextRequest("http://localhost/api/v1/map-boundaries"))).status).toBe(422);
  });
});
