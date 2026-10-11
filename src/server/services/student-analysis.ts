import "server-only";
import type { PoolClient, QueryResultRow } from "pg";
import { studentAnalysisInputSchema, type StudentAnalysisInput, type StudentAnalysisReport } from "@/domain/ai-analysis";
import { requireSession, type AppSession } from "@/server/auth/session";
import { withTransaction } from "@/server/db";
import { ApiError } from "@/server/http";
import { communityMap, requireMember } from "./community-access";

type ReportRow = QueryResultRow & {
  id: string; title: string; analysis: string; proposal: string; reasoning: string; follow_up: string;
  evidence_ids: string[]; status: "draft" | "final"; version: number;
  updated_at: Date; data_revision: string;
};

const reportColumns = "id,title,analysis,proposal,reasoning,follow_up,evidence_ids,status,version,updated_at,data_revision::text";

function asReport(row: ReportRow): StudentAnalysisReport {
  return {
    id: row.id, title: row.title, analysis: row.analysis, proposal: row.proposal,
    reasoning: row.reasoning, followUp: row.follow_up, evidenceIds: row.evidence_ids,
    status: row.status, version: row.version, updatedAt: row.updated_at.toISOString(),
    dataRevision: row.data_revision,
  };
}

async function ownReport(client: PoolClient, mapId: string, principalId: string): Promise<ReportRow | undefined> {
  return (await client.query<ReportRow>(`SELECT ${reportColumns} FROM app.student_analysis_reports WHERE map_id=$1 AND principal_id=$2`, [mapId, principalId])).rows[0];
}

export async function getStudentAnalysis(mapId: string, session: AppSession | null): Promise<StudentAnalysisReport | null> {
  const currentSession = requireSession(session);
  return withTransaction(async client => {
    const map = await communityMap(client, mapId, currentSession);
    requireMember(map);
    const row = await ownReport(client, mapId, currentSession.principalId);
    return row ? asReport(row) : null;
  });
}

export async function saveStudentAnalysis(mapId: string, session: AppSession | null, value: StudentAnalysisInput): Promise<StudentAnalysisReport> {
  const currentSession = requireSession(session);
  const input = studentAnalysisInputSchema.parse(value);
  if (new Set(input.evidenceIds).size !== input.evidenceIds.length) throw new ApiError(422, "DUPLICATE_EVIDENCE", "같은 근거 기록을 두 번 선택할 수 없습니다.");
  return withTransaction(async client => {
    // The map lock also serializes first-save races and changes to source records.
    const revision = (await client.query<{ data_revision: string }>("SELECT data_revision::text FROM app.maps WHERE id=$1 FOR UPDATE", [mapId])).rows[0];
    const map = await communityMap(client, mapId, currentSession);
    requireMember(map);
    if (map.status !== "active") throw new ApiError(403, "MAP_ARCHIVED", "보관된 지도에서는 글을 바꿀 수 없습니다.");
    const previous = await ownReport(client, mapId, currentSession.principalId);
    if ((previous?.version ?? 0) !== input.expectedVersion) throw new ApiError(409, "VERSION_CHANGED", "다른 곳에서 글이 바뀌었습니다. 입력한 글을 보관한 뒤 저장된 글을 다시 확인해 주세요.");

    if (input.evidenceIds.length) {
      const evidence = await client.query<{ id: string }>("SELECT id FROM app.observations WHERE map_id=$1 AND id=ANY($2::uuid[]) AND status='published' FOR SHARE", [mapId, input.evidenceIds]);
      if (evidence.rows.length !== input.evidenceIds.length) throw new ApiError(409, "EVIDENCE_UNAVAILABLE", "근거 기록이 숨겨지거나 삭제되었습니다. 근거 목록을 다시 확인해 주세요.");
    }

    const fields = [mapId, currentSession.principalId, input.title, input.analysis, input.proposal, input.reasoning, input.followUp, input.evidenceIds, input.status, revision.data_revision];
    const saved = previous
      ? await client.query<ReportRow>(`UPDATE app.student_analysis_reports SET title=$3,analysis=$4,proposal=$5,reasoning=$6,follow_up=$7,evidence_ids=$8,status=$9,data_revision=$10,version=version+1,updated_at=now() WHERE map_id=$1 AND principal_id=$2 RETURNING ${reportColumns}`, fields)
      : await client.query<ReportRow>(`INSERT INTO app.student_analysis_reports(map_id,principal_id,title,analysis,proposal,reasoning,follow_up,evidence_ids,status,data_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${reportColumns}`, fields);
    return asReport(saved.rows[0]);
  });
}
