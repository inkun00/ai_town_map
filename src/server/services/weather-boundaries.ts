import "server-only";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {ApiError} from "@/server/http";
import {weatherRegion,weatherRegionChildren} from "@/lib/weather-regions";
import type {WeatherBoundaryFeature,WeatherBoundaryResult} from "@/domain/weather-boundaries";
import metadata from "@/lib/weather-boundary-data/source.json";

type BoundaryBundle={self?:WeatherBoundaryFeature;features:WeatherBoundaryFeature[]};
const cache=new Map<string,Promise<BoundaryBundle>>();

async function bundle(kind:"cities"|"districts",id:string):Promise<BoundaryBundle>{
  const key=`${kind}/${id}`;
  if(cache.has(key))return cache.get(key)!;
  const task=(async()=>{
    try{
      const text=await readFile(path.join(process.cwd(),"src/lib/weather-boundary-data",kind,`${id}.json`),"utf8");
      const value=JSON.parse(text) as BoundaryBundle;
      if(!Array.isArray(value.features))throw new Error("Invalid boundary bundle");
      return value;
    }catch{
      cache.delete(key);
      throw new ApiError(503,"WEATHER_BOUNDARIES_UNAVAILABLE","행정구역 경계를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  })();
  if(cache.size>=24)cache.delete(cache.keys().next().value!);
  cache.set(key,task);
  return task;
}

/** Geometry follows the same administrative release as the weather selector. */
export async function getWeatherBoundaries(input:unknown):Promise<WeatherBoundaryResult>{
  if(typeof input!=="string"||!/^\d{10}$/.test(input))throw new ApiError(422,"WEATHER_REGION_INVALID","날씨 지역을 선택해 주세요.");
  const region=weatherRegion(input);
  if(!region)throw new ApiError(404,"WEATHER_REGION_NOT_FOUND","날씨 지역을 찾을 수 없습니다.");
  const children=weatherRegionChildren(region.id);
  const expected=children.length?children:[region];
  const allowed=new Set(expected.map(item=>item.id));
  const data=await bundle(region.level==="city"?"cities":"districts",region.level==="dong"?region.parentId!:region.id);
  const candidates=region.level==="district"&&!children.length&&data.self?[data.self]:data.features;
  const features=candidates.filter(feature=>allowed.has(feature.id));
  const available=new Set(features.map(feature=>feature.id));
  return {features,source:metadata.source,updatedAt:metadata.updatedAt,missingIds:expected.filter(item=>!available.has(item.id)).map(item=>item.id)};
}

export function clearWeatherBoundaryCacheForTests(){cache.clear();}
