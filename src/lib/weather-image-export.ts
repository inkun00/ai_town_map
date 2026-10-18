export type WeatherImageOptions={title:string;subtitle:string;details?:string[];legend?:{label:string;color:string}[];footnotes?:string[]};

const FONT='system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
const PNG_FALLBACK="PNG 저장을 이용해 주세요.";
const STYLE_PROPERTIES=["color","fill","fill-opacity","fill-rule","stroke","stroke-width","stroke-opacity","stroke-linecap","stroke-linejoin","stroke-miterlimit","stroke-dasharray","stroke-dashoffset","opacity","font-family","font-size","font-weight","font-style","font-variant","font-stretch","letter-spacing","word-spacing","text-anchor","dominant-baseline","alignment-baseline","paint-order","vector-effect","shape-rendering","text-rendering","visibility","display","stop-color","stop-opacity","clip-path","mask","filter"];
class WeatherImageError extends Error{}

function fail(message:string):never{throw new WeatherImageError(message);}
function dimensions(svg:SVGSVGElement){
  const viewBox=(svg.getAttribute("viewBox")??"").trim().split(/[\s,]+/).map(Number);
  if(viewBox.length===4&&viewBox.every(Number.isFinite)&&viewBox[2]>0&&viewBox[3]>0)return {width:viewBox[2],height:viewBox[3]};
  const rect=svg.getBoundingClientRect(),width=Number.parseFloat(svg.getAttribute("width")??"")||rect.width,height=Number.parseFloat(svg.getAttribute("height")??"")||rect.height;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)fail("이미지로 저장할 지도나 그래프의 크기를 확인할 수 없어요.");
  return {width,height};
}
function safeStyleValue(value:string,base:string):string{
  return value.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi,(_match,_quote:string,reference:string)=>{
    if(reference.startsWith("#"))return `url(${reference})`;
    try{const url=new URL(reference,base),documentUrl=new URL(base);if(url.hash&&url.origin===documentUrl.origin&&url.pathname===documentUrl.pathname&&url.search===documentUrl.search)return `url(${url.hash})`;}catch{/* External or invalid resources are excluded. */}
    return "none";
  });
}
/** Snapshot the live SVG before any asynchronous rendering or clipboard work. */
function snapshotSvg(svg:SVGSVGElement,width:number,height:number):string{
  const clone=svg.cloneNode(true) as SVGSVGElement;
  const sources=[svg,...svg.querySelectorAll("*")],targets=[clone,...clone.querySelectorAll("*")];
  const getStyle=svg.ownerDocument.defaultView?.getComputedStyle.bind(svg.ownerDocument.defaultView);
  sources.forEach((source,index)=>{
    const target=targets[index];if(!(target instanceof SVGElement))return;
    const computed=getStyle?.(source);target.removeAttribute("style");
    if(computed)for(const property of STYLE_PROPERTIES){const value=computed.getPropertyValue(property);if(value)target.style.setProperty(property,safeStyleValue(value,svg.baseURI));}
    for(const attribute of [...target.attributes]){
      if(/^on/i.test(attribute.name))target.removeAttribute(attribute.name);
      if(/^(?:xlink:)?href$/i.test(attribute.name)&&!attribute.value.startsWith("#"))target.removeAttribute(attribute.name);
    }
  });
  clone.querySelectorAll("foreignObject,script,style,image,feImage,iframe,animate,animateMotion,animateTransform,set").forEach(element=>element.remove());
  clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
  clone.setAttribute("width",String(width));clone.setAttribute("height",String(height));
  if(!clone.hasAttribute("viewBox"))clone.setAttribute("viewBox",`0 0 ${width} ${height}`);
  clone.style.setProperty("width",`${width}px`);clone.style.setProperty("height",`${height}px`);
  clone.style.setProperty("min-width","0");clone.style.setProperty("max-width","none");clone.style.setProperty("max-height","none");
  clone.style.setProperty("overflow","hidden");
  return new XMLSerializer().serializeToString(clone);
}

function wrapText(context:CanvasRenderingContext2D,text:string,maxWidth:number):string[]{
  const lines:string[]=[];
  for(const paragraph of text.split(/\r?\n/)){
    let current="";
    for(const char of Array.from(paragraph)){
      if(current&&context.measureText(current+char).width>maxWidth){
        const space=current.lastIndexOf(" ");
        if(space>current.length/2){lines.push(current.slice(0,space));current=current.slice(space+1)+char;}
        else{lines.push(current.trimEnd());current=char.trimStart();}
      }else current+=char;
    }
    lines.push(current.trimEnd());
  }
  return lines;
}
type TextRow={text:string;font:string;color:string;y:number;x:number;swatch?:string};
function imageLayout(context:CanvasRenderingContext2D,options:WeatherImageOptions,width:number,graphicHeight:number){
  const rows:TextRow[]=[],padding=24,maxWidth=width-padding*2;
  let y=padding;
  const add=(text:string,size:number,weight:number,color:string,x=padding,available=maxWidth,swatch?:string)=>{
    if(!text.trim())return;
    const font=`${weight} ${size}px ${FONT}`;context.font=font;
    const lines=wrapText(context,text,available),lineHeight=Math.ceil(size*1.45);
    lines.forEach((line,index)=>{rows.push({text:line,font,color,y:y+size,x,swatch:index===0?swatch:undefined});y+=lineHeight;});
    y+=4;
  };
  add(options.title,20,700,"#173e51");add(options.subtitle,13,500,"#385e64");
  for(const detail of options.details??[])add(detail,12,400,"#385e64");
  for(const item of options.legend??[])add(item.label,12,500,"#173e51",padding+20,maxWidth-20,item.color);
  const graphicY=y+12;y=graphicY+graphicHeight+18;
  for(const footnote of options.footnotes??[])add(footnote,11,400,"#4d6267");
  return {rows,graphicY,height:y+padding};
}
function loadImage(url:string):Promise<HTMLImageElement>{
  return new Promise((resolve,reject)=>{
    const image=new Image(),timer=window.setTimeout(()=>{image.onload=null;image.onerror=null;image.src="";reject(new WeatherImageError("이미지 생성 시간이 길어지고 있어요. 잠시 후 다시 시도해 주세요."));},20000);
    image.onload=()=>{window.clearTimeout(timer);image.onload=null;image.onerror=null;resolve(image);};
    image.onerror=()=>{window.clearTimeout(timer);image.onload=null;image.onerror=null;reject(new WeatherImageError("지도나 그래프를 이미지로 만들지 못했어요. 화면을 다시 열고 시도해 주세요."));};
    image.src=url;
  });
}

/** Pure SVG rasterization: no tile/HTML capture and no external resource loading. */
export async function createWeatherPng(svg:SVGSVGElement,options:WeatherImageOptions):Promise<Blob>{
  if(typeof document==="undefined"||typeof Image==="undefined")fail("이미지 저장은 웹 브라우저에서 사용할 수 있어요.");
  const graphic=dimensions(svg),snapshot=snapshotSvg(svg,graphic.width,graphic.height);
  const captions:WeatherImageOptions={title:options.title,subtitle:options.subtitle,details:[...(options.details??[])],legend:options.legend?.map(item=>({...item})),footnotes:[...(options.footnotes??[])]};
  const canvas=document.createElement("canvas"),context=canvas.getContext("2d");
  if(!context)fail("이 브라우저에서는 이미지를 만들 수 없어요. 다른 브라우저에서 PNG 저장을 시도해 주세요.");
  const width=Math.max(360,graphic.width+48),layout=imageLayout(context,captions,width,graphic.height);
  // Bound dimensions and total allocation on mobile, including all captions.
  const scale=Math.min(2,8192/width,8192/layout.height,Math.sqrt(16_000_000/(width*layout.height)));
  canvas.width=Math.max(1,Math.floor(width*scale));canvas.height=Math.max(1,Math.floor(layout.height*scale));
  const url=URL.createObjectURL(new Blob([snapshot],{type:"image/svg+xml;charset=utf-8"}));
  try{
    const image=await loadImage(url);
    context.scale(scale,scale);context.fillStyle="#fff";context.fillRect(0,0,width,layout.height);
    context.drawImage(image,(width-graphic.width)/2,layout.graphicY,graphic.width,graphic.height);
    context.textBaseline="alphabetic";
    for(const row of layout.rows){
      context.font=row.font;context.fillStyle=row.color;
      if(row.swatch){context.fillStyle=row.swatch;context.fillRect(row.x-20,row.y-10,11,11);context.fillStyle=row.color;}
      context.fillText(row.text,row.x,row.y);
    }
    return await new Promise<Blob>((resolve,reject)=>{
      canvas.toBlob(blob=>blob&&blob.size?resolve(blob):reject(new WeatherImageError("PNG 파일을 만들지 못했어요. 잠시 후 다시 시도해 주세요.")),"image/png");
    });
  }catch(error){
    if(error instanceof WeatherImageError)throw error;
    throw new WeatherImageError("이미지를 저장하지 못했어요. 화면을 다시 열고 PNG 저장을 시도해 주세요.");
  }finally{URL.revokeObjectURL(url);canvas.width=canvas.height=1;}
}

/** write() runs in the click stack; Safari receives the eventual PNG as a Promise. */
export function copyWeatherPng(create:()=>Promise<Blob>):Promise<void>{
  if(typeof navigator==="undefined"||!navigator.clipboard?.write||typeof ClipboardItem==="undefined"||globalThis.isSecureContext===false||typeof ClipboardItem.supports==="function"&&!ClipboardItem.supports("image/png"))return Promise.reject(new WeatherImageError(`이 브라우저에서는 이미지 복사를 지원하지 않아요. ${PNG_FALLBACK}`));
  const png=Promise.resolve().then(create);void png.catch(()=>{});
  try{
    const item=new ClipboardItem({"image/png":png});
    return Promise.resolve(navigator.clipboard.write([item])).catch(error=>{
      const denied=error instanceof DOMException&&error.name==="NotAllowedError";
      throw new WeatherImageError(denied?`이미지 복사가 허용되지 않았어요. 브라우저의 클립보드 권한을 확인하거나 ${PNG_FALLBACK}`:`이미지를 복사하지 못했어요. ${PNG_FALLBACK}`);
    });
  }catch{
    return Promise.reject(new WeatherImageError(`이미지 복사를 시작하지 못했어요. ${PNG_FALLBACK}`));
  }
}

export function downloadWeatherPng(blob:Blob,filename:string):void{
  const url=URL.createObjectURL(blob),anchor=document.createElement("a");
  anchor.href=url;anchor.download=filename;anchor.style.display="none";document.body.appendChild(anchor);
  try{anchor.click();}finally{anchor.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);}
}

export function weatherImageFilename(title:string,start:string,end:string):string{
  const clean=(value:string)=>value.normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g,"_").replace(/\s+/g," ").replace(/^[. ]+|[. ]+$/g,"").slice(0,70);
  const parts=[clean(title)||"날씨지도",clean(start),clean(end)].filter(Boolean);
  return `${parts.join("_")}.png`;
}
