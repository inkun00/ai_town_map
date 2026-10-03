import * as z from "zod";
import type { Theme } from "../lib/demo-data";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !value.startsWith("0000") && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value);
export const filterSchema = z.strictObject({
  category: z.string().min(1).max(60).optional(), rating: z.string().min(1).max(60).optional(),
  from: day.optional(), to: day.optional(),
  bbox: z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90),z.number().min(-180).max(180),z.number().min(-90).max(90)]).optional(),
  question: z.string().min(1).max(60).optional(), answer: z.string().min(1).max(500).optional(),
}).refine(f => !f.from || !f.to || f.from <= f.to, "기간을 확인해 주세요.")
  .refine(f => !f.bbox || (f.bbox[0] < f.bbox[2] && f.bbox[1] < f.bbox[3]), "지역 범위를 확인해 주세요.")
  .refine(f => !!f.question === !!f.answer, "질문과 답변을 함께 선택해 주세요.");
export type ObservationFilter = z.infer<typeof filterSchema>;
export type AnalysisRecord = { id:string; categoryKey:string; ratingKey:string|null; answers:Record<string,string[]>; createdAt:string; configRevision:number };
export type CountOption = { key:string; label:string; count:number; percent:number|null; color?:string; glyph?:string };
export type AnalysisStats = ReturnType<typeof aggregateRecords>;

export function aggregateRecords(records:AnalysisRecord[], theme:Theme, revisionThemes:Record<number,Theme> = {}) {
  const percent=(count:number,total:number)=>total ? Math.round(count / total * 1000) / 10 : null;
  const total=records.length;
  const byCategory:CountOption[]=theme.categories.map(c=>{const count=records.filter(r=>r.categoryKey===c.key).length;return {key:c.key,label:c.label,color:c.color,glyph:c.emojiOptions[0]?.glyph,count,percent:percent(count,total)};});
  const rated=theme.features.ratingEnabled && theme.rating ? records.filter(r=>theme.rating!.options.some(o=>o.key===r.ratingKey)) : [];
  const byRating:CountOption[]|null=theme.features.ratingEnabled && theme.rating ? theme.rating.options.map(o=>{const count=rated.filter(r=>r.ratingKey===o.key).length;return {...o,count,percent:percent(count,rated.length)};}) : null;
  const revisions=[...new Set(records.map(r=>r.configRevision))].sort((a,b)=>a-b);
  const questions=revisions.flatMap(revision=>(revisionThemes[revision]??theme).questions.filter(q=>q.type!=="text").map(q=>{
    const rows=records.filter(r=>r.configRevision===revision);
    const options=q.type==="boolean"?[{key:"yes",label:"있음"},{key:"no",label:"없음"}]:q.options??[];
    const valid=rows.map(r=>[...new Set(r.answers[q.key]??[])]).filter(v=>v.length>0 && v.every(key=>options.some(o=>o.key===key)));
    const unknownCount=rows.filter(r=>r.answers[q.key]?.includes("unknown")).length;
    const notApplicableCount=rows.filter(r=>r.answers[q.key]?.includes("na")).length;
    return {key:q.key,label:q.label,configRevision:revision,multiple:q.type==="multi",answeredCount:valid.length,unknownCount,notApplicableCount,missingCount:rows.length-valid.length-unknownCount-notApplicableCount,options:options.map(o=>{const count=valid.filter(v=>v.includes(o.key)).length;return {...o,count,percent:percent(count,valid.length)};})};
  }));
  const days=new Map<string,number>();
  for(const r of records){const date=new Date(new Date(r.createdAt).getTime()+9*3600000).toISOString().slice(0,10);days.set(date,(days.get(date)??0)+1);}
  const byDay=[...days.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([day,count])=>({day,count}));
  return {total,byCategory,byRating,ratedCount:byRating?rated.length:null,ratingExcludedCount:byRating?total-rated.length:null,questions,byDay,firstDay:byDay[0]?.day??null,lastDay:byDay.at(-1)?.day??null};
}

export function csvCell(value:unknown):string {
  const text=String(value??"");
  // Quoting alone does not stop spreadsheet formulas, including whitespace-prefixed ones.
  const safe=/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(text)?`'${text}`:text;
  return `"${safe.replaceAll('"','""')}"`;
}
export function filterLabel(filter:ObservationFilter,theme:Theme):string {
  return [filter.category?theme.categories.find(c=>c.key===filter.category)?.label:null,filter.rating?theme.rating?.options.find(r=>r.key===filter.rating)?.label:null,filter.from||filter.to?`${filter.from??"처음"} ~ ${filter.to??"현재"} (한국 시간)`:null,filter.bbox?"선택한 지도 영역":"지도 전체",filter.question?`${theme.questions.find(q=>q.key===filter.question)?.label??filter.question}: ${filter.answer}`:null].filter(Boolean).join(" · ");
}
