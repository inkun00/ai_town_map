export type WeatherBoundaryGeometry={type:"Polygon";coordinates:number[][][]}|{type:"MultiPolygon";coordinates:number[][][][]};
export type WeatherBoundaryFeature={id:string;name:string;geometry:WeatherBoundaryGeometry;label:[number,number]};
export type WeatherBoundaryResult={features:WeatherBoundaryFeature[];source:string;updatedAt:string;missingIds:string[]};
export type BoundaryPoint={x:number;y:number};
export type BoundaryProjection={project:(coordinate:readonly number[])=>BoundaryPoint;scale:number;bounds:{minX:number;minY:number;maxX:number;maxY:number}};

/** Web Mercator without a tile dependency. Latitude is clamped before projection. */
export function projectWeatherCoordinate(coordinate:readonly number[]):BoundaryPoint {
  const lng=coordinate[0],lat=coordinate[1];
  if(!Number.isFinite(lng)||!Number.isFinite(lat))return {x:NaN,y:NaN};
  const radians=Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180;
  return {x:lng*Math.PI/180,y:-Math.log(Math.tan(Math.PI/4+radians/2))};
}
export function weatherBoundaryPolygons(geometry:WeatherBoundaryGeometry):number[][][][] {
  return geometry.type==="Polygon"?[geometry.coordinates]:geometry.coordinates;
}

/** Fits every island, leaving room for the weather toolbar above the map. */
export function fitWeatherBoundaries(features:WeatherBoundaryFeature[],width:number,height:number):BoundaryProjection {
  const all=features.flatMap(feature=>weatherBoundaryPolygons(feature.geometry).flat(2)).map(projectWeatherCoordinate).filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.y));
  const bounds=all.length?all.reduce((extent,point)=>({minX:Math.min(extent.minX,point.x),maxX:Math.max(extent.maxX,point.x),minY:Math.min(extent.minY,point.y),maxY:Math.max(extent.maxY,point.y)}),{minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity}):{minX:0,maxX:1,minY:0,maxY:1};
  const safeWidth=Math.max(1,width),safeHeight=Math.max(1,height);
  const side=Math.min(24,safeWidth/10),top=Math.min(160,safeHeight*.3),bottom=Math.min(35,safeHeight*.1);
  const availableWidth=Math.max(1,safeWidth-side*2),availableHeight=Math.max(1,safeHeight-top-bottom);
  const spanX=Math.max(bounds.maxX-bounds.minX,1e-9),spanY=Math.max(bounds.maxY-bounds.minY,1e-9);
  const scale=Math.min(availableWidth/spanX,availableHeight/spanY);
  const offsetX=side+(availableWidth-spanX*scale)/2,offsetY=top+(availableHeight-spanY*scale)/2;
  return {bounds,scale,project:coordinate=>{const projected=projectWeatherCoordinate(coordinate);return {x:offsetX+(projected.x-bounds.minX)*scale,y:offsetY+(projected.y-bounds.minY)*scale};}};
}

/** Each ring is a closed subpath; even-odd fill preserves holes and multipolygons. */
export function weatherBoundaryPath(geometry:WeatherBoundaryGeometry,projection:BoundaryProjection):string {
  return weatherBoundaryPolygons(geometry).flatMap(polygon=>polygon.map(ring=>{
    const points=ring.map(projection.project).filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.y));
    return points.length<3?"":points.map((point,index)=>`${index?"L":"M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")+" Z";
  })).filter(Boolean).join(" ");
}

const regionColors=["#c9e6dd","#f7d49b","#d4d0ed","#bfdded","#edd1d9","#dbe4b6","#f2c9af","#cbd5e8","#f0e2a5","#c8e2cf","#e6cce8","#c0e6e8"];
/** A categorical colour remains stable when regions are reordered or filtered. */
export function weatherBoundaryColor(id:string):string {
  let hash=2166136261;
  for(let index=0;index<id.length;index++)hash=Math.imul(hash^id.charCodeAt(index),16777619);
  return regionColors[(hash>>>0)%regionColors.length];
}

/** Resolve palette collisions deterministically so neighbouring regions differ. */
export function weatherBoundaryColors(ids:readonly string[]):Map<string,string> {
  const colors=new Map<string,string>(),used=new Set<string>();
  for(const id of [...new Set(ids)].sort()){
    const start=regionColors.indexOf(weatherBoundaryColor(id));
    let color=regionColors[start];
    for(let offset=0;offset<regionColors.length;offset++){
      const candidate=regionColors[(start+offset)%regionColors.length];if(!used.has(candidate)){color=candidate;break;}
    }
    if(used.has(color))color=`hsl(${((colors.size*137.508)%360).toFixed(2)} 55% ${72+Math.floor(colors.size/regionColors.length)%3*5}%)`;
    colors.set(id,color);used.add(color);
  }
  return colors;
}

export type WeatherBoundaryLabelAnchor={id:string;x:number;y:number;width:number;height:number};
export type WeatherBoundaryLabelPlacement=WeatherBoundaryLabelAnchor&{anchorX:number;anchorY:number};
export type WeatherBoundaryLabelViewport={width:number;height:number;top?:number;bottom?:number;side?:number};

/** Keep each true geographic anchor; move only overlapping text to its nearest free slot. */
export function placeWeatherBoundaryLabels(anchors:readonly WeatherBoundaryLabelAnchor[],viewport:WeatherBoundaryLabelViewport):WeatherBoundaryLabelPlacement[]{
  const side=viewport.side??8,top=viewport.top??160,bottom=viewport.height-(viewport.bottom??55),right=viewport.width-side;
  const placed:WeatherBoundaryLabelPlacement[]=[];
  if(right<=side||bottom<=top)return placed;
  for(const anchor of [...anchors].sort((a,b)=>a.id.localeCompare(b.id))){
    if(!Number.isFinite(anchor.x)||!Number.isFinite(anchor.y)||anchor.x<0||anchor.x>viewport.width||anchor.y<0||anchor.y>viewport.height)continue;
    const width=Math.min(anchor.width,right-side),height=anchor.height;
    const minX=side+width/2,maxX=right-width/2,minY=top+height/2,maxY=bottom-height/2;
    if(minY>maxY)continue;
    const valid=(x:number,y:number)=>placed.every(other=>Math.abs(x-other.x)>=(width+other.width)/2+4||Math.abs(y-other.y)>=(height+other.height)/2+4);
    const startX=Math.max(minX,Math.min(maxX,anchor.x)),startY=Math.max(minY,Math.min(maxY,anchor.y));
    let candidate:{x:number;y:number}|null=valid(startX,startY)?{x:startX,y:startY}:null;
    if(!candidate){
      let nearest=Infinity;
      for(let y=minY;y<=maxY;y+=6)for(let x=minX;x<=maxX;x+=6){
        const distance=(x-anchor.x)**2+(y-anchor.y)**2;
        if(distance<nearest&&valid(x,y)){nearest=distance;candidate={x,y};}
      }
    }
    if(candidate)placed.push({...anchor,width,x:candidate.x,y:candidate.y,anchorX:anchor.x,anchorY:anchor.y});
  }
  return placed;
}
