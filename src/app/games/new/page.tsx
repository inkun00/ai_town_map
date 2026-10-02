import GameCreator from "@/components/games/GameCreator";
export default async function Page({searchParams}:{searchParams:Promise<{source?:string}>}){const {source}=await searchParams;return <GameCreator sourceMapId={source??""}/>;}
