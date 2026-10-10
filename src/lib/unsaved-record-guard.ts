export const unsavedRecordMessage = "지도에 저장되지 않은 작성 내용이 있습니다. 지금 나가면 내용이나 첨부한 사진이 저장되지 않을 수 있습니다. 그래도 나갈까요?";

type GuardWindow = Pick<Window, "addEventListener" | "removeEventListener" | "location" | "history" | "confirm">;

/** Cross-document navigation uses the browser dialog; same-document Back needs its own check. */
export function attachUnsavedRecordGuard(target: GuardWindow) {
  const url = target.location.href;
  const state = target.history.state;
  const beforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = unsavedRecordMessage;
  };
  const onPopState = () => {
    if (!target.confirm(unsavedRecordMessage)) {
      target.history.pushState(state, "", url);
      return;
    }
    dispose();
    // Reload the destination to apply the selected history entry without a second warning.
    target.location.reload();
  };
  function dispose() {
    target.removeEventListener("beforeunload", beforeUnload as EventListener);
    target.removeEventListener("popstate", onPopState);
  }
  target.addEventListener("beforeunload", beforeUnload as EventListener);
  target.addEventListener("popstate", onPopState);
  return dispose;
}
