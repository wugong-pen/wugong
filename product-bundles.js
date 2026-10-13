// Canonical recipes: checkout derives these parts on the server, never from the cart.
export const notebookColours = {amber:'琥珀褐',pine:'松菸翠',blue:'天青釉'};
const colours=Object.keys(notebookColours);
export const notebookSingles=['large','small'].flatMap(size=>colours.map(colour=>`change-tr-${size}-${colour}`));
export const bundleRecipes={
 'change-tr-small-three':colours.map(colour=>({sku:`change-tr-small-${colour}`,units:1})),
 'change-tr-large-three':colours.map(colour=>({sku:`change-tr-large-${colour}`,units:1})),
 ...Object.fromEntries(colours.flatMap(large=>colours.map(small=>[`change-tr-mix-${large}-${small}`,[{sku:`change-tr-large-${large}`,units:1},{sku:`change-tr-small-${small}`,units:1}]]))),
 'change-mug-pair':[{sku:'change-mug-single',units:2}]
};
export const notebookSkus=[...notebookSingles,...Object.keys(bundleRecipes).filter(s=>s.startsWith('change-tr-'))];
export const mugSkus=['change-mug-single','change-mug-pair'];
export async function bundleParts(env,sku){
 const recipe=bundleRecipes[sku];if(!recipe)return null;
 return Promise.all(recipe.map(async part=>{
  const p=await env.DB.prepare('SELECT p.sku,p.version,p.active,p.family,f.stock_sku,f.confirmed,i.available FROM products p JOIN product_families f ON f.family=p.family JOIN inventory i ON i.sku=f.stock_sku WHERE p.sku=?').bind(part.sku).first();
  return {...part,...p,ready:!!p&&p.active===1&&p.confirmed===1};
 }));
}
export function bundleAvailable(parts){return parts.every(p=>p.ready)?Math.max(0,Math.min(...parts.map(p=>Math.floor(p.available/p.units)))):0;}
export async function bundleAvailability(env,p){const parts=await bundleParts(env,p.sku);return parts?{...p,available:bundleAvailable(parts)}:p;}
export function stockCounts(items){
 const counts=new Map();
 for(const item of items)for(const part of item.stockComponents||[{stockId:item.stockId||item.id,units:1}]){
  counts.set(part.stockId,(counts.get(part.stockId)||0)+item.quantity*part.units);
 }
 return counts;
}
