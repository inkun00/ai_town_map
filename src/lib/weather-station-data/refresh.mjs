// Run with: node src/lib/weather-station-data/refresh.mjs
// Public KMA download; no account, credential, or third-party coordinates are used.
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const download = "https://data.kma.go.kr/tmeta/stn/selectStnListDownload.do?fileType=csv&pgmNo=123&serviceSe=F00101&mddlClssCd=SFC01";
const response = await fetch(download, { redirect: "error", signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`KMA public station download failed (${response.status})`);
const bytes = Buffer.from(await response.arrayBuffer());
const csv = new TextDecoder("euc-kr", { fatal: true }).decode(bytes);

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(value); value = ""; }
    else if (character === "\n" && !quoted) { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (quoted) throw new Error("Unclosed quote in KMA CSV");
  if (row.length || value) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((item) => item.some((field) => field.trim()));
}

const [header, ...rows] = parseCsv(csv);
if (!header || header[0] !== "지점" || header[1] !== "시작일" || header[2] !== "종료일" || header[3] !== "지점명" || header[6] !== "위도" || header[7] !== "경도") throw new Error("Unrecognized KMA station metadata columns");
const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const records = rows.map((row) => {
  const [id, start, end, name] = row, lat = Number(row[6]), lng = Number(row[7]);
  if (!/^\d{1,4}$/.test(id) || !date(start) || (end && (!date(end) || end < start)) || !name || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 32 || lat > 40 || lng < 123 || lng > 133) throw new Error(`Invalid KMA station metadata row: ${id}`);
  return [id, start, end || null, name, lat, lng];
}).sort((a, b) => Number(a[0]) - Number(b[0]) || a[1].localeCompare(b[1]));
if (records.length < 90 || new Set(records.filter((row) => row[2] === null).map((row) => row[0])).size < 90) throw new Error("Incomplete ASOS station metadata download");
const retrievedAt = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const metadata = {
  publisher: "기상청 국가기후데이터센터",
  title: "관측지점정보 · 종관기상관측(SFC01)",
  sourceUrl: "https://data.kma.go.kr/tmeta/stn/selectStnList.do?pgmNo=123",
  downloadUrl: download,
  datasetUrl: "https://www.data.go.kr/data/15043574/fileData.do",
  license: "공공누리 제1유형 · 출처표시",
  licenseUrl: "https://www.data.go.kr/data/15043574/fileData.do",
  retrievedAt,
  sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  rowCount: records.length,
  fields: ["지점번호", "시작일(YYYY-MM-DD)", "종료일(YYYY-MM-DD, 공란은 null)", "지점명", "위도(WGS84)", "경도(WGS84)"],
  processing: "공식 CSV의 해당 열만 추출. 시작일·종료일·좌표를 보존. 같은 날 종료/시작하는 이력은 더 최근 시작한 행을 사용. 주소·고도·장비 정보는 제외.",
};
await writeFile(new URL("./asos-history.json", import.meta.url), JSON.stringify(records, null, 2) + "\n");
await writeFile(new URL("./source.json", import.meta.url), JSON.stringify(metadata, null, 2) + "\n");
console.log(`KMA ASOS reference: ${records.length} history rows, retrieved ${retrievedAt}`);
