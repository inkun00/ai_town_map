export const PHOTO_SOURCE_LIMIT=20*1024*1024;
export const PHOTO_UPLOAD_LIMIT=1500*1024;
export function photoDimensions(width:number,height:number,edge=1600){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width*height>40_000_000)throw new Error("사진 해상도가 너무 큽니다. 4천만 화소 이하의 사진을 선택해 주세요.");
  const scale=Math.min(1,edge/Math.max(width,height));return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
export async function preparePhoto(file:File):Promise<File>{
  if(!file.size||file.size>PHOTO_SOURCE_LIMIT)throw new Error("사진 원본은 20MB 이하여야 합니다.");
  if(!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)&&!(!file.type&&/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)))throw new Error("JPG, PNG, WebP 사진을 선택해 주세요. HEIC는 이 브라우저에서 열 수 있어야 합니다.");
  const url=URL.createObjectURL(file);const img=new Image();
  try{
    img.src=url;try{await img.decode();}catch{throw new Error("이 브라우저에서 사진을 열 수 없습니다. JPG 또는 PNG로 변환해 다시 선택해 주세요.");}
    const size=photoDimensions(img.naturalWidth,img.naturalHeight);const canvas=document.createElement("canvas");canvas.width=size.width;canvas.height=size.height;
    const context=canvas.getContext("2d");if(!context)throw new Error("사진을 줄일 수 없습니다. 다른 브라우저에서 다시 시도해 주세요.");
    context.fillStyle="#fff";context.fillRect(0,0,size.width,size.height);context.drawImage(img,0,0,size.width,size.height);
    try{for(const quality of [0.82,0.68,0.5]){const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));if(blob&&blob.size<=PHOTO_UPLOAD_LIMIT)return new File([blob],file.name.replace(/\.[^.]+$/,"")+".jpg",{type:"image/jpeg"});}throw new Error("사진을 충분히 줄이지 못했습니다. 작은 사진을 선택해 주세요.");}finally{canvas.width=canvas.height=1;}
  }finally{URL.revokeObjectURL(url);}
}
export type PhotoResult={photoUrl:string;status:"pending"|"published";version:string};
export class UploadError extends Error{constructor(message:string,public status=0){super(message);}}
export function uploadPreparedPhoto(url:string,file:File,csrf:string,onProgress:(percent:number)=>void):Promise<PhotoResult>{
  return new Promise((resolve,reject)=>{
    if(file.size>PHOTO_UPLOAD_LIMIT){reject(new UploadError("사진을 다시 선택해 크기를 줄여 주세요."));return;}
    const xhr=new XMLHttpRequest();xhr.open("POST",url);xhr.timeout=90000;xhr.setRequestHeader("Content-Type",file.type);xhr.setRequestHeader("X-CSRF-Token",csrf);
    xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.min(100,Math.round(event.loaded/event.total*100)));};
    xhr.upload.onload=()=>onProgress(100);
    xhr.onerror=()=>reject(new UploadError("연결이 끊겼습니다. 본문은 저장되어 있으니 사진만 다시 시도해 주세요."));
    xhr.ontimeout=()=>reject(new UploadError("사진 응답 시간이 초과됐습니다. 연결을 확인하고 다시 시도해 주세요."));
    xhr.onabort=()=>reject(new UploadError("사진 전송이 중단됐습니다."));
    xhr.onload=()=>{let payload;try{payload=JSON.parse(xhr.responseText);}catch{/* Hosting errors may be plain text. */}
      if(xhr.status<200||xhr.status>=300){reject(new UploadError(xhr.status===401?"로그인이 만료됐습니다. 다시 로그인한 뒤 사진을 선택해 주세요.":xhr.status===413?"사진 크기가 전송 한도를 넘었습니다. 작은 사진을 다시 선택해 주세요.":payload?.error?.message??"사진 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.",xhr.status));return;}
      if(!payload?.data?.photoUrl){reject(new UploadError("사진 저장 결과를 확인하지 못했습니다. 다시 시도해 주세요."));return;}resolve({...payload.data,photoUrl:`${payload.data.photoUrl}?v=${encodeURIComponent(payload.data.version)}`});
    };onProgress(0);xhr.send(file);
  });
}
