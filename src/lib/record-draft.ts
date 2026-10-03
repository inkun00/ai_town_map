import * as z from "zod";

const text=z.string().max(10000);
export const recordDraftSchema=z.object({title:text,body:text,categoryKey:text,emojiKey:text,ratingKey:text,location:text,idea:text,imageName:text,link:text,answers:z.record(z.string().max(100),z.array(text).max(100))});
export type RecordDraft=z.infer<typeof recordDraftSchema>;
const envelope=z.object({format:z.literal(1),updatedAt:z.number(),mapId:z.string().uuid(),editingId:z.string().uuid().nullable(),editingVersion:z.string().nullable(),configRevision:z.number().int(),draft:recordDraftSchema,coordinates:z.object({lat:z.number().min(-90).max(90),lng:z.number().min(-180).max(180)}).nullable(),source:z.enum(["gps","search","manual"]),step:z.number().int().min(0).max(2),request:z.object({key:z.string().uuid(),payload:z.string().max(100000)}).nullable(),savedPointId:z.string().uuid().nullable()});
export type SavedRecordDraft=z.infer<typeof envelope>;
export const DRAFT_PREFIX="moa:record:v1:";
export const DRAFT_TTL=24*60*60*1000;
export function draftKey(scope:string,mapId:string,editingId:string|null){return `${DRAFT_PREFIX}${scope}:${mapId}:${editingId??"new"}`;}
export function decodeDraft(raw:string|null,now=Date.now()):SavedRecordDraft|null{
  if(!raw||raw.length>150000)return null;
  try{const parsed=envelope.safeParse(JSON.parse(raw));return parsed.success&&parsed.data.updatedAt<=now+60000&&now-parsed.data.updatedAt<DRAFT_TTL?parsed.data:null;}catch{return null;}
}
export function readDrafts(storage:Storage,scope:string,mapId:string){
  const result:SavedRecordDraft[]=[];const prefix=`${DRAFT_PREFIX}${scope}:${mapId}:`;
  for(let i=storage.length-1;i>=0;i--){const key=storage.key(i);if(!key?.startsWith(prefix))continue;const entry=decodeDraft(storage.getItem(key));if(!entry||entry.mapId!==mapId||key!==draftKey(scope,mapId,entry.editingId)){storage.removeItem(key);continue;}result.push(entry);}
  return result.sort((a,b)=>b.updatedAt-a.updatedAt);
}
export function clearDrafts(storage:Storage){for(let i=storage.length-1;i>=0;i--){const key=storage.key(i);if(key?.startsWith(DRAFT_PREFIX))storage.removeItem(key);}}
export function saveDraft(storage:Storage,scope:string,value:SavedRecordDraft){storage.setItem(draftKey(scope,value.mapId,value.editingId),JSON.stringify(value));}
