export const guideFields=[
 ['name','名稱／筆尖或規格主題','Name / Nib or specification'],
 ['features','筆尖特色與差異','Nib characteristics'],
 ['writing','書寫方式與握筆角度','Writing technique and pen angle'],
 ['lineWidth','字跡粗細／可選粗細','Line width / Available sizes'],
 ['nibMaterial','筆尖材質','Nib material'],
 ['bodyMaterial','筆身材質','Body material'],
 ['weight','重量（請註明 g 與是否含筆蓋）','Weight (g; specify with or without cap)'],
 ['dimensions','尺寸（請註明 mm 與測量部位）','Dimensions (mm; specify measurement)'],
 ['useCases','適用情境／推薦對象','Recommended uses / Writers'],
 ['sampleText','試寫使用的同一段文字','Writing sample text'],
 ['ink','試寫墨水','Ink used for the sample'],
 ['paper','試寫紙張','Paper used for the sample'],
 ['notes','選購與使用注意事項','Buying and care notes']
];
export const blankGuide=()=>({id:'',version:0,status:'draft',position:0,zh:Object.fromEntries(guideFields.map(([k])=>[k,''])),en:Object.fromEntries(guideFields.map(([k])=>[k,''])),photos:[]});
