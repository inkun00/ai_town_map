import type {Theme,EmojiOption} from "../lib/demo-data.ts";

/** Append only. Old IDs, defaults, labels, meanings and disabled choices survive. */
export function emojiUpgradePlan(current:Theme,latest:Theme){
  if(current.key!==latest.key)throw new Error("Theme mismatch");
  const additions:{categoryKey:string;emoji:EmojiOption;sortOrder:number}[]=[];
  const categories=current.categories.map(category=>{
    const incoming=latest.categories.find(item=>item.key===category.key);
    if(!incoming)return category;
    const emojiOptions=[...category.emojiOptions];
    for(const emoji of incoming.emojiOptions){
      const prior=emojiOptions.find(item=>item.key===emoji.key);
      if(prior){
        if(prior.glyph!==emoji.glyph||prior.label!==emoji.label)throw new Error(`Emoji meaning conflict: ${category.key}:${emoji.key}`);
        continue;
      }
      additions.push({categoryKey:category.key,emoji,sortOrder:emojiOptions.length});
      emojiOptions.push({...emoji});
    }
    return {...category,emojiOptions};
  });
  return {theme:{...current,version:Math.max(current.version,latest.version),categories},additions};
}
