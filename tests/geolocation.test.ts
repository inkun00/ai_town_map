import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {acquirePrecisePosition,createPositionTracker,GeolocationMeasurementError,type LocationProgress} from "../src/lib/geolocation";

const started=Date.parse("2026-10-11T04:00:00.000Z");
function position(overrides:{lat?:number;lng?:number;accuracy?:number;timestamp?:number}={}):GeolocationPosition{
  return {coords:{latitude:overrides.lat??37.5,longitude:overrides.lng??127,accuracy:overrides.accuracy??20,altitude:null,altitudeAccuracy:null,heading:null,speed:null},timestamp:overrides.timestamp??Date.now()} as GeolocationPosition;
}
function failure(code:number):GeolocationPositionError{return {code,message:"device detail",PERMISSION_DENIED:1,POSITION_UNAVAILABLE:2,TIMEOUT:3} as GeolocationPositionError;}
function browser(){
  let success:PositionCallback=()=>{},error:PositionErrorCallback=()=>{};
  const clearWatch=vi.fn(),watchPosition=vi.fn((received:PositionCallback,failed?:PositionErrorCallback|null,_options?:PositionOptions)=>{success=received;error=failed??(()=>{});return 17;});
  vi.stubGlobal("navigator",{geolocation:{watchPosition,clearWatch}});
  return {watchPosition,clearWatch,emit:(value=position())=>success(value),fail:(code:number)=>error(failure(code))};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(started);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe("location measurement quality filter",()=>{
  it("keeps coordinates, device uncertainty and the original measurement timestamp",()=>{
    const tracker=createPositionTracker(),timestamp=started-1234;
    expect(tracker.accept(position({accuracy:8.75,timestamp}))).toEqual({lat:37.5,lng:127,accuracy:8.75,observedAt:new Date(timestamp).toISOString()});
  });
  it("ignores invalid, old, future and duplicate readings without locking out a later valid reading",()=>{
    const tracker=createPositionTracker();
    for(const invalid of [position({lat:91}),position({lng:-181}),position({accuracy:-1}),position({accuracy:10001}),position({accuracy:NaN}),position({timestamp:started-20001}),position({timestamp:started+1001}),position({timestamp:Infinity})])expect(tracker.accept(invalid)).toBeNull();
    expect(tracker.accept(position())).not.toBeNull();
    expect(tracker.accept(position())).toBeNull();
    expect(tracker.accept(position({timestamp:started-1}))).toBeNull();
  });
  it("uses the request start boundary and a caller-specified age limit",()=>{
    const tracker=createPositionTracker({minObservedAt:started-2000,maxAgeMs:1000});
    expect(tracker.accept(position({timestamp:started-1001}))).toBeNull();
    expect(tracker.accept(position({timestamp:started-1000}))).not.toBeNull();
    expect(createPositionTracker({minObservedAt:started}).accept(position({timestamp:started-1}))).toBeNull();
  });
  it("rejects an isolated far-away jump and resumes readings around the established position",()=>{
    const tracker=createPositionTracker();expect(tracker.accept(position({accuracy:5}))).not.toBeNull();
    vi.advanceTimersByTime(1000);expect(tracker.accept(position({lat:37.51,accuracy:5}))).toBeNull();
    vi.advanceTimersByTime(1000);expect(tracker.accept(position({lat:37.50002,accuracy:5}))?.lat).toBe(37.50002);
  });
  it("reacquires a genuine new location even when readings arrive faster than once per second",()=>{
    const tracker=createPositionTracker();tracker.accept(position({accuracy:5}));
    vi.advanceTimersByTime(1000);expect(tracker.accept(position({lat:37.51,accuracy:5}))).toBeNull();
    for(let i=0;i<4;i++){vi.advanceTimersByTime(200);expect(tracker.accept(position({lat:37.51001,accuracy:5}))).toBeNull();}
    vi.advanceTimersByTime(200);expect(tracker.accept(position({lat:37.51001,accuracy:5}))?.lat).toBe(37.51001);
    vi.advanceTimersByTime(1000);expect(tracker.accept(position({lat:37.51002,accuracy:5}))).not.toBeNull();
  });
  it("allows plausible movement and respects uncertainty rather than declaring coarse GPS invalid",()=>{
    const coarse=createPositionTracker();coarse.accept(position({accuracy:100}));
    vi.advanceTimersByTime(1000);expect(coarse.accept(position({lat:37.501,accuracy:100}))).not.toBeNull();
    const moving=createPositionTracker();moving.accept(position({accuracy:2}));
    vi.advanceTimersByTime(1000);expect(moving.accept(position({lat:37.5001,accuracy:2}))).not.toBeNull();
  });
  it("resets position and timestamp history when tracking restarts",()=>{
    const tracker=createPositionTracker();tracker.accept(position());tracker.reset();
    expect(tracker.accept(position({lat:35,timestamp:started-1}))).not.toBeNull();
  });
});

describe("precise browser position acquisition",()=>{
  it("works safely when no browser geolocation exists",async()=>{
    vi.stubGlobal("navigator",undefined);
    await expect(acquirePrecisePosition()).rejects.toMatchObject({name:"GeolocationMeasurementError",code:"unsupported"});
    expect(vi.getTimerCount()).toBe(0);
  });
  it("starts a cache-free high-accuracy watch and needs two consistent good measurements",async()=>{
    const geo=browser(),onProgress=vi.fn(),promise=acquirePrecisePosition({onProgress});
    expect(geo.watchPosition.mock.calls[0][2]).toEqual({enableHighAccuracy:true,maximumAge:0,timeout:10000});
    expect(onProgress).toHaveBeenLastCalledWith({fix:null,sampleCount:0,elapsedMs:0});
    geo.emit(position({accuracy:8}));expect(geo.clearWatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);geo.emit(position({lat:37.50001,accuracy:6}));
    await expect(promise).resolves.toEqual({lat:37.50001,lng:127,accuracy:6,observedAt:new Date(started+1000).toISOString()});
    expect(onProgress).toHaveBeenLastCalledWith({fix:expect.objectContaining({accuracy:6}),sampleCount:2,elapsedMs:1000});
    expect(geo.clearWatch).toHaveBeenCalledOnce();expect(geo.clearWatch).toHaveBeenCalledWith(17);expect(vi.getTimerCount()).toBe(0);
  });
  it("does not confuse duplicate timestamps or rapidly repeated readings with confirmation",async()=>{
    const geo=browser(),promise=acquirePrecisePosition();geo.emit(position({accuracy:5}));geo.emit(position({accuracy:5}));
    vi.advanceTimersByTime(500);geo.emit(position({accuracy:5}));expect(geo.clearWatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);geo.emit(position({accuracy:5}));await expect(promise).resolves.toMatchObject({accuracy:5});
  });
  it("waits for refinement and selects a supported real measurement without averaging or shrinking accuracy",async()=>{
    const geo=browser(),promise=acquirePrecisePosition({timeoutMs:5000});
    geo.emit(position({accuracy:75}));vi.advanceTimersByTime(1000);geo.emit(position({lat:37.50003,accuracy:30}));
    vi.advanceTimersByTime(1000);geo.emit(position({lat:37.50001,accuracy:45}));await vi.advanceTimersByTimeAsync(3000);
    await expect(promise).resolves.toEqual({lat:37.50003,lng:127,accuracy:30,observedAt:new Date(started+1000).toISOString()});
    expect(geo.clearWatch).toHaveBeenCalledOnce();
  });
  it("ignores a single precise-looking jump rather than moving to it",async()=>{
    const geo=browser(),promise=acquirePrecisePosition({timeoutMs:4000});
    geo.emit(position({accuracy:35}));vi.advanceTimersByTime(1000);geo.emit(position({lat:37.51,accuracy:1}));
    vi.advanceTimersByTime(1000);geo.emit(position({lat:37.50001,accuracy:30}));await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toMatchObject({lat:37.50001,accuracy:30});
  });
  it("does not let a very coarse fix certify an isolated excellent-looking fix outside its sample cluster",async()=>{
    const geo=browser(),promise=acquirePrecisePosition({timeoutMs:4000});
    geo.emit(position({accuracy:500}));vi.advanceTimersByTime(1000);geo.emit(position({accuracy:450}));
    vi.advanceTimersByTime(1000);geo.emit(position({lat:37.503,accuracy:1}));await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toMatchObject({lat:37.5,accuracy:450});
  });
  it("keeps the coarse estimate when only one unrelated precise-looking measurement follows it",async()=>{
    const geo=browser(),promise=acquirePrecisePosition({timeoutMs:3000});
    geo.emit(position({accuracy:500}));vi.advanceTimersByTime(1000);geo.emit(position({lat:37.503,accuracy:1}));
    await vi.advanceTimersByTimeAsync(2000);await expect(promise).resolves.toMatchObject({lat:37.5,accuracy:500,observedAt:new Date(started).toISOString()});
  });
  it("does not select the old supported cluster after a coherent new location was reacquired",async()=>{
    const geo=browser(),promise=acquirePrecisePosition({timeoutMs:5000});
    geo.emit(position({accuracy:20}));vi.advanceTimersByTime(1000);geo.emit(position({accuracy:20}));
    vi.advanceTimersByTime(1000);geo.emit(position({lat:37.51,accuracy:25}));
    vi.advanceTimersByTime(1000);geo.emit(position({lat:37.51001,accuracy:25}));
    await vi.advanceTimersByTimeAsync(2000);await expect(promise).resolves.toMatchObject({lat:37.51001,accuracy:25});
  });
  it("prefers recent measurements over an older good estimate and reports a lone coarse fix honestly",async()=>{
    const geo=browser(),promise=acquirePrecisePosition();
    geo.emit(position({accuracy:20}));vi.advanceTimersByTime(13000);geo.emit(position({lat:37.50001,accuracy:90}));
    await vi.advanceTimersByTimeAsync(2000);await expect(promise).resolves.toMatchObject({lat:37.50001,accuracy:90,observedAt:new Date(started+13000).toISOString()});
    const single=acquirePrecisePosition({timeoutMs:1000});geo.emit(position({accuracy:700}));await vi.advanceTimersByTimeAsync(1000);
    await expect(single).resolves.toMatchObject({accuracy:700});
  });
  it("ignores cached pre-request fixes even when they claim excellent accuracy",async()=>{
    const geo=browser(),promise=acquirePrecisePosition({timeoutMs:1000}),outcome=expect(promise).rejects.toMatchObject({code:"timeout"});
    geo.emit(position({timestamp:started-1,accuracy:1}));await vi.advanceTimersByTimeAsync(1000);await outcome;
    expect(geo.clearWatch).toHaveBeenCalledOnce();
  });
  it("distinguishes permission denial and stops immediately even after a usable sample",async()=>{
    const geo=browser(),promise=acquirePrecisePosition(),outcome=expect(promise).rejects.toMatchObject({code:"permission-denied"});
    geo.emit();geo.fail(1);await outcome;expect(geo.clearWatch).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps sampling after transient browser timeout or unavailable errors until the deadline",async()=>{
    const geo=browser(),promise=acquirePrecisePosition();geo.fail(3);geo.fail(2);expect(geo.clearWatch).not.toHaveBeenCalled();
    geo.emit(position({accuracy:10}));vi.advanceTimersByTime(1000);geo.emit(position({accuracy:9}));await expect(promise).resolves.toMatchObject({accuracy:9});
  });
  it("fails at its own deadline and cleans resources when no valid location arrived",async()=>{
    const geo=browser(),promise=acquirePrecisePosition({timeoutMs:1000}),outcome=expect(promise).rejects.toBeInstanceOf(GeolocationMeasurementError);
    geo.fail(2);await vi.advanceTimersByTimeAsync(1000);await outcome;expect(geo.clearWatch).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
  it("does not return a measurement that became stale during a long custom sampling window",async()=>{
    const geo=browser(),promise=acquirePrecisePosition({timeoutMs:30000}),outcome=expect(promise).rejects.toMatchObject({code:"timeout"});
    geo.emit(position({accuracy:100}));await vi.advanceTimersByTimeAsync(30000);await outcome;
  });
  it("aborts before starting or while sampling and ignores callbacks after cancellation",async()=>{
    const geo=browser(),cancelled=new AbortController();cancelled.abort();
    await expect(acquirePrecisePosition({signal:cancelled.signal})).rejects.toMatchObject({name:"AbortError"});expect(geo.watchPosition).not.toHaveBeenCalled();
    const controller=new AbortController(),onProgress=vi.fn(),promise=acquirePrecisePosition({signal:controller.signal,onProgress}),outcome=expect(promise).rejects.toMatchObject({name:"AbortError"});
    controller.abort();await outcome;geo.emit();geo.fail(1);expect(onProgress).toHaveBeenCalledOnce();
    expect(geo.clearWatch).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans the watch id if a permission callback happens synchronously before watchPosition returns",async()=>{
    const geo=browser();geo.watchPosition.mockImplementation((_success,failed)=>{failed!(failure(1));return 31;});
    await expect(acquirePrecisePosition()).rejects.toMatchObject({code:"permission-denied"});
    expect(geo.clearWatch).toHaveBeenCalledOnce();expect(geo.clearWatch).toHaveBeenCalledWith(31);expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans timers if starting the watch throws or a progress callback fails",async()=>{
    const geo=browser();geo.watchPosition.mockImplementation(()=>{throw new Error("start failed");});
    await expect(acquirePrecisePosition()).rejects.toMatchObject({code:"unavailable"});expect(vi.getTimerCount()).toBe(0);
    geo.watchPosition.mockImplementation(()=>17);
    await expect(acquirePrecisePosition({onProgress:()=>{throw new Error("render failed");}})).rejects.toThrow("render failed");expect(geo.watchPosition).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
  it("can abort from the initial progress callback before creating a browser watch",async()=>{
    const geo=browser(),controller=new AbortController(),onProgress=(_progress:LocationProgress)=>controller.abort();
    await expect(acquirePrecisePosition({signal:controller.signal,onProgress})).rejects.toMatchObject({name:"AbortError"});expect(geo.watchPosition).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
});
