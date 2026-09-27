import {translations,dynamicTranslations,extraTranslations,patterns} from './translations.js';
import {productTranslations} from './product-translations.js';
import {COUNTRY_CODES} from './countries.js';
const normalize=s=>s.trim().replace(/\s+/g,' ');
const dictionary=new Map(Object.entries({...translations,...dynamicTranslations,...extraTranslations,...productTranslations}).map(([k,v])=>[normalize(k),v]));
for(const [key,value] of [...dictionary])dictionary.set(key.replace(/(?<=[\u3400-\u9fff，。])\s+(?=[\u3400-\u9fff])/g,''),value);
// Match complete UI messages, never replace fragments inside customer-entered content.
const compiled=patterns.map(([source,target])=>({source,regex:new RegExp('^'+source.split(/(\{\{\d+\}\})/).map(s=>/^\{\{\d+\}\}$/.test(s)?'(.*?)':s.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&')).join('')+'$'),target}));
const zhNames=new Intl.DisplayNames(['zh-Hant'],{type:'region'}),enNames=new Intl.DisplayNames(['en'],{type:'region'});
for(const code of COUNTRY_CODES)dictionary.set(zhNames.of(code),enNames.of(code));dictionary.set('台灣','Taiwan');dictionary.set('香港','Hong Kong');
export function translateText(value,depth=0){const s=String(value??''),key=normalize(s);if(dictionary.has(key))return dictionary.get(key);if(depth<3)for(const {source,regex,target}of compiled){const m=key.match(regex);if(m){const nested=['已套用 {{0}}，折抵 NT${{1}}；贈送商品：{{2}}','已套用首購券 {{0}}｜{{1}}：{{2}}','已自動套用 {{0}}：{{1}}','{{0}} · {{1}} × {{2}}','{{0}} × {{1}}','{{0}} · NT$ {{1}}','{{0}}／全部','{{0}}／{{1}}','{{0}}｜WUGONG 吾鋼','{{0}}｜WUGONG','← 返回{{0}}','{{0}} · {{1}}','訂單 {{0}} · NT${{1}} · {{2}}'].includes(source);const values=m.slice(1).map(v=>nested?translateText(v,depth+1):v);if(source==='{{0}}／{{1}}'&&values.every((v,i)=>v===m[i+1]))return s;return target.replace(/\{\{(\d+)\}\}/g,(_,n)=>values[Number(n)]);}}return s;}
export function registerTranslation(source,english){if(source&&english)dictionary.set(normalize(source),english);}
export function initialLanguage(storage,search=''){const explicit=new URLSearchParams(search).get('lang');if(['en','zh-Hant'].includes(explicit))return explicit;try{return storage?.getItem('wugongLanguage')==='en'?'en':'zh-Hant';}catch{return 'zh-Hant';}}
let language='zh-Hant';
export const getLanguage=()=>language;
export function localize(root=document){if(typeof document==='undefined')return;visit(root);}
const records=new WeakMap();
const skip='script,style,textarea,input,[translate="no"],[contenteditable="true"]';
function renderValue(node,attr){const raw=attr?node.getAttribute(attr):node.nodeValue;if(raw==null)return;let slots=records.get(node);if(!slots){slots=new Map();records.set(node,slots);}const key=attr||'text',prior=slots.get(key);const source=prior&&raw===prior.rendered?prior.source:raw;const translated=language==='en'?translateText(source):source;const rendered=translated!==source?source.match(/^\s*/)[0]+translated+source.match(/\s*$/)[0]:source;slots.set(key,{source,rendered});if(raw!==rendered){if(attr)node.setAttribute(attr,rendered);else node.nodeValue=rendered;}}
function visit(root){if(root.nodeType===3){if(!root.parentElement?.closest(skip))renderValue(root);return;}if(root.nodeType===1){if(root.closest('[translate="no"],script,style,[contenteditable="true"]'))return;for(const attr of ['placeholder','aria-label','title','alt'])if(root.hasAttribute(attr))renderValue(root,attr);if(root.matches('textarea,input'))return;}for(const child of root.childNodes||[])visit(child);}
if(typeof document!=='undefined'&&!location.pathname.startsWith('/admin')){
 let storage;try{storage=localStorage;}catch{}language=initialLanguage(storage,location.search);try{storage?.setItem('wugongLanguage',language);}catch{}document.documentElement.lang=language;
 const switcher=document.createElement('div');switcher.className='language-switch';switcher.setAttribute('translate','no');switcher.setAttribute('role','group');switcher.setAttribute('aria-label','Language / 語言');
 for(const [lang,label] of [['zh-Hant','中文'],['en','English']]){const button=document.createElement('button');button.type='button';button.lang=lang;button.textContent=label;button.dataset.language=lang;button.onclick=()=>{language=lang;try{storage?.setItem('wugongLanguage',lang);}catch{}const url=new URL(location.href);url.searchParams.set('lang',lang);history.replaceState(null,'',url);document.documentElement.lang=lang;update();visit(document.documentElement);document.dispatchEvent(new CustomEvent('languagechange',{detail:{language:lang}}));};switcher.append(button);}
 function update(){for(const button of switcher.children)button.setAttribute('aria-pressed',String(button.dataset.language===language));}
 const header=document.querySelector('header');(header||document.body).append(switcher);update();visit(document.documentElement);
 const observer=new MutationObserver(mutations=>{for(const m of mutations){if(m.type==='characterData')visit(m.target);else if(m.type==='attributes'){if(!m.target.closest('[translate="no"],script,style,[contenteditable="true"]'))renderValue(m.target,m.attributeName);}else for(const node of m.addedNodes)visit(node);}});
 observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['placeholder','aria-label','title','alt']});
}

// Fetch display-only English fields by canonical SKU; submitted cart/order values stay untouched.
const itemTranslations=new Map();
export async function loadItemTranslations(items){
 const ids=[...new Set(items.map(i=>i.id).filter(id=>typeof id==='string'&&id.length<=100))];
 for(let offset=0;offset<ids.length;offset+=4)await Promise.all(ids.slice(offset,offset+4).map(id=>{if(!itemTranslations.has(id))itemTranslations.set(id,(async()=>{try{const r=await fetch('/api/catalog?'+new URLSearchParams({sku:id})),d=await r.json();if(!r.ok)return;for(const p of d.products||[])for(const key of ['name','variant'])registerTranslation(p[key],p.english?.[key]);}catch{}})());return itemTranslations.get(id);}));
 localize();
}
