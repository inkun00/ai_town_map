import type {ReactNode} from "react";
import Image from "next/image";
import explorerFox from "@/assets/adventure/explorer-fox.webp";

export type GameIconName = "compass" | "map" | "journal" | "chart" | "flag" | "backpack" | "key";

/** Original game-style interface icons; labels belong to the containing controls. */
export function GameIcon({name,size=28}:{name:GameIconName;size?:number}){
  const icons:Record<GameIconName,ReactNode>={
    compass:<><circle cx="16" cy="16" r="12" fill="#fff2c6"/><circle cx="16" cy="16" r="8.5" fill="#fffdf3"/><path d="m20 11-3 8-5 3 3-8z" fill="#ed7850"/><path d="m16 4 0-2m0 28v-2M4 16H2m28 0h-2"/><circle cx="16" cy="16" r="1" fill="#253d4c"/></>,
    map:<><path d="m3 8 8-3 10 3 8-3v21l-8 3-10-3-8 3z" fill="#fff2c6"/><path d="M11 5v21m10-18v21"/><path d="m6 19 3-2m5-4 4 2m5 5 3-2" stroke="#3a9c91" strokeDasharray="1 3"/><path d="M21 12c0 3-3 5-3 5s-3-2-3-5a3 3 0 0 1 6 0z" fill="#ed7850"/><circle cx="18" cy="12" r=".6" fill="#253d4c"/></>,
    journal:<><rect x="6" y="5" width="21" height="24" rx="3" fill="#fff2c6"/><path d="M11 5v24M5 10h3m-3 6h3m-3 6h3"/><path d="M15 13h8m-8 5h5" stroke="#3a9c91"/><path d="m21 3 6 3-9 16-4 1 1-4z" fill="#ed7850"/></>,
    chart:<><rect x="3" y="4" width="26" height="25" rx="4" fill="#fff2c6"/><path d="M9 23v-5m7 5V11m7 12v-9" stroke="#3a9c91" strokeWidth="4"/><path d="m8 10 4-3 4 1 6-4" stroke="#ed7850"/></>,
    flag:<><path d="M8 29V4m0 0c7-5 10 6 19 1v13c-9 5-12-6-19-1" fill="#f8ca5c"/><path d="m14 9 2 2 4-4" stroke="#3a9c91"/><path d="M4 29h8"/></>,
    backpack:<><path d="M12 8V6a4 4 0 0 1 8 0v2"/><rect x="7" y="7" width="18" height="23" rx="6" fill="#3a9c91"/><path d="M7 15H4v10h3m18-10h3v10h-3" fill="#f8ca5c"/><rect x="10" y="18" width="12" height="8" rx="2" fill="#fff2c6"/><path d="M10 12h12m-6-2v4"/></>,
    key:<><circle cx="10" cy="12" r="7" fill="#f8ca5c"/><circle cx="10" cy="12" r="2" fill="#fffdf3"/><path d="m15 17 11 11 3-3-3-3-2 2-2-2 2-2-4-4" fill="#f8ca5c"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="#253d4c" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

export function ExplorerGuide({children}:{children:ReactNode}){
  return <div className="explorer-guide"><Image src={explorerFox} sizes="56px" alt="" loading="lazy"/><div><small>여우 탐험대장의 한마디</small><p>{children}</p></div></div>;
}
