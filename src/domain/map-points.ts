type Located={id:string;location:{lat:number;lng:number}};

/** Coordinates within the stored six-decimal location precision share a marker. */
export function groupMapPoints<T extends Located>(points:T[]):T[][] {
  const groups=new Map<string,T[]>();
  for(const point of points){
    const key=`${point.location.lat.toFixed(6)},${point.location.lng.toFixed(6)}`;
    const group=groups.get(key);
    if(group)group.push(point);else groups.set(key,[point]);
  }
  return [...groups.values()];
}
