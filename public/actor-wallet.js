/* Shared, local-only wallet access. The private link is a bearer credential: keep it off logs and external links. */
(function(){
  function keyFrom(value){
    try{
      const u=new URL(value,location.origin);
      if(u.origin!==location.origin)return '';
      const k=u.searchParams.get('k')||'';
      return /^[A-Za-z0-9_-]{16,80}$/.test(k)?k:'';
    }catch{return '';}
  }
  function saved(){try{return keyFrom(localStorage.getItem('wallet')||'');}catch{return '';}}
  function current(){return keyFrom(location.href)||saved();}
  function remember(key){if(!/^[A-Za-z0-9_-]{16,80}$/.test(key))return;try{localStorage.setItem('wallet','/research.html?k='+key);}catch{}}
  function download(name,body,type){const url=URL.createObjectURL(new Blob([body],{type:type||'text/plain'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function controls(key){
    const root=document.getElementById('wallet-access');if(!root)return;
    root.replaceChildren();const note=document.createElement('p');note.className='mute';
    note.textContent=key?'Save this private link to use your wallet on another device. Anyone with the link can use its credits.':'Already bought credits? Paste your saved private wallet link.';root.append(note);
    const input=document.createElement('input');input.type='url';input.setAttribute('aria-label',key?'Your private wallet link':'Saved private wallet link');input.autocomplete='off';input.spellcheck=false;
    input.value=key?location.origin+'/marketplace.html?k='+encodeURIComponent(key):'';input.readOnly=Boolean(key);root.append(input);
    const msg=document.createElement('p');msg.className='mute';msg.setAttribute('role','status');
    const button=(title,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=title;b.addEventListener('click',fn);root.append(b);};
    if(key){
      button('Copy wallet link',async()=>{try{await navigator.clipboard.writeText(input.value);msg.textContent='Wallet link copied. Keep it private.';}catch{input.focus();input.select();msg.textContent='Copy the selected link and keep it somewhere safe.';}});
      button('Download wallet backup',()=>download('nexus-wallet-backup.txt',input.value+'\nKeep this link private. It grants access to your Nexus credits.'));
    }else button('Restore wallet',()=>{const k=keyFrom(input.value.trim());if(!k){msg.textContent='Paste a private wallet link from this Nexus site.';return;}remember(k);location.assign(location.pathname+'?k='+encodeURIComponent(k));});
    root.append(msg);
  }
  window.NexusWallet={current,remember,controls,download};
})();
