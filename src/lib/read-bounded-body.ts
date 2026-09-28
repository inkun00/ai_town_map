/** Enforces the limit while reading, including requests without Content-Length. */
export async function readBoundedBody(body:ReadableStream<Uint8Array>|null,limit:number):Promise<Buffer> {
  if(!body)return Buffer.alloc(0);
  const reader=body.getReader(),chunks:Uint8Array[]=[];
  let size=0;
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>limit){await reader.cancel();throw new RangeError("BODY_TOO_LARGE");}
      chunks.push(value);
    }
    return Buffer.concat(chunks,size);
  } finally {reader.releaseLock();}
}
