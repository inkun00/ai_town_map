import "server-only";
import {createHmac,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {getServerConfig} from "@/server/env";

const checkpointSchema=z.strictObject({gameId:z.uuid(),pointId:z.uuid()});
const proofSchema=z.strictObject({gameId:z.uuid(),roomId:z.uuid(),playerId:z.uuid(),pointId:z.uuid(),expiresAt:z.number().int().positive()});
type CheckpointScope=z.infer<typeof checkpointSchema>;
type ProofScope=z.infer<typeof proofSchema>;
const checkpointPrefix="town-map-checkpoint.v1";
const proofPrefix="town-map-arrival.v1";

function signature(prefix:string,payload:string){
  return createHmac("sha256",getServerConfig().invitePepper).update(`${prefix}.${payload}`).digest();
}
function sign(prefix:string,payload:unknown){
  const encoded=Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${prefix}.${encoded}.${signature(prefix,encoded).toString("base64url")}`;
}
function read(prefix:string,token:string):unknown{
  if(token.length>1024||!token.startsWith(`${prefix}.`))return null;
  const parts=token.slice(prefix.length+1).split(".");
  if(parts.length!==2||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p))||parts[1].length!==43)return null;
  const received=Buffer.from(parts[1],"base64url"),expected=signature(prefix,parts[0]);
  if(received.length!==expected.length||received.toString("base64url")!==parts[1]||!timingSafeEqual(received,expected))return null;
  try{return JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"));}catch{return null;}
}
// A printout remains valid across rooms of this game. It contains no answer or player data.
export function createCheckpointCode(scope:CheckpointScope){return sign(checkpointPrefix,checkpointSchema.parse(scope));}
export function readCheckpointCode(code:string):CheckpointScope|null{
  const parsed=checkpointSchema.safeParse(read(checkpointPrefix,code));return parsed.success?parsed.data:null;
}
export function createCheckpointProof(scope:ProofScope){return sign(proofPrefix,proofSchema.parse(scope));}
export function validCheckpointProof(proof:string,expected:ProofScope,now:Date){
  const parsed=proofSchema.safeParse(read(proofPrefix,proof));if(!parsed.success)return false;
  const value=parsed.data;
  return value.gameId===expected.gameId&&value.roomId===expected.roomId&&value.playerId===expected.playerId&&value.pointId===expected.pointId&&value.expiresAt===expected.expiresAt&&value.expiresAt>now.getTime();
}
