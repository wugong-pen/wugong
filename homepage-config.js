export const textFields = [
 ['kicker','主視覺上方小標','#home .hero-kicker','HANDCRAFTED IN TAIWAN',14,'#d7b36a','sans'],
 ['title','主標題','#home h1','WUGONG',96,'#f5f1e8','serif'],
 ['subtitle','副標題','#home h2','Handcrafted Writing Instruments',36,'#f0e7d6','serif'],
 ['description','主視覺介紹','#home p','以材質、工藝與時間，打造具有溫度的書寫器物。\n每一支筆，都保留手作的痕跡，也承載屬於使用者自己的故事。',18,'#ddd2bf','sans'],
 ['button','按鈕文字','#home .btn','探索作品',16,'#d7b36a','sans'],
 ['storyKicker','品牌故事小標','#about small','OUR STORY',13,'#d7b36a','sans'],
 ['storyTitle','品牌故事標題','#about h2','以工藝，重新定義書寫',36,'#f5f1e8','serif'],
 ['story','品牌故事內容','#about .intro-wrap','WUGONG 專注於手工鋼筆與書寫器物的設計製作，從材質選擇、金屬加工、木作、銀雕到漆藝，透過不同工藝的交會，讓每件作品成為能被長久使用與收藏的器物。',18,'#ddd2bf','sans'],
 ['collectionsKicker','作品系列小標','#collections small','COLLECTIONS',13,'#d7b36a','sans'],
 ['collectionsTitle','作品系列標題','#collections h2','作品系列',36,'#f5f1e8','serif'],
 ['shopKicker','線上商店小標','#shop small','ONLINE SHOP',13,'#d7b36a','sans'],
 ['shopTitle','線上商店標題','#shop h2','線上商店',36,'#f5f1e8','serif'],
 ['craftKicker','工藝介紹小標','#craft small','CRAFTSMANSHIP',13,'#d7b36a','sans'],
 ['craftTitle','工藝介紹標題','#craft h2','材質 × 技藝 × 時間',36,'#f5f1e8','serif'],
 ['craft','工藝介紹內容','#craft > p','真正的工藝不只是外觀，而是對每一道工序的堅持。\n從設計草圖開始，經過加工、研磨、組裝與細節修整，WUGONG 希望讓每一件作品，都能在時間中持續留下質感。',18,'#ddd2bf','sans']
];
export const fonts={sans:'"Noto Sans TC",Arial,sans-serif',serif:'Georgia,"Noto Serif TC",serif',kai:'"標楷體",DFKai-SB,KaiTi,serif'};
export function defaults(){return {image:'/28731.jpg',imagePosition:'center',overlay:52,background:'#111111',backgroundImage:'',sectionBackground:'#181818',texts:Object.fromEntries(textFields.map(([id,,,text,size,color,font])=>[id,{text,size,color,font}]))};}
const bad=message=>{throw Object.assign(new Error(message),{status:400});};
export function validateHomepage(value){
 if(!value||typeof value!=='object'||Array.isArray(value))bad('首頁設定格式不正確');
 const color=v=>{if(typeof v!=='string'||!/^#[0-9a-f]{6}$/i.test(v))bad('請選擇有效的顏色');return v;};
 const image=v=>{if(typeof v!=='string'||(v!==''&&!/^\/media\/[a-f0-9]{64}$/.test(v)&&!/^\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(jpg|jpeg|png|webp)$/i.test(v)))bad('請使用本站上傳的照片');return v;};
 if(!['center','top','bottom','left','right'].includes(value.imagePosition))bad('照片位置不正確');
 if(!Number.isInteger(value.overlay)||value.overlay<0||value.overlay>90)bad('照片遮罩請設定在 0 至 90');
 const texts={};for(const [id,label] of textFields){const t=value.texts?.[id];if(!t||typeof t.text!=='string'||t.text.length>2000)bad(label+'請使用 2000 字以內的文字');if(!Number.isInteger(t.size)||t.size<12||t.size>120)bad(label+'字體大小請設定在 12 至 120');if(!Object.hasOwn(fonts,t.font))bad('請選擇提供的字體');texts[id]={text:t.text,size:t.size,color:color(t.color),font:t.font};}
 return {image:image(value.image),imagePosition:value.imagePosition,overlay:value.overlay,background:color(value.background),backgroundImage:image(value.backgroundImage),sectionBackground:color(value.sectionBackground),texts};
}
export function applyHomepage(config,root=document){
 const c=validateHomepage(config),body=root.querySelector('body'),hero=root.querySelector('#home');
 body.style.backgroundColor=c.background;body.style.backgroundImage=c.backgroundImage?`url("${c.backgroundImage}")`:'none';body.style.backgroundSize='cover';
 for(const el of root.querySelectorAll('#about,#shop'))el.style.background='transparent';
 for(const el of root.querySelectorAll('#collections,#craft'))el.style.background=c.sectionBackground;
 hero.style.backgroundColor=c.background;hero.style.backgroundImage=c.image?`linear-gradient(rgba(0,0,0,${c.overlay/100}),rgba(0,0,0,${c.overlay/100})),url("${c.image}")`:'none';hero.style.backgroundPosition=c.imagePosition;hero.style.backgroundSize='cover';
 for(const [id,,selector] of textFields){const el=root.querySelector(selector),t=c.texts[id];if(!el)continue;el.textContent=t.text;el.style.fontSize=t.size>24?`clamp(${Math.max(20,Math.round(t.size*.55))}px,${t.size/12}vw,${t.size}px)`:`${t.size}px`;el.style.color=t.color;el.style.fontFamily=fonts[t.font];el.style.whiteSpace='pre-wrap';el.style.overflowWrap='anywhere';}
 root.querySelector('#home .btn').style.borderColor=c.texts.button.color;
}
