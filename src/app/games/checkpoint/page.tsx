import type {Metadata} from "next";
import GameCheckpointLanding from "@/components/games/GameCheckpointLanding";

export const metadata:Metadata={title:"QR 보물 찾기 · 모두의 지도",robots:{index:false,follow:false}};
export default function Page(){return <GameCheckpointLanding/>;}
