import {describe,it,expect} from "vitest";
import {groupMapPoints} from "../src/domain/map-points";
import {readBoundedBody} from "../src/lib/read-bounded-body";

describe("overlapping map records",()=>{
  it("keeps every ID at shared coordinate precision and keeps different locations separate",()=>{
    const records=[{id:"a",location:{lat:37.5,lng:127}},{id:"b",location:{lat:37.50000001,lng:127}},{id:"c",location:{lat:37.500002,lng:127}}];
    expect(groupMapPoints(records).map(group=>group.map(point=>point.id))).toEqual([["a","b"],["c"]]);
    expect(groupMapPoints(records.slice(1)).flat().map(point=>point.id)).toEqual(["b","c"]);
    expect(groupMapPoints([])).toEqual([]);
  });
});

describe("bounded photo request stream",()=>{
  it("accepts the exact limit across chunks",async()=>{
    const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array([1,2]));controller.enqueue(new Uint8Array([3]));controller.close();}});
    expect([...await readBoundedBody(body,3)]).toEqual([1,2,3]);
    expect(await readBoundedBody(null,3)).toHaveLength(0);
  });
  it("cancels a body without a length header as soon as it exceeds the limit",async()=>{
    let cancelled=false;
    const body=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(4));},cancel(){cancelled=true;}});
    await expect(readBoundedBody(body,3)).rejects.toThrow("BODY_TOO_LARGE");
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });
});
