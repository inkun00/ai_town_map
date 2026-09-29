import {describe,it,expect} from "vitest";
import {themeByKey,initialPoints,getPinColor} from "../src/lib/demo-data";
import {pointRating,pointDescription,pinSvg} from "../src/domain/point-presentation";
describe("map meaning independent of color",()=>{
 it("keeps each enabled theme's own labels and symbols",()=>{for(const key of ["universal_design","safety","weather_life"] as const){const theme=themeByKey[key];for(const option of theme.rating!.options){expect(pointRating(theme,{ratingKey:option.key})).toEqual(option);}}});
 it("never adds evaluation to ecology or rating-disabled custom maps",()=>{expect(pointRating(themeByKey.ecology,{ratingKey:"improve"})).toBeNull();expect(pointRating({...themeByKey.universal_design,features:{...themeByKey.universal_design.features,ratingEnabled:false}},{ratingKey:"improve"})).toBeNull();});
 it("retains category color for weather while reporting impact separately",()=>{const theme=themeByKey.weather_life;const point=initialPoints.find(p=>p.id==="w2")!;expect(getPinColor(theme,point)).toBe(theme.categories.find(c=>c.key===point.categoryKey)!.color);expect(pointDescription(theme,point)).toContain(theme.rating!.options.find(o=>o.key===point.ratingKey)!.label);});
 it("labels missing ratings without inventing a favorable score",()=>{expect(pointRating(themeByKey.safety,{ratingKey:null})).toMatchObject({symbol:"?",label:"평가 없음"});expect(pointRating(themeByKey.safety,{ratingKey:"invalid"})).toMatchObject({symbol:"?"});});
 it("uses a neutral count instead of a representative rating for overlapping points",()=>{const svg=pinSvg("🌳","#C62828",false,"×",2);expect(svg).toContain('fill="#475569"');expect(svg).toContain('>2</text>');expect(svg).not.toContain('>×</text>');expect(pinSvg("🌳","#C62828",false,undefined,120)).toContain('>99+</text>');});
 it("escapes custom emoji and symbols before creating SVG",()=>{const svg=pinSvg('<script>&"', 'red" onload="bad',false,'<');expect(svg).not.toContain("<script>");expect(svg).not.toContain('onload=');expect(svg).toContain('&lt;script&gt;&amp;&quot;');expect(svg).toContain('&lt;</text>');});
});
