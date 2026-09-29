import type { ThemeKey } from "./demo-data";

export type LiveMap = {
  id: string; title: string; description: string; themeKey: ThemeKey; location: string;
  center: { lat: number; lng: number } | null; configRevision: number;
  visibility: "public" | "invite_only"; participation: "invited" | "admin_only" | "closed";
  moderation: "immediate" | "approval"; commentsEnabled: boolean; status: "active" | "archived";
  version: string; isMine: boolean; isOwner: boolean;
  capabilities: { canManageMap: boolean; canCreateObservation: boolean; canComment: boolean };
};
export type MapPage<T> = { items: T[]; nextCursor: string | null };
export type PageState<T> = MapPage<T> & { busy: boolean; error: string; loaded: boolean };

// One instance per search/scope. Disposal also ignores fetch implementations that do not abort.
export class MapPager<T extends { id: string }> {
  state: PageState<T> = { items: [], nextCursor: null, busy: false, error: "", loaded: false };
  private controller: AbortController | null = null;
  private disposed = false;
  constructor(private fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<MapPage<T>>, private publish: (state: PageState<T>) => void) {}
  async load() {
    if (this.disposed || this.state.busy || (this.state.loaded && !this.state.nextCursor)) return;
    this.controller = new AbortController();
    this.state = { ...this.state, busy: true, error: "" };
    this.publish(this.state);
    try {
      const page = await this.fetchPage(this.state.nextCursor, this.controller.signal);
      if (this.disposed) return;
      const items = new Map(this.state.items.map(item => [item.id, item]));
      page.items.forEach(item => items.set(item.id, item));
      this.state = { items: [...items.values()], nextCursor: page.nextCursor, busy: false, error: "", loaded: true };
    } catch (error) {
      if (this.disposed) return;
      const message = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "연결이 늦어지고 있어요. 다시 불러와 주세요." : error instanceof TypeError ? "연결을 확인한 뒤 다시 불러와 주세요." : error instanceof Error ? error.message : "목록을 불러오지 못했습니다.";
      this.state = { ...this.state, busy: false, error: message };
    }
    this.publish(this.state);
  }
  dispose() { this.disposed = true; this.controller?.abort(); }
}

export function mapListUrl(scope: "public" | "mine", q: string, themeKey: string, cursor: string | null) {
  const params = new URLSearchParams({ scope, limit: "20" });
  if (q) params.set("q", q);
  if (themeKey) params.set("themeKey", themeKey);
  if (cursor) params.set("cursor", cursor);
  return `/api/v1/maps?${params}`;
}
