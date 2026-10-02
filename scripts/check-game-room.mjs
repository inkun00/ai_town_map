// Local HTTP integration check with fictional participants and mission coordinates.
// Run against a disposable room that has one quiz (first option correct) and one observation.
// Start/end the room and approve the response from the teacher browser while this runs.
// No browser/user session is read, no real device position is requested.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
const [origin,code]=process.argv.slice(2);
if(!/^http:\/\/localhost:\d+$/.test(origin??"")||!code)throw new Error("Usage: node scripts/check-game-room.mjs http://localhost:3001 ROOM-CODE (local QA only)");
async function api(path,body,actor){
 const res=await fetch(origin+path,{headers:{...(body?{"Content-Type":"application/json",Origin:origin}:{}),...(actor?{Cookie:actor.cookies,...(body?{"X-CSRF-Token":actor.csrf}:{})}:{})},...(body?{method:"POST",body:JSON.stringify(body)}:{})});
 const value=await res.json();if(!res.ok)throw new Error(`${res.status} ${value.error?.code}: ${value.error?.message}`);
 return {data:value.data,response:res};
}
async function join(nickname){
 const result=await api("/api/v1/game-rooms/join",{code,nickname,locationConsent:true});
 const cookies=result.response.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
 const actor={cookies,csrf:""};actor.csrf=(await api("/api/v1/session",undefined,actor)).data.csrfToken;
 return {actor,roomId:result.data.roomId};
}
const one=await join("가상 탐험가 A"),two=await join("가상 탐험가 B");assert.equal(one.roomId,two.roomId);
const base=`/api/v1/game-rooms/${one.roomId}`;
let state=(await api(base,undefined,one.actor)).data;
assert.equal(state.room.isHost,false);assert.equal(state.room.joinCode,undefined);
assert.ok(state.missions.every(m=>m.correctAnswers===undefined));
assert.ok(state.players.filter(p=>p.id!==state.me.id).every(p=>!Object.hasOwn(p,"location")));
console.log("Two fictional students joined; answers, code and peer GPS are hidden. Start the teacher room now.");
const deadline=Date.now()+180000;
while(state.room.status==="lobby"&&Date.now()<deadline){await new Promise(r=>setTimeout(r,2000));state=(await api(base,undefined,one.actor)).data;}
assert.equal(state.room.status,"running");
const quiz=state.missions.find(m=>m.kind==="quiz"),observation=state.missions.find(m=>m.kind==="observation");assert.ok(quiz&&observation);
async function locate(actor,mission){await api(base+"/location",{location:mission.location,accuracy:5,observedAt:new Date().toISOString()},actor);}
await locate(one.actor,quiz);await locate(two.actor,quiz);
const request={missionId:quiz.id,requestId:randomUUID(),response:{choice:0}};
const result=(await api(base+"/submissions",request,one.actor)).data;assert.equal(result.status,"approved");
assert.equal((await api(base+"/submissions",request,one.actor)).data.id,result.id);
assert.equal((await api(base,undefined,one.actor)).data.me.score,quiz.points);
await locate(one.actor,observation);
assert.equal((await api(base+"/submissions",{missionId:observation.id,requestId:randomUUID(),response:{answer:"가상 관찰: 나무에 잎이 있고 그늘이 생깁니다. 쉬는 의자를 늘리면 좋겠습니다."}},one.actor)).data.status,"pending");
assert.equal((await api(base,undefined,one.actor)).data.me.score,quiz.points);
console.log("Quiz scored once; observation is pending with zero extra score. Approve it and end the teacher room now.");
state=(await api(base,undefined,one.actor)).data;
const finishDeadline=Date.now()+180000;
while(state.room.status!=="ended"&&Date.now()<finishDeadline){await new Promise(r=>setTimeout(r,2000));state=(await api(base,undefined,one.actor)).data;}
assert.equal(state.room.status,"ended");assert.equal(state.pendingCount,0);
assert.equal(state.me.score,quiz.points+observation.points);assert.equal(state.me.rank,1);assert.equal(state.me.location,null);assert.equal(state.me.sharing,false);
assert.ok(state.players.filter(p=>p.id!==state.me.id).every(p=>!Object.hasOwn(p,"location")));
console.log("PASS: real HTTP join, location, server grading, idempotency, teacher approval, ranking and GPS cleanup.");
