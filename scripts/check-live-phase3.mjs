import { liveTestTarget } from "./live-test-target.mjs";
// Opt-in smoke test against a configured local app and its database.
// Creates synthetic account/guest sessions, then removes all test records.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import nextEnv from "@next/env";
import pg from "pg";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { setTimeout as pause } from "node:timers/promises";

if (process.env.RUN_LIVE_PHASE3 !== "1") throw new Error("Set RUN_LIVE_PHASE3=1 to run the live smoke test");
nextEnv.loadEnvConfig(process.cwd());
loadEnvFile(".env.migrate.local");
const { base, sessionName, csrfName, cookiePrefix } = liveTestTarget();
const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
const digest = (value) => createHash("sha256").update(value).digest();
const token = () => randomBytes(32).toString("base64url");
const createdMaps = [];
let accountId = null;
const guestIds = [];

async function api(path, { method = "GET", cookie = "", csrf = "", body } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    redirect: "manual",
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: base } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...(csrf ? { "X-CSRF-Token": csrf } : {}), ...(method === "POST" && path === "/api/v1/maps" ? { "Idempotency-Key": randomUUID() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, data: payload?.data, code: payload?.error?.code, cookies: response.headers.getSetCookie() };
}

function expect(result, status, label) {
  if (result.status !== status) throw new Error(`${label}: expected ${status}, got ${result.status} (${result.code ?? "unknown"})`);
}

try {
  await admin.connect();
  const account = await admin.query("INSERT INTO app.principals(kind,auth_user_id) VALUES('account',$1) RETURNING id", [randomUUID()]);
  accountId = account.rows[0].id;
  const accountToken = token();
  const accountCsrf = token();
  await admin.query("INSERT INTO app_private.sessions(principal_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [accountId, digest(accountToken), digest(accountCsrf)]);
  const accountCookie = `${sessionName}=${accountToken}; ${csrfName}=${accountCsrf}`;

  const session = await api("/api/v1/session", { cookie: accountCookie });
  expect(session, 200, "account session");
  if (session.data?.kind !== "account" || session.data?.csrfToken !== accountCsrf) throw new Error("Account session did not resolve");

  const custom = { categories: [{ key: "test_park", label: "공원", color: "#37805a", defaultEmojiKey: "tree", emojiOptions: [{ key: "tree", glyph: "🌳", label: "나무" }, { key: "bench", glyph: "🪑", label: "벤치" }] }], pinMode: "category" };
  for (const [themeKey, title] of [["ecology", "3단계 검사 생태"], ["safety", "3단계 검사 안전"], ["universal_design", "3단계 검사 편의"], ["weather_life", "3단계 검사 날씨"], ["custom", "3단계 검사 직접"]]) {
    const created = await api("/api/v1/maps", { method: "POST", cookie: accountCookie, csrf: accountCsrf, body: { themeKey, themeVersion: 1, title, locationLabel: "검사 지역", activityContext: "school", visibility: "invite_only", center: null, ...(themeKey === "custom" ? { custom } : {}) } });
    expect(created, 201, `${themeKey} map creation`);
    createdMaps.push(created.data.id);
  }
  const ownMaps = await api("/api/v1/maps?scope=mine", { cookie: accountCookie });
  expect(ownMaps, 200, "account map list");
  if (!createdMaps.every((id) => ownMaps.data.items.some((map) => map.id === id))) throw new Error("Created maps missing from account list");
  // Identical microsecond timestamps exercise a cursor boundary JS Date would truncate.
  await admin.query("UPDATE app.maps SET created_at='2026-09-01T00:00:00.123456Z' WHERE id=ANY($1::uuid[])", [createdMaps]);
  const paged = []; let cursor = null;
  do {
    const result = await api(`/api/v1/maps?scope=mine&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {cookie:accountCookie});
    expect(result,200,"map pagination"); paged.push(...result.data.items.map(item=>item.id)); cursor=result.data.nextCursor;
    if(paged.length>createdMaps.length)throw new Error("Pagination duplicated rows");
  } while(cursor);
  if(new Set(paged).size!==createdMaps.length || !createdMaps.every(id=>paged.includes(id)))throw new Error("Pagination skipped a microsecond boundary");
  const filtered = await api("/api/v1/maps?scope=mine&q="+encodeURIComponent("검사")+"&themeKey=ecology&limit=2", {cookie:accountCookie});
  expect(filtered,200,"server search");
  if(filtered.data.items.length!==1||filtered.data.items[0].themeKey!=="ecology")throw new Error("Search/theme mismatch");
  const wildcard=await api("/api/v1/maps?scope=mine&q=%25", {cookie:accountCookie});
  if(wildcard.data.items.length)throw new Error("Literal percent search became a wildcard");
  const invalidCursor=Buffer.from(JSON.stringify({createdAt:"2026-09-01T00:00:00Z",id:"-".repeat(36)})).toString("base64url");
  expect(await api(`/api/v1/maps?scope=mine&cursor=${invalidCursor}`,{cookie:accountCookie}),422,"invalid cursor");
  const invalidDate=Buffer.from(JSON.stringify({createdAt:"2026-02-30T00:00:00Z",id:createdMaps[0]})).toString("base64url");
  expect(await api(`/api/v1/maps?scope=mine&cursor=${invalidDate}`,{cookie:accountCookie}),422,"invalid cursor calendar date");
  expect(await api("/api/v1/maps?scope=mine"),401,"anonymous mine list");
  const anonymousSearch=await api("/api/v1/maps?scope=public&q="+encodeURIComponent("3단계 검사"));
  if(anonymousSearch.data.items.some(item=>createdMaps.includes(item.id)))throw new Error("Search leaked private maps");
  const configurations = [];
  for (const id of createdMaps) {
    const result = await api(`/api/v1/maps/${id}/configuration`, { cookie: accountCookie });
    expect(result, 200, "theme configuration");
    configurations.push(result.data.theme);
  }
  const expected = [["category", false], ["rating", true], ["rating", true], ["category", true], ["category", false]];
  for (const [index, theme] of configurations.entries()) {
    if (theme.pin.mode !== expected[index][0] || theme.features.ratingEnabled !== expected[index][1]) throw new Error(`Theme ${index} pin/rating configuration mismatch`);
    if (!theme.categories.length || !theme.categories.every((item) => item.emojiOptions.length > 0 && item.defaultEmojiKey)) throw new Error(`Theme ${index} emoji choices missing`);
  }
  if (configurations[4].categories[0].emojiOptions.length !== 2) throw new Error("Custom emoji choices were not copied");

  const anonymousPrivate = await api(`/api/v1/maps/${createdMaps[0]}`);
  expect(anonymousPrivate, 404, "anonymous private map access");
  const invitation = await api(`/api/v1/maps/${createdMaps[0]}/invites`, { method: "POST", cookie: accountCookie, csrf: accountCsrf, body: {} });
  expect(invitation, 201, "invite creation");
  const joined = await api("/api/v1/invites/redeem", { method: "POST", body: { code: invitation.data.code, nickname: "검사참여자" } });
  expect(joined, 200, "guest redemption");
  const guestCookie = joined.cookies.filter((value) => value.startsWith(cookiePrefix)).map((value) => value.split(";")[0]).join("; ");
  if (!guestCookie.includes(`${sessionName}=`) || !guestCookie.includes(`${csrfName}=`)) throw new Error("Guest session cookies missing");
  const guestSession = await api("/api/v1/session", { cookie: guestCookie });
  expect(guestSession, 200, "guest session");
  if (guestSession.data?.kind !== "guest") throw new Error("Guest session did not resolve");
  const guestToken = guestCookie.split("; ").find(value => value.startsWith(`${sessionName}=`))?.split("=")[1];
  const guestRow = await admin.query("SELECT principal_id FROM app_private.sessions WHERE token_hash=$1", [digest(guestToken)]);
  const guestId = guestRow.rows[0]?.principal_id ?? null;
  if (!guestId) throw new Error("Guest principal missing");
  guestIds.push(guestId);

  expect(await api(`/api/v1/maps/${createdMaps[0]}`, { cookie: guestCookie }), 200, "guest invited map access");
  expect(await api(`/api/v1/maps/${createdMaps[1]}`, { cookie: guestCookie }), 404, "guest other private map isolation");
  expect(await api(`/api/v1/maps/${createdMaps[1]}/invites`, { cookie: guestCookie }), 404, "guest invite management denial");
  const repeated = await api("/api/v1/invites/redeem", { method: "POST", cookie: guestCookie, csrf: guestSession.data.csrfToken, body: { code: invitation.data.code, nickname: "검사참여자" } });
  expect(repeated, 200, "guest retry");
  if (!repeated.data?.repeated) throw new Error("Guest retry was not idempotent");
  const uses = await admin.query("SELECT uses FROM app_private.invites WHERE id=$1", [invitation.data.id]);
  if (uses.rows[0]?.uses !== 1) throw new Error("Guest retry incremented invite use count");
  const sameNickname = await api("/api/v1/invites/redeem", { method: "POST", body: { code: invitation.data.code, nickname: "검사참여자" } });
  expect(sameNickname, 200, "same nickname from another client");
  const secondToken = sameNickname.cookies.find((value) => value.startsWith(`${sessionName}=`))?.split(";")[0].split("=")[1];
  const secondRow = await admin.query("SELECT principal_id FROM app_private.sessions WHERE token_hash=$1", [digest(secondToken)]);
  const secondGuestId = secondRow.rows[0]?.principal_id;
  if (!secondGuestId || secondGuestId === guestId) throw new Error("Nickname reused the first guest identity");
  guestIds.push(secondGuestId);

  const revoked = await api(`/api/v1/maps/${createdMaps[0]}/invites`, { method: "POST", cookie: accountCookie, csrf: accountCsrf, body: {} });
  expect(revoked, 201, "revocable invite creation");
  expect(await api(`/api/v1/maps/${createdMaps[0]}/invites/${revoked.data.id}`, { method: "DELETE", cookie: accountCookie, csrf: accountCsrf }), 204, "invite revocation");
  const revokedResult=await api("/api/v1/invites/redeem", { method: "POST", body: { code: revoked.data.code, nickname: "폐기검사" } });
  expect(revokedResult,422,"revoked invite denial");
  if(revokedResult.code!=="INVITE_REVOKED")throw new Error("Missing revoked guidance code");

  const expired = await api(`/api/v1/maps/${createdMaps[0]}/invites`, { method: "POST", cookie: accountCookie, csrf: accountCsrf, body: {} });
  expect(expired, 201, "expiring invite creation");
  await admin.query("UPDATE app_private.invites SET expires_at=now()-interval '1 minute' WHERE id=$1", [expired.data.id]);
  const expiredResult=await api("/api/v1/invites/redeem", { method: "POST", body: { code: expired.data.code, nickname: "만료검사" } });
  expect(expiredResult,422,"expired invite denial");
  if(expiredResult.code!=="INVITE_EXPIRED")throw new Error("Missing expired guidance code");
  await admin.query("UPDATE app.maps SET status='archived' WHERE id=$1",[createdMaps[0]]);
  const closedResult=await api("/api/v1/invites/redeem",{method:"POST",body:{code:invitation.data.code,nickname:"보관검사"}});
  expect(closedResult,422,"archived map invite");
  if(closedResult.code!=="MAP_CLOSED")throw new Error("Missing closed map guidance code");
  await admin.query("UPDATE app.maps SET status='active' WHERE id=$1",[createdMaps[0]]);

  const exhausted = await api(`/api/v1/maps/${createdMaps[0]}/invites`, { method: "POST", cookie: accountCookie, csrf: accountCsrf, body: { maxUses: 1 } });
  expect(exhausted, 201, "limited invite creation");
  await admin.query("UPDATE app_private.invites SET uses=max_uses WHERE id=$1", [exhausted.data.id]);
  expect(await api("/api/v1/invites/redeem", { method: "POST", body: { code: exhausted.data.code, nickname: "횟수검사" } }), 409, "exhausted invite denial");

  await admin.query("UPDATE app.map_members SET status='blocked' WHERE map_id=$1 AND principal_id=$2", [createdMaps[0], guestId]);
  expect(await api(`/api/v1/maps/${createdMaps[0]}`, { cookie: guestCookie }), 404, "blocked guest map denial");
  expect(await api("/api/v1/invites/redeem", { method: "POST", cookie: guestCookie, csrf: guestSession.data.csrfToken, body: { code: invitation.data.code, nickname: "검사참여자" } }), 403, "blocked guest re-entry denial");
  console.log("Live API smoke passed: five themes, sessions, microsecond pagination, server search, invite guidance, nickname isolation, blocked guest");
  if(process.env.DIRECTORY_UI_CHECK==="1") {
    const label=`목록검증-${Date.now()}`;
    for(let i=0;i<25;i++){
      const result=await api("/api/v1/maps",{method:"POST",cookie:accountCookie,csrf:accountCsrf,body:{themeKey:i%2?"safety":"ecology",themeVersion:1,title:`${label} ${String(i+1).padStart(2,"0")}`,locationLabel:"가상 검사 지역",visibility:"public"}});
      expect(result,201,"UI directory fixture");createdMaps.push(result.data.id);
    }
    writeFileSync(".directory-ui-check.json",JSON.stringify({label,expiredCode:expired.data.code}));
    console.log("Directory UI fixtures ready; remove .directory-ui-check.json to finish (10 minute limit)");
    const until=Date.now()+600000;
    while(existsSync(".directory-ui-check.json")&&Date.now()<until)await pause(1000);
    if(existsSync(".directory-ui-check.json"))unlinkSync(".directory-ui-check.json");
  }
} finally {
  if (accountId) {
    await admin.query("BEGIN");
    try {
      await admin.query("SET CONSTRAINTS ALL DEFERRED");
      const ids = createdMaps;
      await admin.query("DELETE FROM app_private.invites WHERE map_id=ANY($1::uuid[])", [ids]);
      await admin.query("DELETE FROM app.map_config_revisions WHERE map_id=ANY($1::uuid[])", [ids]);
      await admin.query("DELETE FROM app.question_versions WHERE map_id=ANY($1::uuid[])", [ids]);
      await admin.query("DELETE FROM app.questions WHERE map_id=ANY($1::uuid[])", [ids]);
      await admin.query("DELETE FROM app.rating_options WHERE map_id=ANY($1::uuid[])", [ids]);
      await admin.query("DELETE FROM app.rating_schemes WHERE map_id=ANY($1::uuid[])", [ids]);
      await admin.query("DELETE FROM app.emoji_options WHERE map_id=ANY($1::uuid[])", [ids]);
      await admin.query("DELETE FROM app.categories WHERE map_id=ANY($1::uuid[])", [ids]);
      await admin.query("DELETE FROM app.map_members WHERE map_id=ANY($1::uuid[])", [ids]);
      await admin.query("DELETE FROM app.maps WHERE id=ANY($1::uuid[])", [ids]);
      await admin.query("DELETE FROM app_private.idempotency_keys WHERE principal_id=$1", [accountId]);
      await admin.query("DELETE FROM app_private.sessions WHERE principal_id=ANY($1::uuid[])", [[accountId, ...guestIds]]);
      await admin.query("DELETE FROM app.principals WHERE id=ANY($1::uuid[])", [[accountId, ...guestIds]]);
      await admin.query("COMMIT");
      console.log("Synthetic test data removed");
    } catch (error) { await admin.query("ROLLBACK"); throw error; }
  }
  await admin.end();
}
