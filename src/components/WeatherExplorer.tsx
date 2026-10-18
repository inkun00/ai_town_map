"use client";

import dynamic from "next/dynamic";
import {useEffect,useId,useMemo,useRef,useState,type FormEvent} from "react";
import {koreanWeatherDate,validWeatherDate,weatherMetrics,type WeatherBucket,type WeatherLocationResult,type WeatherMetric,type WeatherPeriod,type WeatherRegion,type WeatherResult} from "@/domain/weather";
import type {MapFocus,MapPoint} from "./KakaoMap";

const KakaoMap=dynamic(()=>import("./KakaoMap"),{loading:()=> <p className="weather-map-loading" role="status">날씨 지도를 펼치고 있어요…</p>});
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

function WeatherDataTable({buckets,metric}:{buckets:WeatherBucket[];metric:WeatherMetric}){
  const metadata=weatherMetrics[metric];
  return <details className="weather-table-details"><summary>관측자료 표로 보기</summary><div className="weather-table-scroll" tabIndex={0} role="region" aria-label="기간별 날씨 자료 표"><table><caption>{metadata.label} · {metadata.unit}</caption><thead><tr><th scope="col">기간</th><th scope="col">값</th><th scope="col">이 항목 관측일</th></tr></thead><tbody>{buckets.map(bucket=><tr key={bucket.date}><th scope="row">{bucket.date}{bucket.date!==bucket.endDate&&<> ~ {bucket.endDate}</>}</th><td>{numberLabel(bucket.values[metric],metadata.unit)}</td><td>{bucket.metricDays[metric]}/{bucket.expectedDays}일</td></tr>)}</tbody></table></div></details>;
}

export function WeatherExplorer({onClose,initialRegion}:{onClose?:()=>void;initialRegion?:string}={}){
  const today=koreanWeatherDate();
  const [cities,setCities]=useState<WeatherRegion[]>([]),[districts,setDistricts]=useState<WeatherRegion[]>([]),[dongs,setDongs]=useState<WeatherRegion[]>([]);
  const [cityId,setCityId]=useState(""),[districtId,setDistrictId]=useState(""),[dongId,setDongId]=useState("");
  const [regionBusy,setRegionBusy]=useState({city:true,district:false,dong:false}),[regionError,setRegionError]=useState(""),[regionAttempt,setRegionAttempt]=useState(0);
  const [period,setPeriod]=useState<WeatherPeriod>("day"),[start,setStart]=useState(()=>shiftDay(today,-6)),[end,setEnd]=useState(today);
  const [metric,setMetric]=useState<WeatherMetric>("temperature"),[countKind,setCountKind]=useState<CountKind>("rain"),[showCounts,setShowCounts]=useState(false),[chartKind,setChartKind]=useState<ChartKind>("line");
  const [mapMode,setMapMode]=useState<"summary"|"current">("summary");
  const [query,setQuery]=useState<Query|null>(null),[result,setResult]=useState<WeatherResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[selectedId,setSelectedId]=useState("");
  const serial=useRef(0);
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
    void fetch(`/api/v1/weather?${parameters}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]),cache:"no-store"}).then(responseData<WeatherResult>).then(data=>{if(active){setResult(data);setSelectedId(data.items[0]?.region.id??"");const useCurrent=data.start===koreanWeatherDate()&&data.end===koreanWeatherDate()&&data.items.some(item=>!!item.current);setMapMode(useCurrent?"current":"summary");if(useCurrent){setShowCounts(false);setMetric(current=>currentMetricKeys.includes(current)?current:"temperature");}}}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:"날씨 자료를 불러오지 못했어요.");}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;controller.abort();};
  },[query]);

  const selected=result?.items.find(item=>item.region.id===selectedId)??result?.items[0];
  const metadata=weatherMetrics[metric],unit=showCounts?"일":metadata.unit;
  const hasCurrent=result?.end===today&&result.items.some(item=>!!item.current);
  const mapPoints=useMemo<MapPoint[]>(()=>result?.items.map(item=>{const value=mapMode==="current"?item.current?.values[metric]??null:showCounts?countValue(item,countKind):item.summary.values[metric];const label=mapMode==="current"?currentLabels[metric]:showCounts?countLabels[countKind]:weatherMetrics[metric].label;return {id:item.region.id,title:`${item.region.name} · ${label} ${numberLabel(value,unit)}${mapMode==="current"&&item.current?` · ${timestampLabel(item.current.observedAt)}`:""}`,label:`${item.region.name} ${numberLabel(value,unit)}`,emoji:showCounts?countEmoji[countKind]:metricEmoji[metric],color:item.region.id===result.region.id?"#176a62":"#277d99",location:{lat:item.region.lat,lng:item.region.lng},description:`${item.region.fullName} · ${item.station.name} 관측소 대표자료`};})??[],[result,metric,showCounts,countKind,mapMode,unit]);
  const focus=useMemo<MapFocus|null>(()=>result?.items.length?{location:{lat:result.region.lat,lng:result.region.lng},locations:result.items.map(item=>({lat:item.region.lat,lng:item.region.lng})),nonce:query?.nonce??0}:selectedRegion?{location:{lat:selectedRegion.lat,lng:selectedRegion.lng},radiusMeters:selectedRegion.level==="city"?30000:selectedRegion.level==="district"?6000:1500,nonce:serial.current}:null,[result,query,selectedRegion]);
  const numericChart=useMemo(()=>selected?.series.map(bucket=>({label:dateLabel(bucket.date),value:bucket.values[metric]}))??[],[selected,metric]);
  const typeChart=useMemo(()=>selected?countKinds.map(kind=>({label:countLabels[kind],value:countValue(selected,kind)})):[],[selected]);
  const queryChanged=!!query&&(query.regionId!==selectedRegion?.id||query.start!==start||query.end!==end||query.period!==period);
  function submit(event:FormEvent){
    event.preventDefault();if(!selectedRegion)return;
    if(!validWeatherDate(start)||!validWeatherDate(end)||start>end||start<"1904-01-01"){setError("시작일과 마지막 날을 다시 확인해 주세요. 1904년 이후 날짜를 선택할 수 있어요.");return;}
    if(end>today){setError("과거와 현재의 관측자료를 확인할 수 있어요. 오늘 이전 날짜를 선택해 주세요.");return;}
    if(Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`)>365*86400000){setError("한 번에 최대 366일까지 조회할 수 있어요. 기간을 나누어 살펴봐 주세요.");return;}
    setError("");setQuery({regionId:selectedRegion.id,start,end,period,nonce:++serial.current});
  }
  function chooseMetric(value:string){if(value==="weatherCounts"){setShowCounts(true);setChartKind("bar");return;}setShowCounts(false);const next=value as WeatherMetric;setMetric(next);setChartKind(weatherMetrics[next].chart);}
  function chooseMapMode(value:"summary"|"current"){setMapMode(value);if(value==="current"){setShowCounts(false);if(!currentMetricKeys.includes(metric))setMetric("temperature");}}

  return <section className="weather-explorer" aria-label="기상청 날씨지도"><header className="weather-explorer__header">{onClose&&<button type="button" className="round-icon" aria-label="날씨지도 닫기" onClick={onClose}>‹</button>}<div><small>관측자료로 살펴보는 우리 지역</small><h1>기상청 날씨지도</h1></div><span className="weather-header-symbol" aria-hidden="true">🌤️</span></header>
    <div className="weather-explorer__scroll"><form className="weather-controls" onSubmit={submit}>
      <fieldset><legend>어느 지역을 살펴볼까요?</legend><div className="weather-region-fields"><label htmlFor={`${id}-city`}>시·도<select id={`${id}-city`} value={cityId} disabled={regionBusy.city||!cities.length} onChange={event=>{setCityId(event.target.value);setDistrictId("");setDongId("");}}>{!cities.length&&<option value="">{regionBusy.city?"불러오는 중…":"지역 없음"}</option>}{cities.map(region=><option key={region.id} value={region.id}>{region.name}</option>)}</select></label><label htmlFor={`${id}-district`}>시·군·구<select id={`${id}-district`} value={districtId} disabled={!cityId||regionBusy.district||!districts.length} onChange={event=>{setDistrictId(event.target.value);setDongId("");}}><option value="">{regionBusy.district?"불러오는 중…":"전체"}</option>{districts.map(region=><option key={region.id} value={region.id}>{region.name}</option>)}</select></label><label htmlFor={`${id}-dong`}>읍·면·동<select id={`${id}-dong`} value={dongId} disabled={!districtId||regionBusy.dong||!dongs.length} onChange={event=>setDongId(event.target.value)}><option value="">{regionBusy.dong?"불러오는 중…":"전체"}</option>{dongs.map(region=><option key={region.id} value={region.id}>{region.name}</option>)}</select></label></div></fieldset>
      {regionError&&<div className="weather-error" role="alert"><p>{regionError}</p><button type="button" onClick={()=>setRegionAttempt(value=>value+1)}>지역 목록 다시 불러오기</button></div>}
      <fieldset><legend>언제의 날씨가 궁금한가요?</legend><div className="weather-period" role="group" aria-label="기간별 묶음">{(["day","week","month"] as WeatherPeriod[]).map(value=><button type="button" key={value} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{value==="day"?"일별":value==="week"?"주별":"월별"}</button>)}</div><div className="weather-date-fields"><label htmlFor={`${id}-start`}>시작일<input type="date" id={`${id}-start`} value={start} max={end||today} required onChange={event=>setStart(event.target.value)}/></label><label htmlFor={`${id}-end`}>마지막 날<input type="date" id={`${id}-end`} value={end} min={start} max={today} required onChange={event=>setEnd(event.target.value)}/></label></div><p className="weather-help">선택한 기간을 {period==="day"?"하루":period==="week"?"일주일":"한 달"}씩 묶어 비교해요. 오늘의 실황은 일별 통계와 따로 표시해요.</p></fieldset>
      <button type="submit" className="button button--primary button--full" disabled={!selectedRegion||regionBusy.city}>{busy?"다른 조건으로 다시 조회":"날씨 살펴보기"}</button>
    </form>
    <div className="weather-disclaimer"><strong>동네마다 직접 측정한 값은 아니에요.</strong><p>지역 중심에서 가까운 관측소의 실측값을 대표자료로 사용해요. 이웃한 지역에 같은 값이 보일 수 있어요.</p></div>
    {error&&<div className="weather-error" role="alert"><p>{error}</p>{query&&<button type="button" onClick={()=>setQuery({...query,nonce:++serial.current})}>날씨 다시 불러오기</button>}</div>}
    {busy&&<p className="weather-loading" role="status">기상청 관측자료를 모으고 있어요…</p>}
    {result&&!result.configured&&<div className="weather-setup" role="status"><h2>실제 날씨자료 연결이 필요해요</h2><p>{result.notice||"관리자가 기상청 API 인증키를 설정하면 날씨를 확인할 수 있어요."}</p><p>인증키는 서버에서만 사용해요. 학생이 입력할 필요는 없어요.</p></div>}
    {result?.configured&&<section className="weather-results" aria-label="날씨 조회 결과"><header className="weather-results__heading"><h2>{result.region.fullName}</h2><p>{result.start} ~ {result.end} · {result.period==="day"?"일별":result.period==="week"?"주별":"월별"}</p></header>{queryChanged&&<p className="weather-query-notice" role="status">선택한 조건이 바뀌었어요. ‘날씨 살펴보기’를 누르면 새 조건으로 조회해요.</p>}
      {result.notice&&<p className="weather-help">{result.notice}</p>}
      {result.items.length>0?<><div className="weather-result-controls">{hasCurrent&&<div className="weather-period" role="group" aria-label="지도에 표시할 자료"><button type="button" aria-pressed={mapMode==="summary"} onClick={()=>chooseMapMode("summary")}>기간 통계</button><button type="button" aria-pressed={mapMode==="current"} onClick={()=>chooseMapMode("current")}>최근 실황</button></div>}<label htmlFor={`${id}-metric`}>지도와 그래프에 표시할 항목<select id={`${id}-metric`} value={showCounts?"weatherCounts":metric} onChange={event=>chooseMetric(event.target.value)}>{(mapMode==="current"?currentMetricKeys:Object.keys(weatherMetrics) as WeatherMetric[]).map(key=><option key={key} value={key}>{mapMode==="current"?currentLabels[key]:weatherMetrics[key].label} ({weatherMetrics[key].unit})</option>)}{mapMode==="summary"&&<option value="weatherCounts">날씨 종류별 일수</option>}</select></label>{mapMode==="current"&&<p className="weather-help">지도는 최근 실황이에요. 관측 시각은 아래 ‘최근 관측 실황’에서 확인해요. 그래프와 기간 요약은 선택한 기간의 통계예요.</p>}{showCounts&&<div className="weather-count-picker" role="group" aria-label="지도에 표시할 날씨 종류">{countKinds.map(kind=><button type="button" key={kind} aria-pressed={kind===countKind} onClick={()=>setCountKind(kind)}><span aria-hidden="true">{countEmoji[kind]}</span>{countLabels[kind]}</button>)}</div>}</div>
      <div className="weather-map"><KakaoMap autoLocate={false} points={mapPoints} selectedId={selected?.region.id} onSelectPoint={setSelectedId} focus={focus}/></div><p className="weather-map-caption">{mapMode==="current"?"최근 실황 · ":"기간 통계 · "}핀은 지역 중심 · 인근 관측소 대표자료</p>
      <label className="weather-detail-choice" htmlFor={`${id}-result`}>자세히 볼 지역<select id={`${id}-result`} value={selected?.region.id??""} onChange={event=>setSelectedId(event.target.value)}>{result.items.map(item=><option key={item.region.id} value={item.region.id}>{item.region.name}{item.region.id===result.region.id?" 전체":""}</option>)}</select></label>
      {selected&&<article className="weather-detail"><header><h3>{selected.region.name}{selected.region.id===result.region.id?" 전체":""}</h3><span className="weather-coverage">관측 {selected.summary.observedDays}/{selected.summary.expectedDays}일</span></header><p className="weather-station"><strong>{selected.station.name} 관측소</strong> · 지역 중심에서 약 {numberLabel(selected.distanceKm,"km")}<br/>관측소 위치 {selected.station.lat.toFixed(3)}, {selected.station.lng.toFixed(3)}</p>
      <div className="weather-summary"><span>{showCounts?countLabels[countKind]:metadata.label}</span><strong>{numberLabel(showCounts?countValue(selected,countKind):selected.summary.values[metric],unit)}</strong><small>선택 기간의 {showCounts?"관측값 분류 일수":metric==="rainfall"||metric==="sunshine"?"합계":metric==="minTemperature"?"최솟값":metric==="maxTemperature"||metric==="snowDepth"?"최댓값":"평균"}{!showCounts&&<> · 이 항목 {selected.summary.metricDays[metric]}/{selected.summary.expectedDays}일 관측</>}</small></div>
      <section className="weather-chart-card" aria-label="관측자료 그래프"><header><h3>{showCounts?"관측값으로 분류한 날":`${metadata.label} 변화`}</h3><div className="weather-chart-picker" role="group" aria-label="그래프 종류"><button type="button" aria-pressed={chartKind==="bar"} onClick={()=>setChartKind("bar")}>막대</button><button type="button" aria-pressed={chartKind==="line"} onClick={()=>setChartKind("line")}>꺾은선</button></div></header><WeatherChart data={showCounts?typeChart:numericChart} kind={chartKind} unit={unit} label={showCounts?"관측값으로 분류한 날":metadata.label}/>{showCounts?<><p className="weather-help">관측값을 기준으로 나눈 참고용 일수이며 공식 기상현상 분류가 아니에요. ‘강수 있는 날’은 일강수량이 0보다 큰 날로, 강수량에는 비와 눈이 포함돼요. ‘새 눈 쌓인 날’은 신적설이 0보다 큰 날이에요. 맑음·흐림은 평균 운량이 각각 2 이하·8 이상인 날로 나눠요. 각 종류는 겹칠 수 있어요. 예를 들어 맑은 날에도 잠시 비가 올 수 있어요. 분류 자료가 없으면 ‘자료 없음’으로 표시해요. 분류하지 못한 날 {selected.weatherCounts.unknown}일.</p><dl className="weather-count-values">{countKinds.map(kind=><div key={kind}><dt>{countLabels[kind]}</dt><dd>{numberLabel(countValue(selected,kind),"일")}</dd></div>)}</dl></>:<WeatherDataTable buckets={selected.series} metric={metric}/>}</section>
      {selected.current&&result.end===today&&<section className="weather-current" aria-label="최근 관측 실황"><h3>최근 관측 실황</h3><p>{timestampLabel(selected.current.observedAt)} · 한국 표준시</p><div className="weather-current-values">{currentMetricKeys.map(key=><div key={key}><span>{currentLabels[key]}</span><strong>{numberLabel(selected.current!.values[key],weatherMetrics[key].unit)}</strong></div>)}</div><small>아직 하루가 끝나지 않은 실황이에요. 위의 일별·주별·월별 통계에 합치지 않아요.</small></section>}
      </article>}
      <footer className="weather-source">자료 출처: <a href="https://data.kma.go.kr/" target="_blank" rel="noopener noreferrer">{result.source||"기상청 기상자료개방포털"}</a><p>지역 전체의 공간 평균이 아닌 대표 관측소의 자료예요. 관측소와 항목에 따라 제공 기간·누락 자료가 달라요.</p></footer></>:<p className="weather-empty">이 지역과 기간에서 표시할 관측자료를 찾지 못했어요. 다른 기간을 살펴봐 주세요.</p>}
    </section>}
    {!query&&!error&&<p className="weather-start-hint">지역과 기간을 고르고 ‘날씨 살펴보기’를 눌러 주세요.</p>}
    </div>
  </section>;
}
