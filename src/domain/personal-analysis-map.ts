import type {ObservationFilter} from "./analysis";
import type {DemoPoint} from "../lib/demo-data";

/** Client-only view of the source records: never mutates a point or shared filters. */
export function filterAnalysisPoints(points:DemoPoint[],filter:ObservationFilter):DemoPoint[]{
  return points.filter(point=>{
    if(filter.category&&point.categoryKey!==filter.category)return false;
    if(filter.rating&&point.ratingKey!==filter.rating)return false;
    if(filter.bbox){
      if(!point.location)return false;
      const [west,south,east,north]=filter.bbox;
      if(point.location.lng<west||point.location.lng>east||point.location.lat<south||point.location.lat>north)return false;
    }
    if(filter.from||filter.to){
      if(!point.createdAt)return false;
      const day=new Date(new Date(point.createdAt).getTime()+9*3600000).toISOString().slice(0,10);
      if(filter.from&&day<filter.from||filter.to&&day>filter.to)return false;
    }
    if(filter.question&&!(point.rawAnswers?.[filter.question]??[]).includes(filter.answer!))return false;
    return true;
  });
}
