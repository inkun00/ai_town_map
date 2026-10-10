"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { Coordinates } from "./KakaoMap";

const KakaoMap = dynamic(() => import("./KakaoMap"), { loading: () => <p role="status">지도를 불러오고 있어요…</p> });

export function RecordLocationPicker({ center, chosen, label, onPick, onLabelChange, onClose }: {
  center?: Coordinates | null; chosen: Coordinates | null; label: string;
  onPick: (location: Coordinates, source: "gps" | "search" | "manual", label?: string) => void;
  onLabelChange: (label: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={ref} className="record-location-dialog" aria-label="전체 화면에서 위치 선택" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="record-location-header"><button type="button" onClick={onClose} aria-label="위치 선택 닫기">‹</button><div><strong>발견한 위치 고르기</strong><small>지도를 눌러 핀을 놓아주세요.</small></div></header>
    <div className="record-location-map"><KakaoMap center={chosen ?? center} chosen={chosen} onPick={onPick}/></div>
    <footer className="record-location-footer">
      <label className="field"><span>위치 또는 장소 이름</span><input value={label} maxLength={120} onChange={event => onLabelChange(event.target.value)} placeholder="예: 공원 북쪽 입구"/></label>
      <button type="button" className="button button--primary button--full" disabled={!chosen || !label.trim()} onClick={onClose}>이 위치 선택</button>
    </footer>
  </dialog>;
}
