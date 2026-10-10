import "server-only";
import type {PoolClient} from "pg";
import type {Theme} from "@/lib/demo-data";
import {findCatalogEmoji,normalizeEmoji} from "@/lib/emoji-catalog";
import {ApiError} from "@/server/http";

// The caller holds the map lock and has already checked record-writing permission.
// Add only trusted catalog choices, preserving category, ratings and old snapshots.
export async function registerObservationEmoji(client:PoolClient,map:{id:string;config_revision:number},principalId:string,theme:Theme,categoryKey:string,emojiKey:string):Promise<Theme>{
  const category=theme.categories.find(item=>item.key===categoryKey);
  if(!category)throw new ApiError(422,"INVALID_EMOJI","관찰 유형을 확인해 주세요.");
  if(category.emojiOptions.some(item=>item.key===emojiKey))return theme;
  const emoji=findCatalogEmoji(emojiKey);
  if(!emoji)throw new ApiError(422,"INVALID_EMOJI","사용할 수 없는 이모지입니다.");
  const categoryRow=await client.query<{id:string}>("SELECT id FROM app.categories WHERE map_id=$1 AND key=$2 AND active=true",[map.id,categoryKey]);
  const categoryId=categoryRow.rows[0]?.id;
  if(!categoryId)throw new ApiError(422,"INVALID_EMOJI","사용할 수 없는 관찰 유형입니다.");
  const registered=await client.query<{glyph:string}>("SELECT glyph FROM app.emoji_options WHERE map_id=$1 AND category_id=$2",[map.id,categoryId]);
  if(registered.rows.some(item=>normalizeEmoji(item.glyph)===normalizeEmoji(emoji.glyph)))throw new ApiError(422,"INVALID_EMOJI","지도의 기존 이모지를 선택해 주세요.");
  const added=await client.query<{id:string}>(`INSERT INTO app.emoji_options(map_id,category_id,key,glyph,label,sort_order)
    SELECT $1,$2,$3,$4,$5,coalesce(max(sort_order),-1)+1 FROM app.emoji_options WHERE map_id=$1 AND category_id=$2 RETURNING id`,[map.id,categoryId,emoji.key,emoji.glyph,emoji.label]);
  const next=structuredClone(theme) as Theme&{identifiers?:{emojiOptions:Record<string,string>}};
  next.categories.find(item=>item.key===categoryKey)!.emojiOptions.push({key:emoji.key,glyph:emoji.glyph,label:emoji.label});
  if(next.identifiers)next.identifiers.emojiOptions[`${categoryKey}:${emoji.key}`]=added.rows[0].id;
  map.config_revision++;
  await client.query("INSERT INTO app.map_config_revisions(map_id,revision,definition,created_by) VALUES($1,$2,$3,$4)",[map.id,map.config_revision,JSON.stringify(next),principalId]);
  await client.query("UPDATE app.maps SET config_revision=$2,version=version+1,updated_at=now() WHERE id=$1",[map.id,map.config_revision]);
  return next;
}
