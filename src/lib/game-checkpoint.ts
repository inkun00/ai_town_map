const checkpointPattern=/^town-map-checkpoint\.v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
const roomPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roomKey="town-map:qr-room:v1";
const checkpointKey="town-map:pending-checkpoint:v1";

// The server verifies the signature and game membership. Here we only accept
// checkpoint text or a link to this app, never a QR containing an external URL.
export function parseGameCheckpoint(input:string,expectedOrigin?:string):string|null{
  if(input.length>4096)return null;
  const value=input.trim();
  if(value.length<=1024&&checkpointPattern.test(value))return value;
  const origin=expectedOrigin??(typeof window!=="undefined"?window.location.origin:undefined);
  if(!origin)return null;
  try{
    const url=new URL(value);
    if(url.origin!==origin||url.username||url.password||url.pathname!=="/games/checkpoint"||url.search)return null;
    const params=new URLSearchParams(url.hash.slice(1));
    if([...params.keys()].length!==1||!params.has("code"))return null;
    const code=params.get("code")??"";
    return code.length<=1024&&checkpointPattern.test(code)?code:null;
  }catch{return null;}
}

function save(key:string,value:string,lifetime:number){
  try{window.localStorage.setItem(key,JSON.stringify({value,expiresAt:Date.now()+lifetime}));}catch{/* Storage may be unavailable in a private browser. */}
}
function read(key:string):string|null{
  try{
    const stored=window.localStorage.getItem(key);
    if(!stored)return null;
    const data=JSON.parse(stored) as {value?:unknown;expiresAt?:unknown};
    if(typeof data.value!=="string"||typeof data.expiresAt!=="number"||data.expiresAt<=Date.now()){
      window.localStorage.removeItem(key);return null;
    }
    return data.value;
  }catch{return null;}
}
export function rememberGameRoom(roomId:string){if(roomPattern.test(roomId))save(roomKey,roomId,8*60*60*1000);}
export function getRememberedGameRoom():string|null{const roomId=read(roomKey);return roomId&&roomPattern.test(roomId)?roomId:null;}
export function savePendingCheckpoint(code:string){const parsed=parseGameCheckpoint(code);if(parsed)save(checkpointKey,parsed,2*60*60*1000);}
export function takePendingCheckpoint():string|null{
  const code=read(checkpointKey);
  try{window.localStorage.removeItem(checkpointKey);}catch{/* Scanner remains available when storage is blocked. */}
  return code?parseGameCheckpoint(code):null;
}
