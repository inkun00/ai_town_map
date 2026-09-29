export function inviteFeedback(code?: string, retryAfter?: string | null) {
  switch (code) {
    case "INVITE_EXPIRED": return "초대 기한이 지났어요. 개설자에게 새 초대 코드를 요청해 주세요.";
    case "INVITE_REVOKED": return "개설자가 사용을 중지한 초대예요. 새 초대 코드를 요청해 주세요.";
    case "INVITE_EXHAUSTED": return "초대 인원이 모두 찼어요. 개설자에게 새 초대 코드를 요청해 주세요.";
    case "MAP_CLOSED": return "보관 중인 지도예요. 개설자에게 지도를 다시 열어 달라고 요청해 주세요.";
    case "MEMBERSHIP_BLOCKED": return "현재 이 지도에 참여할 수 없어요. 지도 관리자에게 참여 상태를 확인해 주세요.";
    case "INVITE_RATE_LIMIT": {
      const seconds = Number(retryAfter);
      const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(Math.min(seconds, 3600) / 60) : 10;
      return `시도 횟수가 많아요. 약 ${minutes}분 뒤 다시 시도해 주세요. 같은 네트워크의 참여자도 함께 제한될 수 있어요.`;
    }
    case "CSRF_INVALID": case "LOGIN_REQUIRED": return "참여 세션이 바뀌었어요. 입력한 내용을 확인하고 다시 참여해 주세요.";
    case "INVITE_LIMIT_NOT_CONFIGURED": case "SERVICE_UNAVAILABLE": return "초대 서비스를 잠시 사용할 수 없어요. 잠시 후 다시 시도해 주세요.";
    case "INVITE_INVALID": return "초대 코드를 찾을 수 없어요. 코드가 정확한지 확인하거나 개설자에게 새 코드를 요청해 주세요.";
    default: return "참여하지 못했어요. 연결과 입력값을 확인한 뒤 다시 시도해 주세요.";
  }
}

export function validInviteInput(code: string, nickname: string) {
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(code.trim().toUpperCase().replaceAll("-", "").replaceAll(" ", "")) && nickname.trim().length >= 2 && nickname.trim().length <= 20;
}
