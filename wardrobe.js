'use strict';
function wardrobeMobileQuality() {
  const network=navigator.connection;
  if(network?.saveData || /(^|-)2g$|^3g$/.test(network?.effectiveType || '')) return true;
  return Math.min(innerWidth,innerHeight)<=600 && (navigator.maxTouchPoints>0 || innerWidth<=600);
}

function createWardrobe({video, play, reveal, blocked, switchLayer}) {
  const fps = 60000 / 1001;
  const catalog = window.wardrobeCatalog;
  const root = document.querySelector('#wardrobe');
  const view = document.querySelector('#game-view');
  const picker = document.querySelector('#wr-picker');
  const palette = document.querySelector('#wr-options');
  const variants = root.querySelector('.wr-variants');
  const info = document.querySelector('#wr-info');
  const freeze = document.querySelector('#wr-freeze');
  const ambient = document.querySelector('#wr-ambient');
  const status = document.querySelector('#wr-status');
  const button = name => root.querySelector('[data-wardrobe="' + name + '"]');
  const findGroup = id => catalog.find(g => g.id === id);
  const filmed = group => group.options.filter(o => o.windows.length);
  const profile = 'gamerlito.wardrobe.equipment.v1';
  let records = {};
  try { records = JSON.parse(sessionStorage.getItem(profile) || '{}') || {}; } catch {}
  const persist = () => { try { sessionStorage.setItem(profile, JSON.stringify(records)); } catch {} };
  let active = false, held = false, pending = false;
  let group, item, which = 0, jacket = false, aisle = false;
  let generation = 0, paintTimer, warmTimer, loadTimer, messageTimer, frameTimer;
  let portrait = false, margin = false, lastAmbient = 0;
  let wanted='', expected='', mounted='', paletteKey='', layoutKey='';
  let warmRequest=null, visible=null, blend=null, frameWatch=null, stagingToken=null;
  let links={}, linksTask, nativeSwitch=false;
  const cache=new Map();
  const sourceWidth = 1920, sourceHeight = 1080;
  const sourceFocus = {outfit:.56, tops:.60, pants:.57, masks:.66, dresses:.56, jewelry:.53, boots:.51, heels:.51, slides:.51};
  ambient.width = 256; ambient.height = 144;
  video.parentElement.prepend(ambient);
  video.classList.add('wr-film');
  const back=video.cloneNode(false);
  back.id='wr-other-film';back.muted=true;back.hidden=true;
  video.after(back);
  const layers=[video,back];

  function focusFor(id) {
    if(!portrait) return 50;
    const fraction=(view.clientWidth/view.clientHeight)/(16/9);
    return 100*Math.min(1,Math.max(0,((sourceFocus[id] ?? .57)-fraction/2)/(1-fraction)));
  }

  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    const id=visible?.dataset.category || group?.id;
    const key=[w,h,id,active].join('/');
    if(key===layoutKey)return;
    layoutKey=key;
    const ratio = Math.min(w / 16, h / 9);
    const values = {left:(w-ratio*16)/2, top:(h-ratio*9)/2, w:ratio*16, h:ratio*9};
    for (const [name,value] of Object.entries(values)) {
      root.style.setProperty('--'+name, value+'px');
      view.style.setProperty('--wr-'+name, value+'px');
    }
    portrait = w / h <= 1.2;
    margin = !portrait && (values.left > 1 || values.top > 1);
    ambient.hidden = !active || !margin;
    for(const layer of layers)layer.style.setProperty('--wr-layer-focus',focusFor(layer.dataset.category)+'%');
    view.style.setProperty('--wr-focus',focusFor(id)+'%');
    const panelW = Math.min(w*.82, 485);
    const area = infoRect();
    root.style.setProperty('--info-w',panelW+'px');
    root.style.setProperty('--panel',(panelW*area.h/area.w)+'px');
    root.style.setProperty('--chip-step',(panelW*120/area.w)+'px');
    root.style.setProperty('--chip-size',(panelW*116/area.w)+'px');
    root.style.setProperty('--chip-bottom',(panelW*(area.y+area.h-975)/area.w)+'px');
    paint(true);
    startPainting();
  }
  function infoRect() {
    return (visible?.dataset.category || group?.id) === 'outfit' ? {x:25,y:802,w:790,h:222} : {x:32,y:654,w:727,h:345};
  }
  function drawCrop(canvas, input, sx, sy, sw, sh) {
    const ctx=canvas.getContext('2d',{alpha:false});
    const xr=(input.videoWidth || input.naturalWidth)/sourceWidth;
    const yr=(input.videoHeight || input.naturalHeight)/sourceHeight;
    if (ctx && xr && yr) ctx.drawImage(input,sx*xr,sy*yr,sw*xr,sh*yr,0,0,canvas.width,canvas.height);
  }
  function paint(force) {
    if(!active || !visible || visible.readyState<2) return;
    const input=visible;
    if (margin && (force || performance.now()-lastAmbient>250)) {
      drawCrop(ambient,input,0,0,sourceWidth,sourceHeight); lastAmbient=performance.now();
    }
    if (!aisle && portrait) {
      const area=infoRect();
      if (info.width!==area.w || info.height!==area.h) {info.width=area.w; info.height=area.h;}
      drawCrop(info,input,area.x,area.y,area.w,area.h);
    }
  }
  function toast(text) {
    clearTimeout(messageTimer); status.textContent=text;
    messageTimer=setTimeout(()=>{status.textContent='';},1700);
  }
  function file(g,o,index=0,coat=false) {
    return g.id+'-'+String(o.index).padStart(2,'0')+'-'+(coat?'j':'')+index;
  }
  function clipUrl(name,joined=false) {
    return 'media/'+(joined?'continuity/':'')+(wardrobeMobileQuality()?'mobile/':'')+name+'.mp4';
  }
  function restrictPreload() {
    const net=navigator.connection;
    return net?.saveData || /(^|-)2g$|^3g$/.test(net?.effectiveType || '') || document.hidden;
  }
  function stopWarm() {
    clearTimeout(warmTimer);
    if(warmRequest){warmRequest.controller.abort();warmRequest=null;}
  }
  function keep(url,blob) {
    const limit=wardrobeMobileQuality()?5*1024*1024:12*1024*1024;
    if(!blob.size || blob.size>limit || cache.has(url))return;
    cache.set(url,{size:blob.size,src:URL.createObjectURL(blob)});
    let bytes=0;
    for(const c of cache.values()) bytes+=c.size;
    for(const [key,c] of cache) {
      if(bytes<=limit && cache.size<=6)break;
      if(layers.some(layer=>layer.currentSrc===c.src))continue;
      URL.revokeObjectURL(c.src);cache.delete(key);bytes-=c.size;
    }
  }
  function warm(name,joined=false) {
    const url=clipUrl(name,joined);
    if(restrictPreload() || cache.has(url) || warmRequest || wanted===url)return;
    const controller=new AbortController();
    const job={url,controller};
    warmRequest=job;
    job.result=fetch(url,{signal:controller.signal,priority:'low'}).then(async response=>{
      if(!response.ok || Number(response.headers.get('content-length'))>3_000_000) {
        controller.abort();return;
      }
      const blob=await response.blob();
      if(!controller.signal.aborted)keep(url,blob);
    }).catch(()=>{}).finally(()=>{if(warmRequest===job)warmRequest=null;});
  }
  function plan(g,o,index,coat,forecast=false) {
    const windows=coat?o.jacketWindows:o.windows;
    const previous=visible?.dataset.name;
    const threshold=1.05/fps;
    const atEnd=visible && (forecast || visible.ended || visible.duration-visible.currentTime<=threshold);
    let choice=index ?? 0;
    if(previous && atEnd){
      for(let i=0;i<windows.length;i++) {
        if(index!==null && index!==undefined && i!==index)continue;
        const name=file(g,o,i,coat);
        const edge=links[previous]?.[name];
        if(edge)return {choice:i,name,edge};
      }
    }
    if(index==null && !coat && visible?.dataset.category===g.id && previous) {
      const stops=window.wardrobePoses?.byClip?.[previous]?.[String(o.index)];
      if(stops) {
        const local=Math.max(0,visible.currentTime-Number(visible.dataset.prefix || 0));
        for(const [at,win] of stops) {
          if(at>local)break;
          if(windows[win])choice=win;
        }
      }
    }
    choice=Math.min(Math.max(choice,0),windows.length-1);
    return {choice,name:file(g,o,choice,coat)};
  }
  function warmChoices(){
    clearTimeout(warmTimer);
    if(!active || restrictPreload() || blocked() || !picker.hidden)return;
    warmTimer=setTimeout(()=>{
      if(!active || pending || blocked() || !picker.hidden || restrictPreload())return;
      const options=filmed(group), pos=options.indexOf(item);
      if(aisle)return warm(file(group,item,1));
      if(options.length===1)return warm(file(catalog[1],filmed(catalog[1])[0]));
      const p=plan(group,options[(pos+1)%options.length],null,false,held);
      warm(p.name,Boolean(p.edge));
    },100);
  }
  function prepare(){
    if(!linksTask) {
      linksTask=fetch('media/continuity/links.json').then(r=>r.ok?r.json():null)
        .then(data=>{links=data?.links || {};}).catch(()=>{linksTask=null;});
    }
    if(!restrictPreload())warm('entry');
  }
  function stopPainting(){clearInterval(paintTimer);}
  function startPainting(){
    stopPainting();
    if(!active || !visible || visible.paused || (!portrait && !margin))return;
    paintTimer=setInterval(()=>paint(false),portrait?130:300);
  }
  function clearFrameWatch(){
    clearTimeout(frameTimer);
    if(frameWatch)frameWatch.layer.cancelVideoFrameCallback(frameWatch.id);
    frameWatch=null;
  }
  function hideLayer(layer){
    layer.hidden=true;
    layer.style.opacity='0';
    if(layer!==freeze)layer.pause();
  }
  function cancelBlend(){
    if(!blend)return;
    const old=blend;blend=null;
    old.animation.onfinish=null;old.animation.cancel();
  }
  // A third tap can arrive while both video layers are still visible. Preserve
  // their exact on-screen mixture before recycling either decoder.
  function interruptBlend(){
    if(!blend)return;
    const {outgoing,incoming}=blend;
    const opacity=Number(getComputedStyle(outgoing).opacity);
    const bounds=incoming.getBoundingClientRect();
    const scratch=document.createElement('canvas');
    const scale=Math.min(devicePixelRatio || 1,1280/Math.max(bounds.width,bounds.height,1));
    scratch.width=Math.max(1,Math.round(bounds.width*scale));
    scratch.height=Math.max(1,Math.round(bounds.height*scale));
    const ctx=scratch.getContext('2d',{alpha:false});
    function draw(layer){
      if(layer===freeze){ctx.drawImage(freeze,0,0,scratch.width,scratch.height);return;}
      if(!layer.videoWidth)return;
      const zoom=Math.max(scratch.width/layer.videoWidth,scratch.height/layer.videoHeight);
      const w=layer.videoWidth*zoom,h=layer.videoHeight*zoom;
      const focus=Number.parseFloat(layer.style.getPropertyValue('--wr-layer-focus'))/100;
      ctx.drawImage(layer,(scratch.width-w)*(Number.isFinite(focus)?focus:.5),(scratch.height-h)/2,w,h);
    }
    draw(incoming);ctx.globalAlpha=opacity;draw(outgoing);
    cancelBlend();
    freeze.width=scratch.width;freeze.height=scratch.height;
    freeze.getContext('2d',{alpha:false}).drawImage(scratch,0,0);
    freeze.hidden=false;freeze.style.opacity='1';
    for(const layer of layers)hideLayer(layer);
    visible=null;
  }
  function commit(token){
    if(token!==generation || !active || !pending || video.currentSrc!==expected || video.readyState<2)return;
    clearFrameWatch();
    const outgoing=!freeze.hidden?freeze:visible;
    const incoming=video;
    pending=false;visible=incoming;root.dataset.visibleName=incoming.dataset.name;
    root.dataset.motion='playing';reveal();
    incoming.style.opacity='1';incoming.style.zIndex='1';
    resize();paint(true);warmChoices();startPainting();
    if(!outgoing || outgoing===incoming){
      root.dataset.switch='settled';
    }else{
      const natural=nativeSwitch;
      const duration=natural?55:Math.max(85,Math.min(195,incoming.duration*550));
      if(outgoing!==freeze)outgoing.style.zIndex='2';
      const animation=outgoing.animate([{opacity:1},{opacity:0}],{
        duration,easing:natural?'linear':'cubic-bezier(.4,0,.3,1)',fill:'forwards'
      });
      blend={outgoing,incoming,animation};
      root.dataset.switch=natural?'native':'blend';
      animation.onfinish=()=>{
        if(blend?.animation!==animation)return;
        // Keep the decoder layer mounted. Toggling display while the new film is
        // promoted can expose the page background for one compositor frame.
        outgoing.style.opacity='0';
        if(outgoing===freeze)freeze.hidden=true;else outgoing.pause();
        cancelBlend();root.dataset.switch=natural?'native':'settled';
      };
    }
    if(incoming.ended)finish(incoming);
  }
  function afterPresentation(token) {
    if(token!==generation || stagingToken===token || !pending || video.readyState<2 ||
       video.currentSrc!==expected)return;
    stagingToken=token;
    // The decoder submits ahead of browser composition. Leave the new film
    // opaque underneath the outgoing one through two actual paint cycles.
    requestAnimationFrame(()=>requestAnimationFrame(()=>commit(token)));
  }
  function watchPresentation(layer) {
    if(!active || !pending || layer!==video || !expected || frameWatch)return;
    const token=generation;
    if(layer.requestVideoFrameCallback) {
      const id=layer.requestVideoFrameCallback(()=>{
        if(frameWatch?.id===id && frameWatch.layer===layer)frameWatch=null;
        afterPresentation(token);
      });
      frameWatch={layer,id};
    }
  }
  function ready(layer){
    if(!active || !pending || video!==layer || layer.readyState<2 || layer.currentSrc!==expected)return;
    watchPresentation(layer);
    // Some inline players stop reporting presentation callbacks while a menu
    // or system overlay is open. Only release after playback and a paint.
    clearTimeout(frameTimer);
    const token=generation;
    frameTimer=setTimeout(()=>{
      if(token!==generation || blocked() || (!layer.currentTime && !layer.ended))return;
      afterPresentation(token);
    },layer.requestVideoFrameCallback?260:0);
  }
  function fallbackFrame(layer) {
    if(!pending || layer!==video || blocked() || layer.readyState<2 ||
       layer.currentSrc!==expected || (!layer.ended && layer.currentTime<=0))return;
    const token=generation;
    afterPresentation(token);
  }
  function finish(layer){
    if(!active || pending || held || layer!==visible || layer!==video || !layer.ended)return;
    stopPainting();paint(true);
    if(aisle && root.dataset.entryAuto==='yes'){
      select(catalog[0],filmed(catalog[0])[0],1);
    }else{
      held=true;root.dataset.motion='held';warmChoices();
    }
  }
  function clip(range,name,edge){
    const token=++generation;
    const nextUrl=clipUrl(name,Boolean(edge));
    clearTimeout(loadTimer);clearTimeout(warmTimer);clearFrameWatch();
    interruptBlend();
    const incoming=visible===layers[0]?layers[1]:visible===layers[1]?layers[0]:video;
    const rate=video.playbackRate;
    for(const layer of layers)layer.id=layer===incoming?'game-footage':'wr-other-film';
    video=incoming;switchLayer(incoming);
    incoming.pause();incoming.hidden=false;
    incoming.style.zIndex='1';incoming.style.opacity=(visible || !freeze.hidden)?'1':'0';
    incoming.style.setProperty('--wr-layer-focus',focusFor(group.id)+'%');
    if(visible){
      visible.style.zIndex='2';visible.style.opacity='1';
      if(visible.paused && !visible.ended && !blocked() && picker.hidden)visible.play().catch(()=>{});
    }
    nativeSwitch=Boolean(edge) || (visible?.dataset.name==='entry' && name==='outfit-00-1' && visible.ended);
    held=false;pending=true;wanted=nextUrl;expected='';
    root.dataset.switch='waiting';root.dataset.motion='loading';
    root.dataset.from=range[0];root.dataset.to=range[1];
    root.dataset.origin=(edge?.startFrame ?? Math.ceil(range[0]*fps-1e-8))/fps;
    root.dataset.asset=incoming.dataset.asset=nextUrl;
    root.dataset.name=incoming.dataset.name=name;
    incoming.dataset.origin=root.dataset.origin;
    incoming.dataset.category=group.id;
    incoming.dataset.prefix=(edge?.gapFrames || 0)/fps;
    function mount(){
      if(token!==generation || !active || expected)return;
      clearTimeout(loadTimer);
      const asset=cache.get(nextUrl);
      mounted=asset?.src || new URL(nextUrl,document.baseURI).href;
      expected=mounted;
      if(!asset && warmRequest?.url===nextUrl)stopWarm();
      incoming.defaultPlaybackRate=rate;incoming.preload='auto';incoming.src=mounted;
      incoming.load();watchPresentation(incoming);
      if(!blocked() && picker.hidden)play();
    }
    if(warmRequest?.url===nextUrl && !cache.has(nextUrl)) {
      warmRequest.result.then(mount);
      loadTimer=setTimeout(mount,85);
    }else{
      if(warmRequest?.url!==nextUrl)stopWarm();
      mount();
    }
  }
  function showPalette() {
    const first=item?.firstVisible?.[which] ?? item?.firstVisible?.[0] ?? 0;
    const list=group.options.slice(first,first+6);
    const key=group.id+'/'+first;
    if(key!==paletteKey) {
      paletteKey=key;palette.replaceChildren();
    if(group.id!=='outfit'){
      for (const option of list) {
        const b=document.createElement('button');
        b.type='button'; b.dataset.option=option.index;
        b.setAttribute('aria-label',option.name || 'Variante sin toma en el video');
        b.title=option.name || 'Sin toma en el video';
        b.disabled=!option.windows.length;
        palette.append(b);
      }
    }
    }
    for(const b of palette.children)b.setAttribute('aria-pressed',String(+b.dataset.option===item.index));
    variants.hidden=filmed(group).length<2;
    variants.style.setProperty('--wr-variant-x',.022+Math.min(group.options.length,6)*.06255);
    const j=button('jacket');
    j.hidden=!item.jacketWindows?.length;
    j.textContent=jacket?'Quitar chaqueta':'Chaqueta';
    j.setAttribute('aria-label',jacket?'Quitar chaqueta':'Mostrar chaqueta'); j.setAttribute('aria-pressed',String(jacket));
    for(const b of picker.children) b.setAttribute('aria-current',String(b.dataset.category===group.id));
    showSaved();
  }
  function showSaved() {
    const saved=records[group.id]?.saved?.includes(item.index) || false;
    const b=button('save');
    b.textContent=saved?'Guardada':'Guardar';
    b.setAttribute('aria-pressed',String(saved));
    b.setAttribute('aria-label',saved?'Quitar prenda guardada':'Guardar prenda');
    b.title=saved?'Quitar prenda guardada':'Guardar prenda';
  }
  function closeMenu(resumeMotion=true) {
    picker.hidden=true; button('categories').setAttribute('aria-expanded','false');
    if(resumeMotion) resume();
  }
  function openMenu() {
    if(!picker.hidden){closeMenu();return;}
    pause(); picker.hidden=false; button('categories').setAttribute('aria-expanded','true');
  }
  function select(nextGroup,nextItem,windowIndex=null,withJacket=false) {
    if(!nextGroup || !nextItem?.windows.length) return;
    const nextPlan=plan(nextGroup,nextItem,windowIndex,withJacket);
    group=nextGroup; item=nextItem; aisle=false;
    jacket=Boolean(withJacket && item.jacketWindows?.length);
    const windows=jacket ? item.jacketWindows : item.windows;
    which=nextPlan.choice;
    const saved=records[group.id];
    const wearing=saved?.worn===item.index && Boolean(saved?.jacket)===jacket;
    root.dataset.mode=wearing?'equipped':'browse';
    root.dataset.category=group.id; root.dataset.option=item.index; root.dataset.jacket=String(jacket);
    root.setAttribute('aria-label','Vestuario de Lucía — '+item.name);
    closeMenu(false); showPalette(); resize(); clip(windows[which],nextPlan.name,nextPlan.edge);
  }
  function openGroup(id) {
    const g=findGroup(id);
    if(!g) return;
    const saved=records[g.id] || {};
    const candidate=g.options.find(o=>o.index===saved.worn && o.windows.length);
    select(g,candidate || filmed(g)[0],0,Boolean(candidate && saved.jacket));
  }
  function next(amount) {
    const list=filmed(group);
    select(group,list[(list.indexOf(item)+amount+list.length)%list.length]);
  }
  function equip() {
    if(aisle) return openGroup(catalog[0].id);
    const entry=records[group.id] || (records[group.id]={});
    entry.worn=item.index; entry.jacket=jacket; persist();
    root.dataset.mode='equipped'; toast('Puesta · '+item.name);
  }
  function save() {
    const entry=records[group.id] || (records[group.id]={});
    const saved=new Set(entry.saved || []);
    if(saved.has(item.index)) saved.delete(item.index); else saved.add(item.index);
    entry.saved=[...saved]; persist(); showSaved();
    toast((saved.has(item.index)?'Guardada · ':'Quitada de guardadas · ')+item.name);
  }
  function beginAisle() {
    closeMenu(false); aisle=true; group=catalog[0]; item=filmed(group)[0];
    root.dataset.mode='entry'; root.dataset.entryAuto='yes'; root.dataset.category=''; root.dataset.option='';
    root.setAttribute('aria-label','Vestuario de Lucía'); resize(); clip([152,153.91],'entry');
  }
  function resume() {
    if(!active || blocked() || !picker.hidden) return;
    if(visible && visible!==video && !visible.ended && visible.paused)visible.play().catch(()=>{});
    if(pending && video.ended){fallbackFrame(video);return;}
    if(!held && expected) play();
    else if(held) paint(true);
  }
  function pause() {
    for(const layer of layers)layer.pause();
    stopPainting();
  }
  function reset() {
    active=false; held=false; pending=false; generation++;
    stopPainting();stopWarm();clearTimeout(loadTimer);clearFrameWatch();cancelBlend();
    visible=null;expected='';wanted='';mounted='';layoutKey='';
    delete root.dataset.visibleName;
    for(const layer of layers){
      hideLayer(layer);
      if(layer.hasAttribute('src')) {layer.removeAttribute('src');layer.load();}
    }
    for(const c of cache.values())URL.revokeObjectURL(c.src);
    cache.clear();
    clearTimeout(messageTimer); status.textContent='';
    root.hidden=true; freeze.hidden=true; ambient.hidden=true; closeMenu(false);
  }
  function begin() {
    if(active)reset();
    prepare();
    active=true; root.hidden=false; beginAisle();
  }
  function snapshot() {
    const c=document.createElement('canvas');
    const scale=Math.min(1,1280/Math.max(view.clientWidth,view.clientHeight));
    c.width=Math.round(view.clientWidth*scale); c.height=Math.round(view.clientHeight*scale);
    const ctx=c.getContext('2d');
    const frame=visible || (!freeze.hidden?freeze:null);
    if(!ctx || !frame)return null;
    if(frame===freeze){ctx.drawImage(frame,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.84);}
    const r=Math[portrait?'max':'min'](c.width/sourceWidth,c.height/sourceHeight);
    const w=sourceWidth*r, h=sourceHeight*r;
    ctx.fillStyle='#101115'; ctx.fillRect(0,0,c.width,c.height);
    const f=(parseFloat(view.style.getPropertyValue('--wr-focus'))||50)/100;
    ctx.drawImage(frame,(c.width-w)*(portrait?f:.5),(c.height-h)*.5,w,h);
    return c.toDataURL('image/jpeg',.84);
  }
  function act(name) {
    if(!active || blocked()) return;
    if(name==='categories' || name==='back') {openMenu();return;}
    if(name==='enter') {select(catalog[0],filmed(catalog[0])[0],1);return;}
    if(aisle) return;
    switch(name) {
      case 'prev': next(-1); break;
      case 'next': next(1); break;
      case 'confirm': equip(); break;
      case 'save': save(); break;
      case 'replay': select(group,item,(which+1)%(jacket?item.jacketWindows:item.windows).length,jacket); break;
      case 'jacket': if(item.jacketWindows?.length) select(group,item,0,!jacket); break;
    }
  }
  for(const g of catalog) {
    const b=document.createElement('button'); b.type='button'; b.dataset.category=g.id;
    b.textContent=g.name.toLowerCase(); picker.append(b);
  }
  root.addEventListener('click',e=>{
    const target=e.target.closest('button');
    if(!target || target.disabled || blocked()) return;
    if(target.hasAttribute('data-category')) return openGroup(target.dataset.category);
    if(target.hasAttribute('data-option')) return select(group,group.options.find(o=>o.index===Number(target.dataset.option)));
    act(target.dataset.wardrobe);
  });
  document.addEventListener('keydown',e=>{
    if(!active || blocked() || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,textarea,select,[contenteditable=true]'))return;
    if(!document.querySelector('.gh-quick').hidden || !document.querySelector('.gh-chatbox').hidden)return;
    const key=e.key;
    if(!picker.hidden) {
      if(key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeMenu();button('categories').focus();return;}
      if(['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(key)){
        e.preventDefault();e.stopImmediatePropagation();
        const entries=[...picker.children], i=entries.indexOf(document.activeElement);
        const increment=key==='ArrowLeft'?-1:key==='ArrowRight'?1:key==='ArrowDown'?2:-2;
        entries[i<0?0:(i+increment+entries.length)%entries.length].focus();
      }
      return;
    }
    if(e.target.closest?.('#game-hud button') && ['Enter',' '].includes(key))return;
    if(e.target.closest?.('#wardrobe button') && ['Enter',' '].includes(key))return;
    const motion={ArrowLeft:'prev',ArrowRight:'next',a:'prev',d:'next',e:aisle?'enter':'confirm',Enter:aisle?'enter':'confirm',Escape:'back',r:'replay',j:'jacket'};
    const cmd=motion[key];
    if(!cmd || aisle && !['enter','back'].includes(cmd))return;
    e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)act(cmd);
  },true);
  document.addEventListener('pointerdown',e=>{
    if(active && !picker.hidden && !picker.contains(e.target) && !button('categories').contains(e.target)) closeMenu();
  },true);
  for(const layer of layers){
    for(const evt of ['loadeddata','canplay','playing'])layer.addEventListener(evt,()=>ready(layer));
    layer.addEventListener('playing',()=>{if(layer===visible)startPainting();});
    layer.addEventListener('pause',()=>{if(layer===visible)stopPainting();});
    layer.addEventListener('timeupdate',()=>{if(!layer.requestVideoFrameCallback)fallbackFrame(layer);});
    layer.addEventListener('ended',()=>{if(pending)fallbackFrame(layer);else finish(layer);});
  }
  function retry(){
    if(!active)return;
    if(!video.error){resume();return;}
    const entry=cache.get(wanted);
    if(entry){URL.revokeObjectURL(entry.src);cache.delete(wanted);}
    if(aisle)beginAisle();else select(group,item,which,jacket);
  }
  if(window.ResizeObserver) new ResizeObserver(resize).observe(view);
  window.addEventListener('resize',resize,{passive:true});
  return {start:begin,reset,resume,pause,prepare,retry,snapshot,layers,
    failed:()=>active && Boolean(expected) && video.currentSrc===expected,
    action:()=>act(aisle?'enter':'confirm'),aisle:()=>aisle,
    wantsPlay:()=>active && !held && Boolean(expected) && picker.hidden};
}
