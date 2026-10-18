"use client";

import dynamic from "next/dynamic";
import {useEffect,useId,useMemo,useRef,useState,type FormEvent,type ReactNode} from "react";
import {koreanWeatherDate,validWeatherDate,weatherMetrics,type WeatherBucket,type WeatherLocationResult,type WeatherMetric,type WeatherPeriod,type WeatherRegion,type WeatherResult} from "@/domain/weather";
import type {MapFocus,MapPoint} from "./KakaoMap";
import {WeatherMultiChart,type WeatherChartSeries} from "./WeatherMultiChart";
import {ResponsiveMapDialog} from "./ResponsiveMapDialog";
import type {WeatherBoundaryResult} from "@/domain/weather-boundaries";
import {WeatherImageActions} from "./WeatherImageActions";
import {weatherImageFilename,type WeatherImageOptions} from "@/lib/weather-image-export";

const KakaoMap=dynamic(()=>import("./KakaoMap"),{loading:()=> <p className="weather-map-loading" role="status">날씨 지도를 펼치고 있어요…</p>});
const WeatherBlankMap=dynamic(()=>import("./WeatherBlankMap"),{loading:()=> <p className="weather-map-loading" role="status">백지도를 펼치고 있어요…</p>});
type RegionList={items:WeatherRegion[];source:string;updatedAt:string};
type Query={regionId:string;start:string;end:string;period:WeatherPeriod;nonce:number};
type CountKind="clear"|"cloudy"|"rain"|"snow";
type ChartKind="line"|"bar";
type ChartDatum={label:string;value:number|null};
const countKinds:CountKind[]=["clear","cloudy","rain","snow"];
const countLabels:Record<CountKind,string>={clear:"맑은 날",cloudy:"흐린 날",rain:"강수 있는 날",snow:"새 눈 쌓인 날"};
const countEmoji:Record<CountKind,string>={clear:"☀️",cloudy:"☁️",rain:"🌧️",snow:"❄️"};
const metricEmoji:Record<WeatherMetric,string>={temperature:"🌡️",minTemperature:"🌡️",maxTemperature:"🌡️",rainfall:"🌧️",humidity:"💧",windSpeed:"🌬️",cloudCover:"☁️",snowDepth:"❄️",sunshine:"☀️"};
const currentLabels:Partial<Record<WeatherMetric,string>>={temperature:"기온",rainfall:"오늘 누적 강수량",humidity:"습도",windSpeed:"풍속"};
const currentMetricKeys:WeatherMetric[]=["temperature","rainfall","humidity","windSpeed"];
type ChartKey=WeatherMetric|`count:${CountKind}`;
const chartKeys:ChartKey[]=[...Object.keys(weatherMetrics) as WeatherMetric[],...countKinds.map(kind=>`count:${kind}` as const)];
const chartColors=["#156f94","#4054b2","#bc4550","#04766a","#8848a5","#8c581e","#526c20","#aa4d87","#ad6000","#956300","#546276","#1266ab","#6553a0"];
function countKey(key:ChartKey):CountKind|null{return key.startsWith("count:")?key.slice(6) as CountKind:null;}
function chartMetadata(key:ChartKey){const kind=countKey(key);return kind?{label:countLabels[kind],unit:"일"}:weatherMetrics[key as WeatherMetric];}
function defaultChartKind(key:ChartKey):ChartKind{return countKey(key)?"bar":weatherMetrics[key as WeatherMetric].chart;}
function bucketValue(bucket:WeatherBucket,key:ChartKey){const kind=countKey(key);return kind?bucket.weatherCounts[kind]:bucket.values[key as WeatherMetric];}
function shiftDay(date:string,days:number){const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
function dateLabel(date:string){return date.length>=10?`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`:date;}
function numberLabel(value:number|null|undefined,unit=""){return value===null||value===undefined||!Number.isFinite(value)?"자료 없음":`${new Intl.NumberFormat("ko-KR",{maximumFractionDigits:1}).format(value)}${unit}`;}
function timestampLabel(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric",hour12:false}).format(date);}
async function responseData<T>(response:Response):Promise<T>{const body=await response.json();if(!response.ok)throw new Error(body.error?.message??"자료를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.");return body.data as T;}
function countValue(location:WeatherLocationResult,kind:CountKind):number|null{const value=location.weatherCounts[kind];return typeof value==="number"&&Number.isFinite(value)?value:null;}

/** Gaps stay gaps: the line never bridges an unobserved interval. */
export function WeatherChart({data,kind,unit,label}:{data:ChartDatum[];kind:ChartKind;unit:string;label:string}){
  const titleId=useId(),descriptionId=useId();
  const available=data.map(item=>item.value).filter((value):value is number=>value!==null&&Number.isFinite(value));
  if(!available.length)return <p className="weather-empty">이 항목은 해당 기간의 관측자료가 없어요. 다른 항목이나 기간을 선택해 주세요.</p>;
  const width=Math.max(330,data.length*25+62),height=210,left=46,right=14,top=20,bottom=38;
  const min=Math.min(0,...available),rawMax=Math.max(0,...available),max=rawMax===min?min+1:rawMax,span=max-min;
  const plotHeight=height-top-bottom,plotWidth=width-left-right;
  const x=(index:number)=>left+plotWidth*(index+.5)/Math.max(1,data.length);
  const y=(value:number)=>top+(max-value)/span*plotHeight;
  const baseline=y(0),barWidth=Math.min(32,plotWidth/Math.max(1,data.length)*.65);
  const groups:ChartDatum[][]=[];const indices:number[][]=[];
  data.forEach((item,index)=>{if(item.value===null||!Number.isFinite(item.value)){if(groups.at(-1)?.length){groups.push([]);indices.push([]);}return;}if(!groups.length){groups.push([]);indices.push([]);}groups.at(-1)!.push(item);indices.at(-1)!.push(index);});
  const labelEvery=Math.max(1,Math.ceil(data.length/8));
  return <div className="weather-chart-scroll" tabIndex={0} role="region" aria-label={`${label} 그래프, 가로로 스크롤할 수 있어요`}><svg className="weather-chart" viewBox={`0 0 ${width} ${height}`} style={{minWidth:width}} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
    <title id={titleId}>{label} {kind==="line"?"꺾은선그래프":"막대그래프"}</title><desc id={descriptionId}>단위 {unit||"없음"}. 빈 구간은 자료 없음입니다. 정확한 값은 아래 자료 표에서 확인할 수 있어요.</desc>
    {[0,.5,1].map(fraction=>{const value=min+span*fraction,position=y(value);return <g key={fraction}><line x1={left} x2={width-right} y1={position} y2={position} stroke="#cbd9dc" strokeDasharray="3 4"/><text x={left-7} y={position+4} textAnchor="end">{numberLabel(value)}</text></g>;})}
    <line x1={left} x2={width-right} y1={baseline} y2={baseline} stroke="#82989d"/>
    {kind==="bar"?data.map((item,index)=>item.value===null||!Number.isFinite(item.value)?null:<rect key={index} x={x(index)-barWidth/2} y={Math.min(y(item.value),baseline)} width={barWidth} height={Math.max(1,Math.abs(baseline-y(item.value)))} rx="3" fill="#277d99"><title>{item.label}: {numberLabel(item.value,unit)}</title></rect>):<>{groups.map((group,index)=>group.length>1&&<polyline key={index} points={group.map((item,itemIndex)=>`${x(indices[index][itemIndex])},${y(item.value!)}`).join(" ")} fill="none" stroke="#277d99" strokeWidth="3"/>)}{data.map((item,index)=>item.value===null||!Number.isFinite(item.value)?null:<circle key={index} cx={x(index)} cy={y(item.value)} r="4" fill="#277d99" stroke="#fffdf4" strokeWidth="1.5"><title>{item.label}: {numberLabel(item.value,unit)}</title></circle>)}</>}
    {data.map((item,index)=>index%labelEvery===0||index===data.length-1?<text key={index} x={x(index)} y={height-15} textAnchor="middle">{item.label}</text>:null)}
  </svg></div>;
}

function WeatherDataTable({buckets,metrics}:{buckets:WeatherBucket[];metrics:ChartKey[]}){
  return <details className="weather-table-details"><summary>관측자료 표로 보기</summary><div className="weather-table-scroll" tabIndex={0} role="region" aria-label="기간별 날씨 자료 표"><table><caption>선택한 항목의 기간 통계</caption><thead><tr><th scope="col">기간</th>{metrics.map(key=><th key={key} scope="col">{chartMetadata(key).label} ({chartMetadata(key).unit})</th>)}</tr></thead><tbody>{buckets.map(bucket=><tr key={bucket.date}><th scope="row">{bucket.date}{bucket.date!==bucket.endDate&&<> ~ {bucket.endDate}</>}</th>{metrics.map(key=><td key={key}>{numberLabel(bucketValue(bucket,key),chartMetadata(key).unit)}</td>)}</tr>)}</tbody></table></div></details>;
}

/** Desktop windows move independently of the map; mobile keeps native modality. */
function WeatherDialog({label,onClose,children,wide=false}:{label:string;onClose:()=>void;children:ReactNode;wide?:boolean}){
  return <ResponsiveMapDialog label={label} onClose={onClose} className={`weather-dialog${wide?" weather-dialog--graph":""}`} headerClassName="weather-dialog__header" bodyClassName="weather-dialog__body" closeLabel={`${label==="날씨 그래프"?"그래프":label} 닫기`}>{children}</ResponsiveMapDialog>;
}

export function WeatherExplorer({onClose,initialRegion}:{onClose?:()=>void;initialRegion?:string}={}){
  const today=koreanWeatherDate();
  const [cities,setCities]=useState<WeatherRegion[]>([]),[districts,setDistricts]=useState<WeatherRegion[]>([]),[dongs,setDongs]=useState<WeatherRegion[]>([]);
  const [cityId,setCityId]=useState(""),[districtId,setDistrictId]=useState(""),[dongId,setDongId]=useState("");
  const [regionBusy,setRegionBusy]=useState({city:true,district:false,dong:false}),[regionError,setRegionError]=useState(""),[regionAttempt,setRegionAttempt]=useState(0);
  const [period,setPeriod]=useState<WeatherPeriod>("day"),[start,setStart]=useState(()=>shiftDay(today,-6)),[end,setEnd]=useState(today);
  const [mapMetric,setMapMetric]=useState<ChartKey>("temperature");
  const [chartKinds,setChartKinds]=useState<Record<ChartKey,ChartKind>>(()=>Object.fromEntries(chartKeys.map(key=>[key,defaultChartKind(key)])) as Record<ChartKey,ChartKind>);
  const [chartMetrics,setChartMetrics]=useState<ChartKey[]>(["temperature"]),[queryOpen,setQueryOpen]=useState(true),[chartOpen,setChartOpen]=useState(false),[formError,setFormError]=useState("");
  const [mapMode,setMapMode]=useState<"summary"|"current">("summary");
  const [blankMode,setBlankMode]=useState(false),[boundaries,setBoundaries]=useState<WeatherBoundaryResult|null>(null),[boundaryBusy,setBoundaryBusy]=useState(false),[boundaryError,setBoundaryError]=useState(""),[boundaryAttempt,setBoundaryAttempt]=useState(0);
  const [query,setQuery]=useState<Query|null>(null),[result,setResult]=useState<WeatherResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[selectedId,setSelectedId]=useState("");
  const serial=useRef(0);
  const mapImageRef=useRef<HTMLDivElement>(null),chartImageRef=useRef<HTMLDivElement>(null);
  const id=useId(),selectedRegion=dongs.find(region=>region.id===dongId)??districts.find(region=>region.id===districtId)??cities.find(region=>region.id===cityId);

  useEffect(()=>{
    const controller=new AbortController();let active=true;setRegionBusy(value=>({...value,city:true}));setRegionError("");
    void fetch("/api/v1/weather/regions",{signal:controller.signal}).then(responseData<RegionList>).then(data=>{if(!active)return;setCities(data.items);setCityId(current=>data.items.some(region=>region.id===current)?current:(data.items.find(region=>region.id===initialRegion||region.name===initialRegion||region.fullName===initialRegion)??data.items[0])?.id??"");}).catch(cause=>{if(active)setRegionError(cause instanceof Error?cause.message:"시·도 목록을 불러오지 못했어요.");}).finally(()=>{if(active)setRegionBusy(value=>({...value,city:false}));});
    return()=>{active=false;controller.abort();};
  },[initialRegion,regionAttempt]);
  useEffect(()=>{
    setDistricts([]);setDongs([]);setDistrictId("");setDongId("");if(!cityId)return;
    const controller=new AbortController();let active=true;setRegionBusy(value=>({...value,district:true}));setRegionError("");
    void fetch(`/api/v1/weather/regions?parentId=${encodeURIComponent(cityId)}`,{signal:controller.signal}).then(responseData<RegionList>).then(data=>{if(active)setDistricts(data.items);}).catch(cause=>{if(active)setRegionError(cause instanceof Error?cause.message:"시·군·구 목록을 불러오지 못했어요.");}).finally(()=>{if(active)setRegionBusy(value=>({...value,district:false}));});
    return()=>{active=false;controller.abort();};
  },[cityId,regionAttempt]);
  useEffect(()=>{
    setDongs([]);setDongId("");setRegionBusy(value=>({...value,dong:false}));if(!districtId)return;
    const controller=new AbortController();let active=true;setRegionBusy(value=>({...value,dong:true}));setRegionError("");
    void fetch(`/api/v1/weather/regions?parentId=${encodeURIComponent(districtId)}`,{signal:controller.signal}).then(responseData<RegionList>).then(data=>{if(active)setDongs(data.items);}).catch(cause=>{if(active)setRegionError(cause instanceof Error?cause.message:"읍·면·동 목록을 불러오지 못했어요.");}).finally(()=>{if(active)setRegionBusy(value=>({...value,dong:false}));});
    return()=>{active=false;controller.abort();};
  },[districtId,regionAttempt]);
  useEffect(()=>{
    if(!query)return;const controller=new AbortController();let active=true;setBusy(true);setError("");setResult(null);setSelectedId("");
    const parameters=new URLSearchParams({regionId:query.regionId,start:query.start,end:query.end,period:query.period});
    void fetch(`/api/v1/weather?${parameters}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]),cache:"no-store"}).then(responseData<WeatherResult>).then(data=>{if(active){setResult(data);setSelectedId((data.items.find(item=>item.region.id!==data.region.id)??data.items[0])?.region.id??"");const useCurrent=data.start===koreanWeatherDate()&&data.end===koreanWeatherDate()&&data.items.some(item=>!!item.current);setMapMode(useCurrent?"current":"summary");if(useCurrent)setMapMetric(current=>currentMetricKeys.includes(current as WeatherMetric)?current:"temperature");}}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:"날씨 자료를 불러오지 못했어요.");}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;controller.abort();};
  },[query]);

  const boundaryRegionId=result?.configured?result.region.id:null;
  useEffect(()=>{
    if(!blankMode||!boundaryRegionId){setBoundaryBusy(false);if(!boundaryRegionId)setBoundaries(null);return;}
    const controller=new AbortController();let active=true;setBoundaryBusy(true);setBoundaryError("");setBoundaries(null);
    void fetch(`/api/v1/weather/boundaries?${new URLSearchParams({regionId:boundaryRegionId})}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])}).then(responseData<WeatherBoundaryResult>).then(data=>{if(active)setBoundaries(data);}).catch(cause=>{if(active)setBoundaryError(cause instanceof Error?cause.message:"행정구역 경계를 불러오지 못했어요.");}).finally(()=>{if(active)setBoundaryBusy(false);});
    return()=>{active=false;controller.abort();};
  },[blankMode,boundaryRegionId,boundaryAttempt]);

  const selected=result?.items.find(item=>item.region.id===selectedId)??result?.items[0];
  const metadata=chartMetadata(mapMetric),unit=metadata.unit,kind=countKey(mapMetric),metric=mapMetric as WeatherMetric;
  const hasCurrent=result?.end===today&&result.items.some(item=>!!item.current);
  const mapPoints=useMemo<MapPoint[]>(()=>{if(!result)return [];const children=result.items.filter(item=>item.region.id!==result.region.id);return (children.length?children:result.items).map(item=>{const value=mapMode==="current"?item.current?.values[metric]??null:kind?countValue(item,kind):item.summary.values[metric];const label=mapMode==="current"?currentLabels[metric]:metadata.label;return {id:item.region.id,title:`${item.region.name} · ${label} ${numberLabel(value,unit)} · ${item.station.name} 관측소${mapMode==="current"&&item.current?` · ${timestampLabel(item.current.observedAt)}`:""}`,label:`${item.region.name} ${numberLabel(value,unit)}`,emoji:kind?countEmoji[kind]:metricEmoji[metric],color:"#277d99",location:{lat:item.region.lat,lng:item.region.lng},description:`${item.region.fullName} · ${item.station.name} 관측소 대표자료`};});},[result,metric,kind,metadata.label,mapMode,unit]);
  const focus=useMemo<MapFocus|null>(()=>result?.items.length?{location:{lat:result.region.lat,lng:result.region.lng},locations:result.items.map(item=>({lat:item.region.lat,lng:item.region.lng})),nonce:query?.nonce??0}:selectedRegion?{location:{lat:selectedRegion.lat,lng:selectedRegion.lng},radiusMeters:selectedRegion.level==="city"?30000:selectedRegion.level==="district"?6000:1500,nonce:serial.current}:null,[result,query,selectedRegion]);
  const chartSeries=useMemo<WeatherChartSeries[]>(()=>chartMetrics.map(key=>({id:key,...chartMetadata(key),kind:chartKinds[key],color:chartColors[chartKeys.indexOf(key)],data:selected?.series.map(bucket=>({label:dateLabel(bucket.date),value:bucketValue(bucket,key)}))??[]})),[selected,chartMetrics,chartKinds]);
  const imagePeriod=result?`${result.start} ~ ${result.end} · ${result.period==="day"?"일별":result.period==="week"?"주별":"월별"}`:"";
  const mapImageOptions:WeatherImageOptions={title:`${result?.region.fullName??""} 날씨 백지도`,subtitle:`${imagePeriod} · ${mapMode==="current"?"최근 실황":"기간 통계"}`,details:[`${mapMode==="current"?currentLabels[metric]:metadata.label} (${unit})`],footnotes:["기상청 · 인근 관측소 대표값 (지역 전체 평균이 아님)","경계: SGIS 행정동 경계 가공 · vuski/admdongkor · CC BY 4.0",`경계 기준: ${boundaries?.updatedAt??""} · github.com/vuski/admdongkor`,...(boundaries?.missingIds.length?[`경계 없음: ${boundaries.missingIds.map(code=>result?.items.find(item=>item.region.id===code)?.region.name??code).join(", ")}`]:[])]};
  const chartImageOptions:WeatherImageOptions={title:`${selected?.region.fullName??""} 날씨 그래프`,subtitle:`${imagePeriod} · 기간 통계`,legend:chartSeries.map(item=>({color:item.color,label:`${item.label} (${item.unit}) · ${item.kind==="bar"?"막대":"꺾은선"}${item.data.some(point=>point.value!==null&&Number.isFinite(point.value))?"":" · 자료 없음"}`})),footnotes:[`기상청 · ${selected?.station.name??""} 관측소 대표값 (지역 전체 평균이 아님)`,"빈 구간은 자료 없음 · 서로 다른 단위는 별도 눈금","출처: data.kma.go.kr · 모두의 지도"]};
  function submit(event:FormEvent){
    event.preventDefault();if(!selectedRegion)return;
    if(!validWeatherDate(start)||!validWeatherDate(end)||start>end||start<"1904-01-01"){setFormError("시작일과 마지막 날을 다시 확인해 주세요. 1904년 이후 날짜를 선택할 수 있어요.");return;}
    if(end>today){setFormError("과거와 현재의 관측자료를 확인할 수 있어요. 오늘 이전 날짜를 선택해 주세요.");return;}
    if(Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`)>365*86400000){setFormError("한 번에 최대 366일까지 조회할 수 있어요. 기간을 나누어 살펴봐 주세요.");return;}
    setError("");setFormError("");setChartOpen(false);setQueryOpen(false);setQuery({regionId:selectedRegion.id,start,end,period,nonce:++serial.current});
  }
  function chooseMapMode(value:"summary"|"current"){setMapMode(value);if(value==="current"&&!currentMetricKeys.includes(mapMetric as WeatherMetric))setMapMetric("temperature");}
  function toggleChartMetric(key:ChartKey){setChartMetrics(current=>current.includes(key)?current.length>1?current.filter(item=>item!==key):current:chartKeys.filter(item=>item===key||current.includes(item)));}

  return <section className="weather-explorer" aria-label="기상청 날씨지도">
    {onClose&&<header className="weather-explorer__header">
      <button type="button" className="round-icon" aria-label="날씨지도 닫기" onClick={onClose}>‹</button>
      <h1>🌤️ 기상청 날씨지도</h1>
    </header>}
    <div className="weather-canvas">
      <div className="weather-map" ref={mapImageRef}>{blankMode?<WeatherBlankMap features={boundaries?.features??[]} points={mapPoints} selectedId={selected?.region.id} onSelectPoint={setSelectedId} loading={boundaryBusy||busy} error={boundaryError} onRetry={()=>setBoundaryAttempt(value=>value+1)}/>:<KakaoMap autoLocate={false} points={mapPoints} selectedId={selected?.region.id} onSelectPoint={setSelectedId} focus={focus}/>}</div>
      <div className="weather-map-toolbar" aria-label="날씨지도 도구">
        <div className="weather-map-toolbar__actions">
          <button type="button" onClick={()=>setQueryOpen(true)} aria-haspopup="dialog"><span aria-hidden="true">📍</span> 지역·기간</button>
          <button type="button" aria-label="백지도" aria-pressed={blankMode} onClick={()=>setBlankMode(value=>!value)} disabled={!result?.configured||!mapPoints.length||busy}><span aria-hidden="true">🗺️</span> 백지도</button>
          <button type="button" onClick={()=>setChartOpen(true)} disabled={!selected||busy} aria-haspopup="dialog"><span aria-hidden="true">📊</span> 그래프</button>
        </div>
        <div className="weather-map-toolbar__selects">
          {hasCurrent&&<label className="weather-mode-select"><span className="sr-only">지도에 표시할 자료</span><select aria-label="지도에 표시할 자료" value={mapMode} onChange={event=>chooseMapMode(event.target.value as "summary"|"current")}><option value="summary">기간 통계</option><option value="current">최근 실황</option></select></label>}
          <label className="weather-metric-select"><span className="sr-only">지도에 표시할 항목</span><select id={`${id}-metric`} aria-label="지도에 표시할 항목" value={mapMetric} onChange={event=>setMapMetric(event.target.value as ChartKey)}>
            {(mapMode==="current"?currentMetricKeys:Object.keys(weatherMetrics) as WeatherMetric[]).map(key=><option key={key} value={key}>{mapMode==="current"?currentLabels[key]:weatherMetrics[key].label} ({weatherMetrics[key].unit})</option>)}
            {mapMode==="summary"&&<optgroup label="날씨 종류별 일수">{countKinds.map(kind=><option key={kind} value={`count:${kind}`}>{countEmoji[kind]} {countLabels[kind]} (일)</option>)}</optgroup>}
          </select></label>
        </div>
        {result?.configured&&<p className="weather-query-chip">{result.region.fullName} · {result.start} ~ {result.end} · {mapMode==="current"?"최근 실황":result.period==="day"?"일별":result.period==="week"?"주별":"월별"}</p>}
        {blankMode&&!!boundaries?.missingIds.length&&<p className="weather-boundary-warning" role="status">경계 없음: {boundaries.missingIds.map(code=>result?.items.find(item=>item.region.id===code)?.region.name??code).join(", ")}</p>}
      </div>
      {blankMode&&result?.configured&&<div className="weather-map-export"><WeatherImageActions label="백지도" getSvg={()=>mapImageRef.current?.querySelector<SVGSVGElement>(".weather-blank-map-canvas")??null} options={mapImageOptions} filename={weatherImageFilename(`${result.region.fullName}_백지도_${metadata.label}`,result.start,result.end)} disabled={busy||boundaryBusy||!!boundaryError||!boundaries?.features.length}/></div>}
      <div className="weather-map-status" aria-live="polite">
        {busy&&<p className="weather-loading" role="status">기상청 관측자료를 불러오고 있어요…</p>}
        {error&&<div className="weather-error" role="alert"><p>{error}</p>{query&&<button type="button" onClick={()=>setQuery({...query,nonce:++serial.current})}>날씨 다시 불러오기</button>}</div>}
        {result&&!result.configured&&<div className="weather-setup" role="status"><h2>실제 날씨자료 연결이 필요해요</h2><p>관리자가 기상청 API 인증키를 설정하면 날씨를 확인할 수 있어요.</p></div>}
        {result?.configured&&!result.items.length&&<p className="weather-empty">표시할 관측자료가 없어요. 지역·기간을 바꿔 주세요.</p>}
        {!query&&!queryOpen&&<button type="button" className="weather-start-button" onClick={()=>setQueryOpen(true)}>지역과 기간 선택하기</button>}
      </div>
      {result?.configured&&<a className="weather-attribution" href="https://data.kma.go.kr/" target="_blank" rel="noopener noreferrer">기상청 · 인근 관측소 대표값</a>}
      {blankMode&&boundaries&&<a className="weather-boundary-attribution" href="https://github.com/vuski/admdongkor" target="_blank" rel="noopener noreferrer">경계: SGIS · vuski/admdongkor · CC BY 4.0 · 2026.07</a>}
    </div>
    {queryOpen&&<WeatherDialog label="지역·기간 선택" onClose={()=>setQueryOpen(false)}>
      <form className="weather-controls" onSubmit={submit}>
        <fieldset><legend>지역</legend><div className="weather-region-fields">
          <label htmlFor={`${id}-city`}>시·도<select id={`${id}-city`} value={cityId} disabled={regionBusy.city||!cities.length} onChange={event=>{setCityId(event.target.value);setDistrictId("");setDongId("");}}>{!cities.length&&<option value="">{regionBusy.city?"불러오는 중…":"지역 없음"}</option>}{cities.map(region=><option key={region.id} value={region.id}>{region.name}</option>)}</select></label>
          <label htmlFor={`${id}-district`}>시·군·구<select id={`${id}-district`} value={districtId} disabled={!cityId||regionBusy.district||!districts.length} onChange={event=>{setDistrictId(event.target.value);setDongId("");}}><option value="">{regionBusy.district?"불러오는 중…":"전체"}</option>{districts.map(region=><option key={region.id} value={region.id}>{region.name}</option>)}</select></label>
          <label htmlFor={`${id}-dong`}>읍·면·동<select id={`${id}-dong`} value={dongId} disabled={!districtId||regionBusy.dong||!dongs.length} onChange={event=>setDongId(event.target.value)}><option value="">{regionBusy.dong?"불러오는 중…":"전체"}</option>{dongs.map(region=><option key={region.id} value={region.id}>{region.name}</option>)}</select></label>
        </div></fieldset>
        {regionError&&<div className="weather-error" role="alert"><p>{regionError}</p><button type="button" onClick={()=>setRegionAttempt(value=>value+1)}>지역 목록 다시 불러오기</button></div>}
        <fieldset><legend>기간</legend><div className="weather-period" role="group" aria-label="기간별 묶음">{(["day","week","month"] as WeatherPeriod[]).map(value=><button type="button" key={value} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{value==="day"?"일별":value==="week"?"주별":"월별"}</button>)}</div>
          <div className="weather-date-fields"><label htmlFor={`${id}-start`}>시작일<input type="date" id={`${id}-start`} value={start} max={end||today} required onChange={event=>setStart(event.target.value)}/></label><label htmlFor={`${id}-end`}>마지막 날<input type="date" id={`${id}-end`} value={end} min={start} max={today} required onChange={event=>setEnd(event.target.value)}/></label></div>
        </fieldset>
        {formError&&<p className="weather-error" role="alert">{formError}</p>}
        <button type="submit" className="button button--primary button--full" disabled={!selectedRegion||regionBusy.city||regionBusy.district||regionBusy.dong}>날씨 살펴보기</button>
      </form>
    </WeatherDialog>}
    {chartOpen&&selected&&result&&<WeatherDialog label="날씨 그래프" onClose={()=>setChartOpen(false)} wide>
      <label className="weather-chart-region" htmlFor={`${id}-result`}>그래프로 볼 지역<select id={`${id}-result`} value={selected.region.id} onChange={event=>setSelectedId(event.target.value)}>{result.items.map(item=><option key={item.region.id} value={item.region.id}>{item.region.name}{item.region.id===result.region.id?" 전체":""}</option>)}</select></label>
      <p className="weather-chart-period">기간 통계 · {result.start} ~ {result.end}</p>
      <WeatherImageActions label="그래프" getSvg={()=>chartImageRef.current?.querySelector<SVGSVGElement>(".weather-multi-chart__svg")??null} options={chartImageOptions} filename={weatherImageFilename(`${selected.region.fullName}_날씨그래프`,result.start,result.end)} disabled={busy||!chartSeries.some(item=>item.data.some(point=>point.value!==null&&Number.isFinite(point.value)))}/>
      <details className="weather-chart-options"><summary>항목 선택 <span>{chartMetrics.length}개</span></summary><fieldset className="weather-chart-metrics"><legend>그래프 항목</legend><div>{chartKeys.map(key=>{const metadata=chartMetadata(key);const checked=chartMetrics.includes(key);return <div className="weather-chart-metric" key={key} style={{borderColor:checked?chartColors[chartKeys.indexOf(key)]:undefined}}><label className="weather-chart-metric__toggle"><input type="checkbox" checked={checked} disabled={checked&&chartMetrics.length===1} onChange={()=>toggleChartMetric(key)}/><span>{metadata.label} ({metadata.unit})</span></label><label className="weather-chart-metric__kind" hidden={!checked}><span className="sr-only">{metadata.label} 그래프 종류</span><select aria-label={`${metadata.label} 그래프 종류`} disabled={!checked} value={chartKinds[key]} onChange={event=>setChartKinds(current=>({...current,[key]:event.target.value as ChartKind}))}><option value="bar">막대</option><option value="line">꺾은선</option></select></label></div>;})}</div></fieldset></details>
      <div className="weather-chart-visual" ref={chartImageRef}><WeatherMultiChart series={chartSeries}/></div>
      <WeatherDataTable buckets={selected.series} metrics={chartMetrics}/>
    </WeatherDialog>}
  </section>;
}
