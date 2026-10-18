import type {Coordinates,MapFocus,MapPoint} from "@/components/KakaoMap";
import {projectWeatherCoordinate,type BoundaryProjection} from "./weather-boundaries";

export type CommunityBounds=[number,number,number,number];
const radians=Math.PI/180;
export function validCommunityBounds(value:unknown):value is CommunityBounds{return Array.isArray(value)&&value.length===4&&value.every(Number.isFinite)&&value[0]>=-180&&value[2]<=180&&value[1]>=-85&&value[3]<=85&&value[0]<value[2]&&value[1]<value[3];}
export function communityProjection(bounds:CommunityBounds,width:number,height:number):BoundaryProjection&{unproject:(x:number,y:number)=>Coordinates}{
  const northWest=projectWeatherCoordinate([bounds[0],bounds[3]]),southEast=projectWeatherCoordinate([bounds[2],bounds[1]]),w=Math.max(1,width),h=Math.max(1,height),spanX=southEast.x-northWest.x,spanY=southEast.y-northWest.y;
  return {bounds:{minX:northWest.x,minY:northWest.y,maxX:southEast.x,maxY:southEast.y},scale:w/spanX,project:coordinate=>{const p=projectWeatherCoordinate(coordinate);return {x:(p.x-northWest.x)/spanX*w,y:(p.y-northWest.y)/spanY*h};},unproject:(x,y)=>({lng:(northWest.x+x/w*spanX)/radians,lat:(2*Math.atan(Math.exp(-(northWest.y+y/h*spanY)))-Math.PI/2)/radians})};
}
function bounded(bounds:CommunityBounds):CommunityBounds{
  const width=Math.max(.00005,Math.min(170,bounds[2]-bounds[0])),height=Math.max(.00005,Math.min(150,bounds[3]-bounds[1]));
  const lng=Math.max(-180+width/2,Math.min(180-width/2,(bounds[0]+bounds[2])/2)),lat=Math.max(-85+height/2,Math.min(85-height/2,(bounds[1]+bounds[3])/2));
  return [lng-width/2,lat-height/2,lng+width/2,lat+height/2];
}
export function initialCommunityBounds(points:MapPoint[]=[],center?:Coordinates|null,focus?:MapFocus|null):CommunityBounds{
  if(focus?.radiusMeters){const d=focus.radiusMeters/111195.08,x=d/Math.max(.01,Math.cos(focus.location.lat*radians));return bounded([focus.location.lng-x,focus.location.lat-d,focus.location.lng+x,focus.location.lat+d]);}
  const positions=focus?.locations?.length?focus.locations:points.length?points.map(point=>point.location):[focus?.location??center??{lat:37.5665,lng:126.978}];
  const lats=positions.map(p=>p.lat),lngs=positions.map(p=>p.lng),lat=(Math.min(...lats)+Math.max(...lats))/2,lng=(Math.min(...lngs)+Math.max(...lngs))/2;
  const height=Math.max(.012,(Math.max(...lats)-Math.min(...lats))*1.35),width=Math.max(.014,(Math.max(...lngs)-Math.min(...lngs))*1.35);
  return bounded([lng-width/2,lat-height/2,lng+width/2,lat+height/2]);
}
export function panCommunityBounds(bounds:CommunityBounds,dx:number,dy:number,width:number,height:number):CommunityBounds{
  const projection=communityProjection(bounds,width,height),sw=projection.unproject(-dx,height-dy),ne=projection.unproject(width-dx,-dy);return bounded([sw.lng,sw.lat,ne.lng,ne.lat]);
}
export function centerCommunityBounds(bounds:CommunityBounds,location:Coordinates):CommunityBounds{const width=bounds[2]-bounds[0],height=bounds[3]-bounds[1];return bounded([location.lng-width/2,location.lat-height/2,location.lng+width/2,location.lat+height/2]);}
export function zoomCommunityBounds(bounds:CommunityBounds,factor:number,x:number,y:number,width:number,height:number):CommunityBounds{
  const projection=communityProjection(bounds,width,height),sw=projection.unproject(x+(0-x)/factor,y+(height-y)/factor),ne=projection.unproject(x+(width-x)/factor,y+(0-y)/factor);return bounded([sw.lng,sw.lat,ne.lng,ne.lat]);
}
export function pointWithinCommunityBounds(location:Coordinates,bounds:CommunityBounds){return location.lng>=bounds[0]&&location.lng<=bounds[2]&&location.lat>=bounds[1]&&location.lat<=bounds[3];}
