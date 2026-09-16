import {applyHomepage} from './homepage-config.js';
const preview=new URLSearchParams(location.search).get('homepage-preview')==='1'&&parent!==window;
if(preview){
 document.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();},true);
 document.addEventListener('submit',e=>e.preventDefault(),true);
 addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==parent||e.data?.type!=='homepage-preview')return;try{applyHomepage(e.data.config);}catch{}});
 parent.postMessage({type:'homepage-ready'},location.origin);
}else{
 fetch('/api/homepage',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('homepage');const d=await r.json();if(d.version)applyHomepage(d.config);}).catch(()=>{/* Preserve the existing homepage if settings cannot be loaded. */});
}
