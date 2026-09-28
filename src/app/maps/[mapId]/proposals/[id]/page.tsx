import ProposalShare from "@/components/ProposalShare";
export default async function Page({params}:{params:Promise<{mapId:string;id:string}>}){const {mapId,id}=await params;return <ProposalShare mapId={mapId} id={id}/>;}
