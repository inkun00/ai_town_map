/** Device measurements stay unchanged: filtering cannot create GPS accuracy. */
export type LocationFix={lat:number;lng:number;accuracy:number;observedAt:string};
export type LocationProgress={fix:LocationFix|null;sampleCount:number;elapsedMs:number};
export type PositionTrackerOptions={maxAgeMs?:number;minObservedAt?:number};
export type PrecisePositionOptions={signal?:AbortSignal;timeoutMs?:number;targetAccuracy?:number;onProgress?:(progress:LocationProgress)=>void};
type MeasuredFix={fix:LocationFix;timestamp:number};

export class GeolocationMeasurementError extends Error{
  constructor(public readonly code:"unsupported"|"permission-denied"|"unavailable"|"timeout",message:string){super(message);this.name="GeolocationMeasurementError";}
}

function measuredPosition(position:GeolocationPosition,now:number,options:PositionTrackerOptions):MeasuredFix|null{
  const {latitude:lat,longitude:lng,accuracy}=position.coords,timestamp=position.timestamp;
  if(![lat,lng,accuracy,timestamp,now].every(Number.isFinite)||lat< -90||lat>90||lng< -180||lng>180||accuracy<0||accuracy>10000||timestamp<0||timestamp>8640000000000000)return null;
  if(timestamp>now+1000||now-timestamp>(options.maxAgeMs??20000)||timestamp<(options.minObservedAt??0))return null;
  return {fix:{lat,lng,accuracy,observedAt:new Date(timestamp).toISOString()},timestamp};
}

function distance(a:LocationFix,b:LocationFix){
  const rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLng=(b.lng-a.lng)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLng/2)**2;
  return 6371008.8*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
}

function consistent(a:MeasuredFix,b:MeasuredFix,qualityCheck=false){
  // Allow genuine movement as well as both reported uncertainty radii. Very coarse
  // readings may still be shown, but cannot certify a far-away precise reading.
  const radius=(fix:LocationFix)=>qualityCheck?Math.min(fix.accuracy,100):fix.accuracy;
  const movement=Math.abs(b.timestamp-a.timestamp)/1000*12;
  return distance(a.fix,b.fix)<=radius(a.fix)+radius(b.fix)+25+movement;
}

/** Reject one-off jumps, then reacquire after two consistent readings at a new place. */
export function createPositionTracker(options:PositionTrackerOptions={}){
  let previous:MeasuredFix|null=null,pending:MeasuredFix|null=null,latestTimestamp=-Infinity;
  return {
    accept(position:GeolocationPosition,now=Date.now()):LocationFix|null{
      const measured=measuredPosition(position,now,options);
      if(!measured||measured.timestamp<=latestTimestamp)return null;
      latestTimestamp=measured.timestamp;
      if(!previous||consistent(previous,measured)){
        previous=measured;pending=null;return measured.fix;
      }
      if(pending&&consistent(pending,measured)){
        if(measured.timestamp-pending.timestamp>=1000){previous=measured;pending=null;return measured.fix;}
        return null;
      }
      pending=measured;return null;
    },
    reset(){previous=null;pending=null;latestTimestamp=-Infinity;}
  };
}

function aborted(){const error=new Error("위치 확인을 취소했어요.");error.name="AbortError";return error;}

/** Sample fresh high-accuracy readings; return a real recent fix, never an average. */
export function acquirePrecisePosition(options:PrecisePositionOptions={}):Promise<LocationFix>{
  const timeoutMs=Number.isFinite(options.timeoutMs)?Math.max(1,Math.min(60000,options.timeoutMs!)):15000;
  const targetAccuracy=Number.isFinite(options.targetAccuracy)?Math.max(0,options.targetAccuracy!):15;
  return new Promise((resolve,reject)=>{
    if(options.signal?.aborted){reject(aborted());return;}
    const geolocation=typeof navigator!=="undefined"?navigator.geolocation:null;
    if(!geolocation){reject(new GeolocationMeasurementError("unsupported","이 기기에서는 위치를 확인할 수 없어요."));return;}
    const startedAt=Date.now(),tracker=createPositionTracker({minObservedAt:startedAt});
    const samples:MeasuredFix[]=[];
    let settled=false,watchId:number|null=null,timer:ReturnType<typeof setTimeout>|null=null,lastErrorCode:number|null=null,sampleCount=0;
    const cleanup=()=>{
      if(timer!==null){clearTimeout(timer);timer=null;}
      if(watchId!==null){geolocation.clearWatch(watchId);watchId=null;}
      options.signal?.removeEventListener("abort",cancel);
    };
    const finish=(fix:LocationFix|null,error?:Error)=>{
      if(settled)return;settled=true;cleanup();
      if(fix)resolve(fix);else reject(error);
    };
    const cancel=()=>finish(null,aborted());
    const progress=(fix:LocationFix|null)=>{
      try{options.onProgress?.({fix,sampleCount,elapsedMs:Math.max(0,Date.now()-startedAt)});}
      catch(error){finish(null,error instanceof Error?error:new Error("위치 확인 안내를 표시하지 못했어요."));}
    };
    const select=(now:number,early=false):LocationFix|null=>{
      const recent=samples.filter(sample=>now-sample.timestamp<=5000);
      const supported=recent.filter(sample=>samples.some(other=>other!==sample&&now-other.timestamp<=10000&&Math.abs(sample.timestamp-other.timestamp)>=1000&&consistent(sample,other,true)&&(!early||other.fix.accuracy<=targetAccuracy)));
      const candidates=early?supported.filter(sample=>sample.fix.accuracy<=targetAccuracy):supported;
      if(candidates.length)return candidates.sort((a,b)=>a.fix.accuracy-b.fix.accuracy||b.timestamp-a.timestamp)[0].fix;
      if(early)return null;
      // With only one usable measurement, prefer the latest one over an isolated
      // reading claiming excellent accuracy. Its original uncertainty is retained.
      const latest=samples[samples.length-1];
      if(!latest||now-latest.timestamp>20000)return null;
      const earlier=samples.slice(0,-1).filter(sample=>now-sample.timestamp<=20000);
      if(latest.fix.accuracy<=Math.max(50,targetAccuracy)&&earlier.length&&!earlier.some(sample=>consistent(sample,latest,true))){
        // A broad uncertainty circle alone cannot validate a sudden precise fix
        // somewhere else. Keep the preceding coarse measurement until confirmed.
        return earlier[earlier.length-1].fix;
      }
      return latest.fix;
    };
    const received=(position:GeolocationPosition)=>{
      if(settled)return;
      const now=Date.now(),fix=tracker.accept(position,now);
      if(!fix)return;
      sampleCount++;
      const measured={fix,timestamp:new Date(fix.observedAt).getTime()},previous=samples[samples.length-1];
      // Reacquisition creates a new segment: old supported samples must not pull
      // the result back to the place the user has already left.
      if(previous&&!consistent(previous,measured))samples.length=0;
      samples.push(measured);
      if(samples.length>120)samples.shift();
      progress(fix);
      if(settled)return;
      const selected=select(now,true);if(selected)finish(selected);
    };
    const failed=(error:GeolocationPositionError)=>{
      if(settled)return;lastErrorCode=error.code;
      if(error.code===1)finish(null,new GeolocationMeasurementError("permission-denied","위치 권한이 꺼져 있어요. 브라우저에서 정확한 위치 사용을 허용한 뒤 다시 시도해 주세요."));
      // Unavailable/timeout callbacks can be transient; keep the watch until our deadline.
    };
    options.signal?.addEventListener("abort",cancel,{once:true});
    progress(null);
    if(settled)return;
    timer=setTimeout(()=>{
      const selected=select(Date.now());
      if(selected)finish(selected);
      else finish(null,new GeolocationMeasurementError(lastErrorCode===2?"unavailable":"timeout","현재 위치를 확인하지 못했어요. 창가나 야외에서 다시 시도해 주세요."));
    },timeoutMs);
    try{
      const id=geolocation.watchPosition(received,failed,{enableHighAccuracy:true,maximumAge:0,timeout:Math.min(timeoutMs,10000)});
      // Some implementations/mocks callback synchronously before returning the id.
      if(settled)geolocation.clearWatch(id);else watchId=id;
    }catch(error){finish(null,new GeolocationMeasurementError("unavailable",error instanceof Error&&error.name==="SecurityError"?"브라우저에서 위치 사용을 허용해 주세요.":"위치 기능을 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요."));}
  });
}
