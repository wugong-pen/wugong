export const collectionCategories={pen:'手工鋼筆',ink:'手工墨水',craft:'工藝收藏'};
export function validateCollections(value){
 if(value===undefined)return undefined;
 const bad=()=>{throw Object.assign(Error('作品請填寫分類、標題、圖片與對應商品；最多 30 筆'),{status:400});};
 if(!Array.isArray(value)||value.length>30)bad();
 return value.map(c=>{
  if(!c||!Object.hasOwn(collectionCategories,c.category)||typeof c.enabled!=='boolean')bad();
  const result={category:c.category,enabled:c.enabled};
  for(const [key,max] of [['title',120],['description',2000],['badge',60],['titleEn',200],['descriptionEn',4000],['badgeEn',100],['sku',100],['image',200]]){
   const v=c[key]??'';if(typeof v!=='string'||v.length>max)bad();result[key]=v.trim();
  }
  if(!result.title||!result.sku||!/^([a-zA-Z0-9\u3400-\u9fff_-]){1,100}$/.test(result.sku)||!/^\/(media\/[a-f0-9]{64}|[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(jpg|jpeg|png|webp))$/i.test(result.image))bad();
  return result;
 });
}
