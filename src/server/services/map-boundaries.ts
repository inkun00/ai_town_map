import "server-only";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {ApiError} from "@/server/http";
import {weatherRegion} from "@/lib/weather-regions";
import index from "@/lib/weather-boundary-data/index.json";
import metadata from "@/lib/weather-boundary-data/source.json";
import type {WeatherBoundaryFeature,WeatherBoundaryResult} from "@/domain/weather-boundaries";

/** Longitude/latitude bounds, in west, south, east, north order. */
export type MapBounds=readonly [number,number,number,number];
export type MapBoundaryResult=WeatherBoundaryResult&{level:"district"|"dong"};
type SpatialFeature={feature:WeatherBoundaryFeature;boxes:MapBounds[]};
type BoundaryBundle={features:WeatherBoundaryFeature[];missingIds?:string[]};
type SpatialBundle={features:SpatialFeature[];missingIds:string[]};

const datasetBounds:MapBounds=[120,30,140,45];
const resultLimit=32,resultByteLimit=24*1024*1024,districtLimit=16,pendingLimit=64;
const districtCache=new Map<string,Promise<SpatialBundle>>();
const results=new Map<string,{result:MapBoundaryResult;bytes:number}>();
const pending=new Map<string,Promise<MapBoundaryResult>>();
let catalog:Promise<SpatialFeature[]>|undefined,resultBytes=0;

export function parseMapBounds(input:unknown):MapBounds{
  if(typeof input!=="string"||input.length>160)throw invalidBounds();
  const pieces=input.split(",").map(piece=>piece.trim());
  if(pieces.length!==4||pieces.some(piece=>!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(piece)))throw invalidBounds();
  const values=pieces.map(Number),[west,south,east,north]=values;
  if(values.some(value=>!Number.isFinite(value))||west< -180||east>180||south< -90||north>90||west>=east||south>=north)throw invalidBounds();
  return [west,south,east,north];
}
function invalidBounds(){return new ApiError(422,"MAP_BOUNDS_INVALID","지도의 영역을 확인해 주세요. 경도·위도 범위가 올바르지 않아요.");}
function unavailable(){return new ApiError(503,"MAP_BOUNDARIES_UNAVAILABLE","행정구역 경계를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");}
function intersect(a:MapBounds,b:MapBounds):MapBounds|null{
  const west=Math.max(a[0],b[0]),south=Math.max(a[1],b[1]),east=Math.min(a[2],b[2]),north=Math.min(a[3],b[3]);
  return west<=east&&south<=north?[west,south,east,north]:null;
}
function spatialFeature(feature:WeatherBoundaryFeature):SpatialFeature{
  const polygons=feature.geometry.type==="Polygon"?[feature.geometry.coordinates]:feature.geometry.coordinates;
  const boxes=polygons.map(polygon=>{
    let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
    for(const [lng,lat] of polygon[0]){west=Math.min(west,lng);south=Math.min(south,lat);east=Math.max(east,lng);north=Math.max(north,lat);}
    return [west,south,east,north] as MapBounds;
  });
  return {feature,boxes};
}
function visible(feature:SpatialFeature,bounds:MapBounds){return feature.boxes.some(box=>intersect(box,bounds)!==null);}
async function readBundle(kind:"cities"|"districts",id:string):Promise<SpatialBundle>{
  try{
    const text=await readFile(path.join(process.cwd(),"src/lib/weather-boundary-data",kind,`${id}.json`),"utf8");
    const data=JSON.parse(text) as BoundaryBundle;
    if(!Array.isArray(data.features))throw new Error("Invalid boundary bundle");
    return {features:data.features.map(spatialFeature),missingIds:data.missingIds??[]};
  }catch{throw unavailable();}
}
function districtCatalog():Promise<SpatialFeature[]>{
  if(catalog)return catalog;
  // Every district polygon is read once from sixteen city bundles. Per-polygon
  // extents keep remote islands from making the entire sea match one district.
  const task=Promise.all(index.cities.map(id=>readBundle("cities",id))).then(bundles=>bundles.flatMap(bundle=>bundle.features));
  catalog=task;void task.catch(()=>{if(catalog===task)catalog=undefined;});return task;
}
function districtBundle(id:string):Promise<SpatialBundle>{
  const cached=districtCache.get(id);
  if(cached){districtCache.delete(id);districtCache.set(id,cached);return cached;}
  const task=readBundle("districts",id);districtCache.set(id,task);
  if(districtCache.size>districtLimit)districtCache.delete(districtCache.keys().next().value!);
  void task.catch(()=>{if(districtCache.get(id)===task)districtCache.delete(id);});return task;
}
function result(features:WeatherBoundaryFeature[],level:MapBoundaryResult["level"],missingIds:string[]=[]):MapBoundaryResult{
  return {features,source:metadata.source,updatedAt:metadata.updatedAt,missingIds,level};
}
async function collect(bounds:MapBounds,original:MapBounds):Promise<MapBoundaryResult>{
  const districts=(await districtCatalog()).filter(feature=>visible(feature,bounds));
  const narrow=original[2]-original[0]<=.25&&original[3]-original[1]<=.25;
  if(!narrow||districts.length>8)return result(districts.map(item=>item.feature),"district");
  const bundles=await Promise.all(districts.map(item=>districtBundle(item.feature.id)));
  const features=bundles.flatMap(bundle=>bundle.features.filter(feature=>visible(feature,bounds)).map(item=>item.feature));
  // Missing geometry has no spatial extent. Its official KMA reference point
  // can flag the omission, but is never converted into an invented boundary.
  const missingIds=bundles.flatMap(bundle=>bundle.missingIds).filter(id=>{
    const region=weatherRegion(id);return region&&region.lng>=bounds[0]&&region.lng<=bounds[2]&&region.lat>=bounds[1]&&region.lat<=bounds[3];
  });
  return result(features,"dong",[...new Set(missingIds)]);
}

/** Read-only spatial lookup; real polygons, holes and island coordinates stay intact. */
export async function getMapBoundaries(input:unknown):Promise<MapBoundaryResult>{
  const original=parseMapBounds(input),bounds=intersect(original,datasetBounds);
  if(!bounds)return result([],"district");
  const key=original.join(","),cached=results.get(key);
  if(cached){results.delete(key);results.set(key,cached);return cached.result;}
  if(pending.has(key))return pending.get(key)!;
  if(pending.size>=pendingLimit)throw new ApiError(429,"MAP_BOUNDARIES_BUSY","경계 자료 요청이 많아요. 잠시 후 다시 시도해 주세요.");
  const task=collect(bounds,original).then(value=>{
    const bytes=Buffer.byteLength(JSON.stringify(value));
    if(bytes<=resultByteLimit){
      results.set(key,{result:value,bytes});resultBytes+=bytes;
      while(results.size>resultLimit||resultBytes>resultByteLimit){const oldest=results.keys().next().value!;resultBytes-=results.get(oldest)!.bytes;results.delete(oldest);}
    }
    return value;
  });
  pending.set(key,task);
  try{return await task;}finally{if(pending.get(key)===task)pending.delete(key);}
}

export function clearMapBoundaryCacheForTests(){catalog=undefined;districtCache.clear();results.clear();pending.clear();resultBytes=0;}
