"use client";

import {useId} from "react";

export type WeatherChartSeries={
  id:string;
  label:string;
  unit:string;
  color:string;
  data:{label:string;value:number|null}[];
};
type UnitScale={unit:string;min:number;max:number;available:boolean;color:string;labels:string[]};
const isValue=(value:number|null|undefined):value is number=>typeof value==="number"&&Number.isFinite(value);
const axisNumber=(value:number)=>new Intl.NumberFormat("ko-KR",{maximumFractionDigits:2}).format(value);
const unitName=(unit:string)=>unit||"단위 없음";

/** Aligned time buckets share an x position; matching units always share a y scale. */
export function WeatherMultiChart({series,kind}:{series:WeatherChartSeries[];kind:"line"|"bar"}){
  const titleId=useId(),descriptionId=useId();
  const bucketCount=Math.max(0,...series.map(item=>item.data.length));
  const scales:UnitScale[]=[];
  for(const item of series){
    if(scales.some(scale=>scale.unit===item.unit))continue;
    const matching=series.filter(other=>other.unit===item.unit);
    const values=matching.flatMap(other=>other.data.map(point=>point.value).filter(isValue));
    const min=Math.min(0,...values),rawMax=Math.max(0,...values);
    scales.push({unit:item.unit,min,max:rawMax===min?min+1:rawMax,available:values.length>0,color:item.color,labels:matching.map(other=>other.label)});
  }
  const hasData=scales.some(scale=>scale.available);
  const labels=Array.from({length:bucketCount},(_,index)=>series.find(item=>item.data[index])?.data[index].label??"");
  // Keep the plot visible first on mobile; extra unit axes continue to its right.
  const left=78,right=16+Math.max(0,scales.length-1)*62,top=42,bottom=42,height=286;
  const width=Math.max(330,left+right+Math.max(240,bucketCount*26));
  const plotWidth=width-left-right,plotHeight=height-top-bottom;
  const x=(index:number)=>left+plotWidth*(index+.5)/Math.max(1,bucketCount);
  const y=(value:number,scale:UnitScale)=>top+(scale.max-value)/(scale.max-scale.min)*plotHeight;
  const labelEvery=Math.max(1,Math.ceil(bucketCount/8));
  const groupWidth=Math.min(48,plotWidth/Math.max(1,bucketCount)*.8);
  const barWidth=groupWidth/Math.max(1,series.length);

  return <div className="weather-multi-chart">
    <ul className="weather-multi-chart__legend" aria-label="그래프 항목과 단위">
      {series.map(item=><li className="weather-multi-chart__legend-item" key={item.id}>
        <span className="weather-multi-chart__swatch" style={{backgroundColor:item.color}} aria-hidden="true"/>
        {item.label} ({unitName(item.unit)}){!item.data.some(point=>isValue(point.value))&&<span> · 자료 없음</span>}
      </li>)}
    </ul>
    {!hasData?<p className="weather-multi-chart__empty">선택한 항목은 해당 기간의 관측자료가 없어요.</p>:<>
      {scales.length>1&&<p className="weather-multi-chart__scale-note">단위마다 별도 눈금입니다. 같은 높이가 같은 값을 뜻하지 않아요.</p>}
      <div className="weather-multi-chart__scroll" tabIndex={0} role="region" aria-label="날씨 비교 그래프, 가로로 스크롤할 수 있어요" style={{overflowX:"auto"}}>
        <svg className="weather-multi-chart__svg" viewBox={`0 0 ${width} ${height}`} style={{minWidth:width,width:"100%",display:"block",fontSize:11,fontFamily:"inherit"}} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
          <title id={titleId}>{series.map(item=>item.label).join(", ")} {kind==="line"?"꺾은선그래프":"막대그래프"}</title>
          <desc id={descriptionId}>각 항목의 단위와 눈금을 확인하세요. 같은 단위는 눈금을 공유합니다. 빈 구간은 자료 없음입니다. 점이나 막대에 표시된 도움말에서 정확한 값을 확인할 수 있어요.</desc>
          {[0,.5,1].map(fraction=><line key={fraction} x1={left} x2={width-right} y1={top+plotHeight*fraction} y2={top+plotHeight*fraction} stroke="#cbd9dc" strokeDasharray="3 4"/>)}
          {scales.map((scale,index)=>{const rightAxis=index>0,position=rightAxis?width-right+10+(index-1)*62:left-10,textX=position+(rightAxis?7:-7),anchor=rightAxis?"start":"end";return <g key={scale.unit} className="weather-multi-chart__axis" aria-label={`${unitName(scale.unit)} 축: ${scale.labels.join(", ")}`}>
            <text x={textX} y={top-18} textAnchor={anchor} fill={scale.color} fontWeight="700">{unitName(scale.unit)}</text>
            {scale.available?<>
              <line x1={position} x2={position} y1={top} y2={height-bottom} stroke={scale.color}/>
              {[0,.5,1].map(fraction=>{const value=scale.min+(scale.max-scale.min)*fraction,positionY=y(value,scale);return <g key={fraction}>
                <line x1={position} x2={position+(rightAxis?4:-4)} y1={positionY} y2={positionY} stroke={scale.color}/>
                <text x={textX} y={positionY+4} textAnchor={anchor} fill={scale.color}>{axisNumber(value)}</text>
              </g>;})}
            </>:<text x={textX} y={top+14} textAnchor={anchor} fill="#586d71">자료 없음</text>}
          </g>;})}
          {series.map((item,seriesIndex)=>{
            const scale=scales.find(candidate=>candidate.unit===item.unit)!;
            const tooltip=(index:number,value:number)=>`${labels[index]} · ${item.label}: ${String(value)}${item.unit}`;
            if(kind==="bar")return <g key={item.id} className="weather-multi-chart__series" aria-label={item.label}>
              {item.data.map((point,index)=>{if(!isValue(point.value))return null;const baseline=y(0,scale),pointY=y(point.value,scale),barX=x(index)-groupWidth/2+seriesIndex*barWidth,visibleWidth=Math.max(.5,barWidth-1);return <g key={index}>
                <rect x={barX} y={Math.min(pointY,baseline)} width={visibleWidth} height={Math.abs(pointY-baseline)} fill={item.color} rx="1" aria-label={tooltip(index,point.value)}>
                  <title>{tooltip(index,point.value)}</title>
                </rect>
                {point.value===0&&<line x1={barX} x2={barX+visibleWidth} y1={baseline} y2={baseline} stroke={item.color} strokeWidth="3" aria-label={tooltip(index,point.value)}><title>{tooltip(index,point.value)}</title></line>}
              </g>;})}
            </g>;
            const segments:{index:number;value:number}[][]=[];
            let segment:{index:number;value:number}[]=[];
            item.data.forEach((point,index)=>{if(isValue(point.value)){segment.push({index,value:point.value});}else if(segment.length){segments.push(segment);segment=[];}});
            if(segment.length)segments.push(segment);
            return <g key={item.id} className="weather-multi-chart__series" aria-label={item.label}>
              {segments.map((points,index)=>points.length>1&&<polyline key={index} points={points.map(point=>`${x(point.index)},${y(point.value,scale)}`).join(" ")} fill="none" stroke={item.color} strokeWidth="2.5"/>)}
              {item.data.map((point,index)=>!isValue(point.value)?null:<circle key={index} cx={x(index)} cy={y(point.value,scale)} r="3.5" fill={item.color} stroke="#fffdf4" strokeWidth="1" aria-label={tooltip(index,point.value)}>
                <title>{tooltip(index,point.value)}</title>
              </circle>)}
            </g>;
          })}
          {labels.map((label,index)=>index%labelEvery===0||index===bucketCount-1?<text key={index} x={x(index)} y={height-16} textAnchor="middle" fill="#243e47">{label}</text>:null)}
        </svg>
      </div>
    </>}
  </div>;
}
