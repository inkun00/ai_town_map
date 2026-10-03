import {readFile, stat, mkdir, writeFile} from "node:fs/promises";
import {gzipSync} from "node:zlib";
import path from "node:path";

// Compare production builds, not development bundles. No cookies or API data.
const html=await readFile(".next/server/app/index.html","utf8");
const paths=[...new Set([...html.matchAll(/<script[^>]*src="([^"]+)/g)].map(m=>m[1]))];
const scripts=await Promise.all(paths.map(async url=>{
  const bytes=await readFile(`.next${url.replace(/^\/_next/,"")}`);
  return {url,bytes:bytes.length,gzipBytes:gzipSync(bytes).length};
}));
const images=await Promise.all(["neighborhood-quest.webp","explorer-fox.webp"].map(async name=>{
  const file=`src/assets/adventure/${name}`;return {file,bytes:(await stat(file)).size};
}));
const report={method:"Production home HTML script references, uncompressed and gzip estimate. Excludes deferred chunks, API, image variants and Kakao SDK; not a page speed measurement.",scripts,initialScriptBytes:scripts.reduce((n,s)=>n+s.bytes,0),initialScriptGzipBytes:scripts.reduce((n,s)=>n+s.gzipBytes,0),images};
if(process.env.ASSET_REPORT){await mkdir(path.dirname(process.env.ASSET_REPORT),{recursive:true});await writeFile(process.env.ASSET_REPORT,JSON.stringify(report,null,2)+"\n");}
console.log(JSON.stringify(report,null,2));
