import {describe,it,expect} from "vitest";
import {emojiUpgradePlan} from "../src/domain/emoji-upgrade";
import {themes,type Theme} from "../src/lib/demo-data";
import {themeVersions} from "../src/server/theme-history";

describe("이모지 확장과 과거 기록 보존",()=>{
  it("네 기본 주제에 100개 이상을 제공하고 원래 키와 의미를 보존한다",()=>{
    for(const latest of themes.filter(theme=>theme.key!=="custom")){
      const legacy=themeVersions.find(theme=>theme.key===latest.key&&theme.version===1)!;
      expect(latest.categories.reduce((sum,c)=>sum+c.emojiOptions.length,0)).toBeGreaterThanOrEqual(100);
      const plan=emojiUpgradePlan(legacy,latest);
      expect(plan.additions.length).toBeGreaterThan(80);
      for(const category of legacy.categories){
        const expanded=plan.theme.categories.find(c=>c.key===category.key)!;
        expect(expanded.defaultEmojiKey).toBe(category.defaultEmojiKey);
        expect(expanded.emojiOptions.slice(0,category.emojiOptions.length)).toEqual(category.emojiOptions);
        expect(new Set(expanded.emojiOptions.map(e=>e.key)).size).toBe(expanded.emojiOptions.length);
        expect(expanded.emojiOptions.length).toBeLessThanOrEqual(32);
      }
    }
  });
  it("비활성 이모지와 지도별 기능·평가·질문을 보존하며 반복 실행은 추가하지 않는다",()=>{
    const original=structuredClone(themeVersions.find(t=>t.key==="universal_design"&&t.version===1)!);
    original.categories[0].emojiOptions[1].active=false;
    original.features.proposalsEnabled=false;
    const plan=emojiUpgradePlan(original,themes.find(t=>t.key===original.key)!);
    expect(plan.theme.features).toEqual(original.features);
    expect(plan.theme.pin).toEqual(original.pin);
    expect(plan.theme.rating).toEqual(original.rating);
    expect(plan.theme.questions).toEqual(original.questions);
    expect(plan.theme.categories[0].emojiOptions[1].active).toBe(false);
    expect(emojiUpgradePlan(plan.theme,themes.find(t=>t.key===original.key)!).additions).toEqual([]);
    expect(original.version).toBe(1);
  });
  it("다른 주제와 같은 키의 의미 변경은 거부한다",()=>{
    const original=themes[0];
    expect(()=>emojiUpgradePlan(original,themes[1])).toThrow("Theme mismatch");
    const conflict=structuredClone(original) as Theme;
    conflict.categories[0].emojiOptions[0].glyph="☕";
    expect(()=>emojiUpgradePlan(original,conflict)).toThrow("Emoji meaning conflict");
  });
});
