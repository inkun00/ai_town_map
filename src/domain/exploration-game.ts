import {z} from "zod";

export const missionKinds=["quiz","short_answer","observation","checklist"] as const;
export type MissionKind=typeof missionKinds[number];
export const missionLabels:Record<MissionKind,string>={quiz:"객관식 퀴즈",short_answer:"단답형 퀴즈",observation:"관찰·서술 응답",checklist:"현장 체크리스트"};
export const coordinatesSchema=z.strictObject({lat:z.number().finite().min(-90).max(90),lng:z.number().finite().min(-180).max(180)});
export const missionSchema=z.strictObject({
  pointId:z.uuid(),title:z.string().trim().min(2).max(80),prompt:z.string().trim().min(2).max(1500),
  kind:z.enum(missionKinds),points:z.number().int().min(1).max(1000).default(100),
  radiusMeters:z.number().int().min(20).max(500).default(50),maxAttempts:z.number().int().min(1).max(10).default(3),
  options:z.array(z.string().trim().min(1).max(200)).max(6).default([]),
  correctAnswers:z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  checklist:z.array(z.string().trim().min(1).max(200)).max(10).default([]),
}).superRefine((v,ctx)=>{
  if(v.kind==="quiz"&&(v.options.length<2||v.correctAnswers.length!==1||!/^\d+$/.test(v.correctAnswers[0])||Number(v.correctAnswers[0])>=v.options.length))ctx.addIssue({code:"custom",path:["correctAnswers"],message:"보기와 정답을 확인해 주세요."});
  if(v.kind==="quiz"&&new Set(v.options).size!==v.options.length)ctx.addIssue({code:"custom",path:["options"],message:"서로 다른 보기를 입력해 주세요."});
  if(v.kind==="short_answer"&&!v.correctAnswers.length)ctx.addIssue({code:"custom",path:["correctAnswers"],message:"인정할 정답을 입력해 주세요."});
  if(v.kind==="checklist"&&!v.checklist.length)ctx.addIssue({code:"custom",path:["checklist"],message:"확인할 항목을 입력해 주세요."});
});
export type MissionDefinition=z.infer<typeof missionSchema>;
export type GamePoint={id:string;title:string;emoji:string;location:{lat:number;lng:number}};
export type GameMission=Omit<MissionDefinition,"correctAnswers">&{id:string;correctAnswers?:string[];location:{lat:number;lng:number};emoji:string;pointTitle:string};
export type GameSummary={id:string;sourceMapId:string;title:string;description:string;location:string;canManage:boolean;pointCount:number;missionCount:number;status:"active"|"archived"|"deleted";deletedAt:string|null;canDelete:boolean;version:string};
export type GameDefinition=GameSummary&{points:GamePoint[];missions:GameMission[];rooms:{id:string;title:string;status:string;createdAt:string}[]};
export type RoomSummary={id:string;gameId:string;title:string;status:"lobby"|"running"|"ended";durationMinutes:number;maxPlayers:number;startsAt:string|null;endsAt:string|null;joinExpiresAt:string;serverNow:string;isHost:boolean;joinCode?:string};
export type GamePlayer={id:string;nickname:string;score:number;completed:number;rank:number;sharing:boolean;location?:{lat:number;lng:number;accuracy:number;observedAt:string}|null;lastSeenAt?:string|null};
export type SubmissionStatus="incorrect"|"pending"|"approved"|"rejected";
export type GameSubmission={id:string;playerId:string;missionId:string;status:SubmissionStatus;attempts:number;score:number;response:{choice?:number;answer?:string;checks?:number[]};reason:string|null;version:string;submittedAt:string};
export type RoomState={room:RoomSummary;missions:GameMission[];players:GamePlayer[];me:GamePlayer|null;submissions:GameSubmission[];pendingCount:number};
export const createGameSchema=z.strictObject({sourceMapId:z.uuid(),title:z.string().trim().min(2).max(80),description:z.string().trim().max(500).default(""),requestId:z.uuid()});
export const createRoomSchema=z.strictObject({title:z.string().trim().min(2).max(80),durationMinutes:z.number().int().min(1).max(180),maxPlayers:z.number().int().min(1).max(200).default(40),requestId:z.uuid()});
export const joinGameSchema=z.strictObject({code:z.string().trim().min(8).max(14),nickname:z.string().trim().min(2).max(20),locationConsent:z.literal(true)});
export const locationSchema=z.strictObject({location:coordinatesSchema,accuracy:z.number().finite().min(0).max(10000),observedAt:z.iso.datetime({offset:true})});
export const submitMissionSchema=z.strictObject({missionId:z.uuid(),requestId:z.uuid(),response:z.strictObject({choice:z.number().int().min(0).max(5).optional(),answer:z.string().trim().max(1500).optional(),checks:z.array(z.number().int().min(0).max(9)).max(10).optional()})});

export function normalizeGameAnswer(value:string){return value.normalize("NFKC").trim().replace(/\s+/g,"").toLocaleLowerCase();}
export function gameDistance(a:{lat:number;lng:number},b:{lat:number;lng:number}){
  const rad=Math.PI/180,x=(b.lat-a.lat)*rad,y=(b.lng-a.lng)*rad;
  const h=Math.sin(x/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(y/2)**2;
  return 6371008.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function arrivalFailure(location:{lat:number;lng:number;accuracy:number;observedAt:Date}|null,mission:{location:{lat:number;lng:number};radiusMeters:number},now:Date){
  if(!location||now.getTime()-location.observedAt.getTime()>45000||location.observedAt.getTime()>now.getTime()+10000)return "최근 위치를 확인한 뒤 다시 제출해 주세요.";
  if(location.accuracy>Math.max(50,mission.radiusMeters))return "위치 오차가 커요. 야외에서 위치를 다시 확인해 주세요.";
  if(gameDistance(location,mission.location)>mission.radiusMeters)return `미션 장소 반경 ${mission.radiusMeters}m 안으로 이동해 주세요.`;
  return null;
}
export function evaluateMission(definition:MissionDefinition,response:z.infer<typeof submitMissionSchema>["response"]):SubmissionStatus{
  if(definition.kind==="quiz"){
    if(response.choice===undefined||response.choice>=definition.options.length)throw new Error("보기를 선택해 주세요.");
    return String(response.choice)===definition.correctAnswers[0]?"approved":"incorrect";
  }
  if(definition.kind==="short_answer"){
    if(!response.answer?.trim())throw new Error("답을 입력해 주세요.");
    return definition.correctAnswers.some(a=>normalizeGameAnswer(a)===normalizeGameAnswer(response.answer!))?"approved":"incorrect";
  }
  if(definition.kind==="observation"&&!response.answer?.trim())throw new Error("관찰한 내용을 입력해 주세요.");
  if(definition.kind==="checklist"&&(new Set(response.checks).size!==definition.checklist.length||definition.checklist.some((_,i)=>!response.checks?.includes(i))))throw new Error("모든 항목을 직접 확인하고 체크해 주세요.");
  return "pending";
}
export function rankedPlayers<T extends {id:string;score:number;nickname:string}>(players:T[]):(T&{rank:number})[]{
  let previous:number|null=null,rank=0;
  return [...players].sort((a,b)=>b.score-a.score||a.nickname.localeCompare(b.nickname,"ko")||a.id.localeCompare(b.id)).map((p,i)=>{if(p.score!==previous)rank=i+1;previous=p.score;return {...p,rank};});
}
export function publicMission(m:GameMission):GameMission{const {correctAnswers,...safe}=m;void correctAnswers;return safe;}
