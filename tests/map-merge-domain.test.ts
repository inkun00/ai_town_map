import {describe,expect,it} from "vitest";
import {buildMergedTheme,MapMergeError,mergeOriginQuestionKey,resolveMergePreview,type MergePoint,type MergeSource} from "../src/domain/map-merge";
import {themeByKey,themes,type Theme} from "../src/lib/demo-data";
import {observationSchema} from "../src/server/services/observations";
import {aggregateRecords} from "../src/domain/analysis";

function sources():MergeSource[]{
  const safety=structuredClone(themeByKey.safety);
  safety.categories.find(category=>category.key==="traffic")!.emojiOptions[0].active=false;
  const custom:Theme={key:"custom",label:"분리수거 조사",version:3,requiresConfiguration:false,features:{ratingEnabled:true,ideasEnabled:false,proposalsEnabled:false,commentsEnabled:false},pin:{mode:"category"},rating:{key:"safety",label:"재활용 상태",options:[{key:"positive",label:"분리수거가 잘돼요",symbol:"♻️",color:"#008000"},{key:"improve",label:"분류가 필요해요",symbol:"!",color:"#cc0000"}]},categories:[{key:"traffic",label:"재활용 장소",color:"#112233",defaultEmojiKey:"unused",emojiOptions:[{key:"unused",glyph:"🗑️",label:"선택하지 않은 휴지통"},{key:"traffic-1",glyph:"♻️",label:"분리수거"}]},{key:"not-selected",label:"선택하지 않은 장소",color:"#445566",defaultEmojiKey:"empty",emojiOptions:[{key:"empty",glyph:"📦",label:"상자"}]}],questions:[{key:"risk_reasons",label:"분리배출 가능 여부",type:"boolean",required:true,allowUnknown:true,allowNotApplicable:true},{key:"name",label:"장소 특징",type:"text",required:true,allowUnknown:false,allowNotApplicable:false,maxLength:80}]};
  return [safety,structuredClone(themeByKey.ecology),custom].map((theme,index)=>({id:`map-${index+1}`,title:["학교 안전 지도","공원 생태 지도","동네 분리수거 지도"][index],location:"우리 동네",version:`${index+1}:2:10`,configRevision:2,theme,visibility:index===0?"invite_only":"public",center:{lat:37,lng:127}}));
}
function points():MergePoint[]{
  const base={body:"학생들이 직접 조사해서 남긴 장소 설명입니다.",locationLabel:"학교 북쪽 입구",locationSource:"gps" as const,location:{lat:37.12345,lng:127.54321},improvementIdea:null,link:"https://example.com/observation",createdAt:"2026-10-09T15:05:20.000Z",author:"초록 탐험대",photoUrl:"/api/v1/maps/map-1/observations/point-1/photo",version:"4"};
  return [
    {...base,id:"point-1",mapId:"map-1",title:"학교 앞 신호등",categoryKey:"traffic",emojiKey:"traffic-1",ratingKey:"positive",answers:{risk_reasons:["helpful"],lighting:["sufficient"]},improvementIdea:"안내판도 크게 만들어 주세요."},
    {...base,id:"point-2",mapId:"map-2",title:"공원 느티나무",categoryKey:"plants",emojiKey:"plants-1",ratingKey:null,answers:{organism_name:["느티나무"],habitat:["park"],characteristics:["작은 새들이 쉬어 가요."]},photoUrl:null},
    {...base,id:"point-3",mapId:"map-3",title:"동네 분리수거장",categoryKey:"traffic",emojiKey:"traffic-1",ratingKey:"positive",answers:{risk_reasons:["yes"],name:["투명 페트병을 따로 모아요."]}},
  ];
}
function errorCode(run:()=>unknown){try{run();throw new Error("Expected a map merge error");}catch(error){expect(error).toBeInstanceOf(MapMergeError);return (error as MapMergeError).code;}}
function deepFreeze<T>(value:T):T{if(value&&typeof value==="object"){Object.freeze(value);Object.values(value).forEach(deepFreeze);}return value;}

describe("selected community map copies",()=>{
  it("keeps mixed-source category, emoji and rating meanings separate while copying only selected kinds",()=>{
    const originalSources=sources(),selected=points();
    const {theme,copies}=buildMergedTheme(originalSources,selected);
    expect(theme.key).toBe("custom");expect(theme.pin.mode).toBe("category");expect(theme.features.ratingEnabled).toBe(false);expect(theme.rating).toBeNull();
    expect(theme.features).toEqual({ratingEnabled:false,ideasEnabled:true,proposalsEnabled:true,commentsEnabled:true});
    expect(theme.categories.map(category=>category.key)).toEqual(["s1_c1","s2_c1","s3_c1"]);
    expect(theme.categories.map(category=>category.emojiOptions.length)).toEqual([1,1,1]);
    expect(theme.categories[0].emojiOptions[0].glyph).not.toBe(theme.categories[2].emojiOptions[0].glyph);
    expect(theme.categories[2].emojiOptions[0]).toMatchObject({key:"s3_c1_e2",glyph:"♻️",label:"분리수거",active:true});
    for(const category of theme.categories){expect(category.emojiOptions.some(emoji=>emoji.key===category.defaultEmojiKey)).toBe(true);expect(category.emojiOptions.every(emoji=>emoji.active===true)).toBe(true);expect(category.label.length).toBeLessThanOrEqual(40);}
    expect(copies.map(copy=>copy.ratingKey)).toEqual([null,null,null]);
    expect(copies[0].answers.s1_rating).toEqual(["positive"]);
    expect(copies[2].answers.s3_rating).toEqual(["positive"]);
    expect(theme.questions.find(question=>question.key==="s1_rating")?.options?.find(option=>option.key==="positive")?.label).toBe("안전에 도움");
    expect(theme.questions.find(question=>question.key==="s3_rating")?.options?.find(option=>option.key==="positive")?.label).toBe("분리수거가 잘돼요");
    expect(theme.questions.every(question=>question.required===false)).toBe(true);
    expect(theme.questions.every(question=>question.key.length<=60&&question.label.length<=60)).toBe(true);
  });

  it("preserves schema options, answers and original record metadata without aliasing source objects",()=>{
    const originalSources=deepFreeze(sources()),selected=deepFreeze(points());
    const before=JSON.stringify({sources:originalSources,points:selected});
    const {theme,copies}=buildMergedTheme(originalSources,selected);
    expect(copies[0].answers.s1_q1).toEqual(selected[0].answers.risk_reasons);
    expect(copies[2].answers.s3_q1).toEqual(["yes"]);
    expect(theme.questions.find(question=>question.key==="s1_q1")).toMatchObject({type:"multi",allowUnknown:true,allowNotApplicable:true,options:originalSources[0].theme.questions[0].options});
    expect(theme.questions.find(question=>question.key==="s2_q3")?.maxLength).toBe(1000);
    expect(theme.questions.find(question=>question.key==="s3_q1")?.type).toBe("boolean");
    expect(copies[0].original).toEqual(selected[0]);
    expect(copies[0].original.createdAt).toBe(selected[0].createdAt);
    expect(copies[0].original.photoUrl).toBe(selected[0].photoUrl);
    expect(copies[0].original.location).toEqual(selected[0].location);
    expect(copies[0].original.location).not.toBe(selected[0].location);
    expect(copies[0].answers[mergeOriginQuestionKey][0]).toContain(originalSources[0].title);
    expect(copies[0].answers[mergeOriginQuestionKey][0]).toContain(selected[0].author);
    expect(copies[0].answers[mergeOriginQuestionKey][0]).toContain("2026-10-10 00:05:20 (한국 시간)");
    copies[0].original.location.lat=0;copies[0].answers.s1_q1.push("dark");theme.questions[0].options![0].label="변경한 사본";
    expect(JSON.stringify({sources:originalSources,points:selected})).toBe(before);
  });

  it("resolves preview icons, pin colors and rating labels with each original map's schema",()=>{
    const originalSources=sources(),selected=points();
    const preview=resolveMergePreview(originalSources,selected);
    expect(preview[0]).toMatchObject({sourceTitle:"학교 안전 지도",categoryLabel:"교통안전",rating:{key:"positive",label:"안전에 도움",color:"#16803D"},pinColor:"#16803D"});
    expect(preview[1].rating).toBeNull();expect(preview[1].pinColor).toBe(originalSources[1].theme.categories[0].color);
    expect(preview[2]).toMatchObject({emoji:{key:"traffic-1",glyph:"♻️",label:"분리수거"},pinColor:"#112233",rating:{label:"분리수거가 잘돼요"}});
    preview[0].location.lng=0;preview[0].emoji.label="사본";
    expect(selected[0].location.lng).toBe(127.54321);expect(originalSources[0].theme.categories[0].emojiOptions[0].label).not.toBe("사본");
  });

  it("keeps same-place observations independent and omits unselected sources and categories",()=>{
    const originalSources=sources(),selected=points();
    const repeated={...structuredClone(selected[0]),id:"another-observation",createdAt:"2026-10-10T03:00:00Z"};
    const result=buildMergedTheme(originalSources,[selected[0],repeated]);
    expect(result.copies.map(copy=>copy.sourceId)).toEqual(["point-1","another-observation"]);
    expect(result.theme.categories).toHaveLength(1);
    expect(result.theme.questions.some(question=>question.key.startsWith("s2_")||question.key.startsWith("s3_"))).toBe(false);
    expect(result.copies[0].original.location).toEqual(result.copies[1].original.location);
  });

  it("bounds origin and schema labels without splitting supplementary Unicode characters",()=>{
    const originalSources=sources(),selected=points();
    originalSources[0].title="🧭".repeat(240);selected[0].author="🌳".repeat(240);
    const result=buildMergedTheme(originalSources,[selected[0]]);
    const origin=result.copies[0].answers[mergeOriginQuestionKey][0];
    expect(origin.length).toBeLessThanOrEqual(500);
    expect(result.theme.categories[0].label.length).toBeLessThanOrEqual(40);
    expect(result.theme.questions.every(question=>question.label.length<=60)).toBe(true);
    expect(origin).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it("keeps all built-in theme copies valid for the observation contract and analysis",()=>{
    for(const theme of themes.filter(theme=>theme.key!=="custom")){
      const source={...sources()[0],theme:structuredClone(theme)};
      const answers=Object.fromEntries(theme.questions.map(question=>[question.key,[question.type==="boolean"?"yes":question.type==="text"?"동네에서 직접 관찰한 내용입니다.":question.options![0].key]]));
      const point={...points()[0],categoryKey:theme.categories[0].key,emojiKey:theme.categories[0].defaultEmojiKey,ratingKey:theme.features.ratingEnabled?theme.rating!.options[0].key:null,answers};
      const merged=buildMergedTheme([source],[point]);
      const copy=merged.copies[0],original=copy.original;
      expect(observationSchema.safeParse({configRevision:1,title:original.title,body:original.body,locationLabel:original.locationLabel,locationSource:original.locationSource,location:original.location,categoryKey:copy.categoryKey,emojiKey:copy.emojiKey,ratingKey:copy.ratingKey,answers:copy.answers,improvementIdea:original.improvementIdea??undefined,link:original.link??undefined}).success).toBe(true);
      const statistics=aggregateRecords([{id:original.id,categoryKey:copy.categoryKey,ratingKey:copy.ratingKey,answers:copy.answers,createdAt:original.createdAt,configRevision:1}],merged.theme);
      expect(statistics.total).toBe(1);expect(statistics.byCategory[0].count).toBe(1);expect(statistics.byRating).toBeNull();
      if(theme.features.ratingEnabled)expect(statistics.questions.find(question=>question.key==="s1_rating")?.options[0].count).toBe(1);
    }
  });

  it("supports more selected categories than the custom map creation form limit",()=>{
    const source=sources()[2];source.theme.features.ratingEnabled=false;source.theme.rating=null;source.theme.questions=[];
    source.theme.categories=Array.from({length:13},(_,index)=>({key:`category-${index+1}`,label:`조사 유형 ${index+1}`,color:"#123456",defaultEmojiKey:"pin",emojiOptions:[{key:"pin",glyph:"📌",label:"조사한 장소"}]}));
    const selected=source.theme.categories.map((category,index)=>({...points()[2],id:`selected-${index+1}`,categoryKey:category.key,emojiKey:"pin",ratingKey:null,answers:{}}));
    const merged=buildMergedTheme([source],selected);
    expect(merged.theme.categories).toHaveLength(13);expect(merged.copies).toHaveLength(13);
    expect(merged.theme.features.ideasEnabled).toBe(false);
    expect(merged.theme.categories.at(-1)?.key).toBe("s1_c13");
  });

  it("rejects ratings on a source schema that has no rating feature",()=>{
    const selected=points();selected[1].ratingKey="positive";
    expect(errorCode(()=>buildMergedTheme(sources(),[selected[1]]))).toBe("INVALID_RATING");
  });

  it.each([
    ["missing category","INVALID_CATEGORY",(point:MergePoint)=>{point.categoryKey="missing";}],
    ["missing emoji","INVALID_EMOJI",(point:MergePoint)=>{point.emojiKey="missing";}],
    ["unknown source","UNKNOWN_SOURCE",(point:MergePoint)=>{point.mapId="missing";}],
    ["unknown rating","INVALID_RATING",(point:MergePoint)=>{point.ratingKey="unregistered";}],
    ["unknown question","INVALID_ANSWER",(point:MergePoint)=>{point.answers.unknown_question=["yes"];}],
    ["unknown option","INVALID_ANSWER",(point:MergePoint)=>{point.answers.risk_reasons=["unregistered"];}],
    ["exclusive unknown answer","INVALID_ANSWER",(point:MergePoint)=>{point.answers.risk_reasons=["helpful","unknown"];}],
    ["multiple single answers","INVALID_ANSWER",(point:MergePoint)=>{point.answers.lighting=["sufficient","insufficient"];}],
    ["oversized answer","INVALID_ANSWER",(point:MergePoint)=>{point.answers.risk_reasons=["x".repeat(501)];}],
    ["invalid coordinates","INVALID_LOCATION",(point:MergePoint)=>{point.location.lat=91;}],
    ["invalid registration date","INVALID_DATE",(point:MergePoint)=>{point.createdAt="not-a-date";}],
  ])("rejects %s before producing any merged data",(_label,code,change)=>{
    const originalSources=sources(),selected=points();change(selected[0]);
    expect(errorCode(()=>buildMergedTheme(originalSources,selected))).toBe(code);
  });

  it("rejects empty and duplicate selections explicitly",()=>{
    const originalSources=sources(),selected=points();
    expect(errorCode(()=>buildMergedTheme(originalSources,[]))).toBe("EMPTY_SELECTION");
    expect(errorCode(()=>buildMergedTheme([...originalSources,originalSources[0]],selected))).toBe("DUPLICATE_SOURCE");
    expect(errorCode(()=>buildMergedTheme(originalSources,[selected[0],selected[0]]))).toBe("DUPLICATE_POINT");
    expect(resolveMergePreview(originalSources,[])).toEqual([]);
  });
});
