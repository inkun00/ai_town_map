import GameEditor from "@/components/games/GameEditor";
export default async function Page({params}:{params:Promise<{gameId:string}>}){return <GameEditor gameId={(await params).gameId}/>;}
