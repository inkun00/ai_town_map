import type {DemoPoint,Theme} from "@/lib/demo-data";
import {pointRating} from "@/domain/point-presentation";
export function RatingLabel({theme,point}:{theme:Theme;point:Pick<DemoPoint,"ratingKey">}){
  const rating=pointRating(theme,point);if(!rating)return null;
  return <span className="rating-meaning"><span className="rating-symbol" aria-hidden="true">{rating.symbol}</span><span>{rating.label}</span></span>;
}
export function MapLegend({theme,points}:{theme:Theme;points:DemoPoint[]}){
  const ratings=theme.features.ratingEnabled&&theme.rating;
  const missing=ratings?points.filter(point=>!theme.rating!.options.some(option=>option.key===point.ratingKey)).length:0;
  return <div className="map-legend" aria-label="지도 범례"><strong>함께 찾은 기록 <b>{points.length}개</b></strong>
    <p>{theme.pin.mode==="rating"?"핀 색과 기호는 장소 평가를 나타내요.":theme.pin.mode==="category"?"핀 색과 이모지는 관찰 유형을 나타내요.":"핀 색은 같고, 이모지로 관찰 유형을 구분해요."}</p>
    {ratings&&<div className="rating-legend" aria-label={`${theme.rating!.label} 기호`}>{theme.rating!.options.map(option=><span key={option.key}>{theme.pin.mode==="rating"&&<i className="legend-swatch" aria-hidden="true" style={{background:option.color}}/>}<span className="rating-symbol" aria-hidden="true">{option.symbol}</span>{option.label} {points.filter(point=>point.ratingKey===option.key).length}개</span>)}{missing>0&&<span><span className="rating-symbol" aria-hidden="true">?</span>평가 없음 {missing}개</span>}</div>}
    {ratings&&theme.pin.mode!=="rating"&&<p>기호는 {theme.rating!.label}입니다. 핀 색의 의미와 달라요.</p>}
    {theme.pin.mode!=="rating"&&<details><summary>유형별 이모지·범례</summary><div className="category-legend">{theme.categories.map(category=><span key={category.key}>{theme.pin.mode==="category"&&<i className="legend-swatch" aria-hidden="true" style={{background:category.color}}/>}<span aria-hidden="true">{category.emojiOptions.find(option=>option.key===category.defaultEmojiKey)?.glyph??category.emojiOptions[0]?.glyph}</span>{category.label}</span>)}</div></details>}
    <small>핀 옆 숫자는 같은 위치의 기록 수입니다. 큰 묶음은 확대해 확인하세요.</small>
  </div>;
}
