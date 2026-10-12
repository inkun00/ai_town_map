import "server-only";
import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import type { Theme } from "@/lib/demo-data";
import { ApiError } from "@/server/http";

type Snapshot = Theme & { identifiers?: { emojiOptions: Record<string, string>; [key: string]: unknown } };

// A catalog emoji added by another participant changes the snapshot revision,
// but not the meaning of a form that was already open. All other changes must
// still require the participant to review the current configuration.
function onlyAddedEmojis(previous: Snapshot, current: Snapshot): boolean {
  if (previous.categories.length !== current.categories.length) return false;
  const identifiers = current.identifiers ? { ...current.identifiers, emojiOptions: { ...current.identifiers.emojiOptions } } : undefined;
  const categories = current.categories.map((category, index) => {
    const earlier = previous.categories[index];
    if (category.emojiOptions.length < earlier.emojiOptions.length) return null;
    if (!isDeepStrictEqual(earlier.emojiOptions, category.emojiOptions.slice(0, earlier.emojiOptions.length))) return null;
    const keys = new Set(earlier.emojiOptions.map(emoji => emoji.key));
    for (const added of category.emojiOptions.slice(earlier.emojiOptions.length)) {
      if (keys.has(added.key)) return null;
      keys.add(added.key);
      if (identifiers) {
        const key = `${category.key}:${added.key}`;
        if (Object.hasOwn(previous.identifiers?.emojiOptions ?? {}, key) || typeof identifiers.emojiOptions[key] !== "string") return null;
        delete identifiers.emojiOptions[key];
      }
    }
    return { ...category, emojiOptions: earlier.emojiOptions };
  });
  if (categories.some(category => category === null)) return false;
  const comparable = { ...current, categories, ...(current.identifiers ? { identifiers } : {}) };
  return isDeepStrictEqual(previous, comparable);
}

// The caller holds the map lock, so both snapshots remain stable while the
// chosen emoji is registered and the observation is validated and saved.
export async function observationConfiguration(client: PoolClient, map: { id: string; config_revision: number }, submittedRevision: number): Promise<Theme> {
  if (submittedRevision > map.config_revision) throw new ApiError(409, "CONFIG_CHANGED", "지도 설정이 바뀌었습니다. 최신 설정을 확인해 주세요.");
  const current = (await client.query<{ definition: Snapshot }>("SELECT definition FROM app.map_config_revisions WHERE map_id=$1 AND revision=$2", [map.id, map.config_revision])).rows[0]?.definition;
  if (!current) throw new ApiError(503, "THEME_UNAVAILABLE", "지도 설정을 불러올 수 없습니다.");
  if (submittedRevision !== map.config_revision) {
    const previous = (await client.query<{ definition: Snapshot }>("SELECT definition FROM app.map_config_revisions WHERE map_id=$1 AND revision=$2", [map.id, submittedRevision])).rows[0]?.definition;
    if (!previous || !onlyAddedEmojis(previous, current)) throw new ApiError(409, "CONFIG_CHANGED", "지도 설정이 바뀌었습니다. 최신 설정을 확인해 주세요.");
  }
  return current;
}
