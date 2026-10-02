import GameRoom from "@/components/games/GameRoom";
export default async function Page({params}:{params:Promise<{roomId:string}>}){return <GameRoom roomId={(await params).roomId}/>;}
