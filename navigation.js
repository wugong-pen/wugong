const menuButton=document.querySelector('.menu-toggle');
const siteNav=document.getElementById('site-nav');
if(siteNav){const link=document.createElement('a');link.href='/shop.html';link.textContent='線上商店';siteNav.append(link);const guide=document.createElement('a');guide.href='/shopping-guide.html';guide.textContent='購物須知';siteNav.append(guide);}
function closeMenu(){
  siteNav.classList.remove('is-open');
  menuButton.setAttribute('aria-expanded','false');
  menuButton.textContent='選單';
}
menuButton.addEventListener('click',()=>{
  const open=menuButton.getAttribute('aria-expanded')!=='true';
  menuButton.setAttribute('aria-expanded',String(open));
  menuButton.textContent=open?'關閉選單':'選單';
  siteNav.classList.toggle('is-open',open);
});
siteNav.addEventListener('click',event=>{if(event.target.closest('a'))closeMenu();});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&menuButton.getAttribute('aria-expanded')==='true'){
    closeMenu();menuButton.focus();
  }
});
window.matchMedia('(max-width:1100px)').addEventListener('change',closeMenu);
