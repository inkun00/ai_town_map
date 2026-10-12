// @vitest-environment happy-dom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {getRememberedGameRoom,parseGameCheckpoint,rememberGameRoom,savePendingCheckpoint,takePendingCheckpoint} from "../src/lib/game-checkpoint";

const code=`town-map-checkpoint.v1.eyJnYW1lSWQiOiJ0ZXN0In0.${"a".repeat(43)}`;
const origin="https://ai-town-map.vercel.app";
const link=`${origin}/games/checkpoint#code=${encodeURIComponent(code)}`;

beforeEach(()=>{window.localStorage.clear();vi.useFakeTimers();});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});

describe("checkpoint QR handoff",()=>{
  it("extracts only the app checkpoint URL or a syntactically valid raw code",()=>{
    expect(parseGameCheckpoint(code)).toBe(code);
    expect(parseGameCheckpoint(` ${link} `,origin)).toBe(code);
    for(const invalid of [link.replace(origin,"https://example.com"),link.replace("/games/checkpoint","/games"),`${link}&code=${code}`,link.replace("#code=","?code="),`javascript:alert(1)`,`${origin}/games/checkpoint#code=${code}&next=https://example.com`,"x".repeat(4097),code.replace("checkpoint","arrival"),code.slice(0,-1)]){
      expect(parseGameCheckpoint(invalid,origin)).toBeNull();
    }
    expect(parseGameCheckpoint(`https://user:pass@ai-town-map.vercel.app/games/checkpoint#code=${code}`,origin)).toBeNull();
  });
  it("remembers a room without accepting a URL or arbitrary storage content",()=>{
    const roomId="c19a64ae-3b6d-4ca2-b78b-5e4d1c356639";
    rememberGameRoom("https://example.com");expect(getRememberedGameRoom()).toBeNull();
    rememberGameRoom(roomId);expect(getRememberedGameRoom()).toBe(roomId);
    vi.advanceTimersByTime(8*60*60*1000);expect(getRememberedGameRoom()).toBeNull();
  });
  it("hands a checkpoint to the room once and expires abandoned scans",()=>{
    savePendingCheckpoint(code);expect(takePendingCheckpoint()).toBe(code);expect(takePendingCheckpoint()).toBeNull();
    savePendingCheckpoint(code);vi.advanceTimersByTime(2*60*60*1000);expect(takePendingCheckpoint()).toBeNull();
    savePendingCheckpoint("foreign-QR");expect(takePendingCheckpoint()).toBeNull();
  });
  it("keeps the in-app scanner usable when browser storage is blocked",()=>{
    vi.spyOn(window.localStorage,"setItem").mockImplementation(()=>{throw new Error("blocked");});
    expect(()=>{rememberGameRoom("c19a64ae-3b6d-4ca2-b78b-5e4d1c356639");savePendingCheckpoint(code);}).not.toThrow();
    expect(takePendingCheckpoint()).toBeNull();
  });
});
