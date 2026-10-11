import * as z from "zod";
import { filterSchema } from "./analysis";

export const aiSectionKeys = ["discoveries", "groups", "perspectives", "questions", "improvements", "photoClues"] as const;
export type AiSectionKey = typeof aiSectionKeys[number];
export const aiSectionLabels: Record<AiSectionKey, string> = {
  discoveries: "발견 제안", groups: "비슷한 기록 묶기", perspectives: "여러 사람의 관점",
  questions: "다음 탐험 질문", improvements: "개선 아이디어", photoClues: "사진에서 찾은 단서",
};
export const aiSuggestionCardSchema = z.strictObject({
  title: z.string().min(1).max(120), suggestion: z.string().min(1).max(1800),
  evidenceIds: z.array(z.uuid()).min(1).max(12), checkQuestion: z.string().min(1).max(500),
  photoId: z.uuid().optional(),
});
export const aiSuggestionSectionsSchema = z.strictObject({
  discoveries: z.array(aiSuggestionCardSchema).min(1).max(6),
  groups: z.array(aiSuggestionCardSchema).min(1).max(6),
  perspectives: z.array(aiSuggestionCardSchema).min(1).max(6),
  questions: z.array(aiSuggestionCardSchema).min(1).max(6),
  improvements: z.array(aiSuggestionCardSchema).min(1).max(6),
  photoClues: z.array(aiSuggestionCardSchema).max(6),
});
export type AiSuggestionCard = z.infer<typeof aiSuggestionCardSchema>;
export type AiSuggestionSections = z.infer<typeof aiSuggestionSectionsSchema>;
export const aiSuggestionInputSchema = z.strictObject({
  filter: filterSchema, photoIds: z.array(z.uuid()).max(3).default([]),
  photosConfirmed: z.boolean().default(false),
}).refine(input => !input.photoIds.length || input.photosConfirmed, "사진 전송 여부를 확인해 주세요.");
export type AiSuggestionInput = z.infer<typeof aiSuggestionInputSchema>;
export type AiSuggestions = {
  sections: AiSuggestionSections; dataRevision: string; generatedAt: string;
  totalRecords: number; analyzedRecords: number; filterFingerprint: string;
  photoIds: string[]; model: string;
};
export type AiAvailability = { ready: boolean; reason: string; model: string | null };

export const studentAnalysisInputSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(), title: z.string().max(200),
  analysis: z.string().max(10000), proposal: z.string().max(10000),
  reasoning: z.string().max(10000), followUp: z.string().max(5000),
  evidenceIds: z.array(z.uuid()).max(30), status: z.enum(["draft", "final"]),
}).refine(input => input.status !== "final" || (
  input.title.trim().length > 0 && input.analysis.trim().length > 0 &&
  input.proposal.trim().length > 0 && input.reasoning.trim().length > 0 && input.evidenceIds.length > 0
), "최종 글에는 제목, 분석, 개선 제안, 판단 이유와 근거 기록을 작성해 주세요.");
export type StudentAnalysisInput = z.infer<typeof studentAnalysisInputSchema>;
export type StudentAnalysisReport = Omit<StudentAnalysisInput, "expectedVersion"> & {
  id: string; version: number; updatedAt: string; dataRevision: string;
};
