import {describe,it,expect} from "vitest";
import {aggregateRecords,csvCell,filterSchema,type AnalysisRecord} from "../src/domain/analysis";
import {themeByKey,type Theme} from "../src/lib/demo-data";
const theme:Theme={...themeByKey.universal_design,questions:[{key:"access",label:"이동",type:"single",required:false,allowUnknown:true,allowNotApplicable:true,options:[{key:"yes",label:"가능"},{key:"no",label:"불가"}]},{key:"reasons",label:"이유",type:"multi",required:false,allowUnknown:true,allowNotApplicable:true,options:[{key:"a",label:"가"},{key:"b",label:"나"}]}]};
const record=(id:string,answers:Record<string,string[]>,ratingKey:string|null="positive",configRevision=1):AnalysisRecord=>({id,answers,ratingKey,categoryKey:theme.categories[0].key,createdAt:"2026-09-28T15:01:00Z",configRevision});
describe("analysis denominators",()=>{
  it("excludes unknown, N/A and missing, deduplicates multi responses, and uses KST dates",()=>{
    const result=aggregateRecords([record("1",{access:["yes"],reasons:["a","a","b"]}),record("2",{access:["no"],reasons:["b"]}),record("3",{access:["unknown"]},null),record("4",{access:["na"]},"invalid"),record("5",{})],theme);
    expect(result.total).toBe(5);expect(result.ratedCount).toBe(3);expect(result.ratingExcludedCount).toBe(2);
    expect(result.questions[0]).toMatchObject({answeredCount:2,unknownCount:1,notApplicableCount:1,missingCount:1});
    expect(result.questions[0].options.map(o=>o.percent)).toEqual([50,50]);
    expect(result.questions[1].options.map(o=>o.percent)).toEqual([50,100]);
    expect(result.byDay).toEqual([{day:"2026-09-29",count:5}]);
  });
  it("has no rating stats for an ecology map and no zero-denominator percentages",()=>{
    expect(aggregateRecords([record("1",{})],themeByKey.ecology).byRating).toBeNull();
    expect(aggregateRecords([],theme).byRating?.every(o=>o.percent===null)).toBe(true);
    expect(aggregateRecords([record("1",{access:["unknown"]})],theme).questions[0].options[0].percent).toBeNull();
  });
  it("keeps question configuration revisions separate",()=>{
    const changed={...theme,questions:[{...theme.questions[0],label:"새 질문"}]};
    const data=aggregateRecords([record("1",{access:["yes"]},"positive",1),record("2",{access:["no"]},"positive",2)],changed,{1:theme,2:changed});
    expect(data.questions.filter(q=>q.key==="access").map(q=>[q.label,q.answeredCount,q.configRevision])).toEqual([["이동",1,1],["새 질문",1,2]]);
  });
});
describe("exports and filters",()=>{
  it("neutralizes formulas and preserves quotes and multiline Korean",()=>{
    for(const value of ['=1+1',' +cmd','\t@sum(1)','-1','\n=2'])expect(csvCell(value).startsWith('"\'')).toBe(true);
    expect(csvCell('나무, "그늘"\n관찰')).toBe('"나무, ""그늘""\n관찰"');
  });
  it("rejects reversed dates, invalid calendar dates and bounds",()=>{
    expect(filterSchema.safeParse({from:"2026-02-30"}).success).toBe(false);
    expect(filterSchema.safeParse({from:"2026-09-30",to:"2026-09-01"}).success).toBe(false);
    expect(filterSchema.safeParse({bbox:[128,36,127,37]}).success).toBe(false);
    expect(filterSchema.safeParse({question:"a"}).success).toBe(false);
  });
});
