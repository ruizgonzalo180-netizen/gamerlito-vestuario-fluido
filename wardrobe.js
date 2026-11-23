'use strict';
function wardrobeMobileQuality() {
  const network=navigator.connection;
  if(network?.saveData || /(^|-)2g$|^3g$/.test(network?.effectiveType || '')) return true;
  return Math.min(innerWidth,innerHeight)<=600 && (navigator.maxTouchPoints>0 || innerWidth<=600);
}

function createWardrobe({video, play, reveal, blocked}) {
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
  let generation = 0, paintTimer, warmTimer, posterTimer, loadTimer, messageTimer;
  let portrait = false, margin = false, lastAmbient = 0;
  let wanted='', expected='', mounted='', paletteKey='', layoutKey='';
  let warmRequest=null, currentPoster=null;
  const cache=new Map(), posters=new Map();
  const sourceWidth = 1920, sourceHeight = 1080;
  const sourceFocus = {outfit:.56, tops:.60, pants:.57, masks:.66, dresses:.56, jewelry:.53, boots:.51, heels:.51, slides:.51};
  ambient.width = 256; ambient.height = 144;
  video.parentElement.prepend(ambient);

  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    const key=[w,h,group?.id,active].join('/');
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
    const visibleFraction = (w/h)/(16/9);
    const target = sourceFocus[group?.id] ?? .57;
    const focus = portrait ? 100*Math.min(1,Math.max(0,(target-visibleFraction/2)/(1-visibleFraction))) : 50;
    view.style.setProperty('--wr-focus',focus+'%');
    const panelW = Math.min(w*.82, 485);
    const area = infoRect();
    root.style.setProperty('--info-w',panelW+'px');
    root.style.setProperty('--panel',(panelW*area.h/area.w)+'px');
    root.style.setProperty('--chip-step',(panelW*120/area.w)+'px');
    root.style.setProperty('--chip-size',(panelW*116/area.w)+'px');
    root.style.setProperty('--chip-bottom',(panelW*(area.y+area.h-975)/area.w)+'px');
    paint(true);
  }
  function infoRect() {
    return group?.id === 'outfit' ? {x:25,y:802,w:790,h:222} : {x:32,y:654,w:727,h:345};
  }
  function drawCrop(canvas, input, sx, sy, sw, sh) {
    const ctx=canvas.getContext('2d',{alpha:false});
    const xr=(input.videoWidth || input.naturalWidth)/sourceWidth;
    const yr=(input.videoHeight || input.naturalHeight)/sourceHeight;
    if (ctx && xr && yr) ctx.drawImage(input,sx*xr,sy*yr,sw*xr,sh*yr,0,0,canvas.width,canvas.height);
  }
  function paint(force, image) {
    if(!active) return;
    if(!image && (pending || video.readyState<2)) return;
    const input=image || video;
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
  function clipUrl(name) {
    return 'media/'+(wardrobeMobileQuality()?'mobile/':'')+name+'.mp4';
  }
  function restrictPreload() {
    const net=navigator.connection;
    return net?.saveData || /(^|-)2g$|^3g$/.test(net?.effectiveType || '') || document.hidden;
  }
  function poster(name, priority='low') {
    if(posters.has(name)) return posters.get(name);
    const img=new Image();
    img.decoding='async'; img.fetchPriority=priority;
    img.src='media/posters/'+name+'.webp';
    posters.set(name,img);
    if(posters.size>12)posters.delete(posters.keys().next().value);
    return img;
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
      if(c.src===mounted)continue;
      URL.revokeObjectURL(c.src);cache.delete(key);bytes-=c.size;
    }
  }
  function warm(name) {
    const url=clipUrl(name);
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
  function warmChoices(){
    clearTimeout(warmTimer);
    if(!active || restrictPreload() || blocked() || !picker.hidden)return;
    warmTimer=setTimeout(()=>{
      if(!active || pending || blocked() || !picker.hidden || restrictPreload())return;
      const options=filmed(group);
      const pos=options.indexOf(item);
      let next=aisle?file(group,item,1):file(group,options[(pos+1)%options.length]);
      if(!aisle && options.length===1) next=file(catalog[1],filmed(catalog[1])[0]);
      poster(next);
      warm(next);
      if(options.length>2)poster(file(group,options[(pos+options.length-1)%options.length]));
    },110);
  }
  function prepare(){
    if(!restrictPreload())warm('entry');
  }
  function freezeFrom(input){
    const width=Math.min(960,input.videoWidth || input.naturalWidth || 0);
    if(!width)return;
    const height=Math.round(width*9/16);
    if(freeze.width!==width || freeze.height!==height){freeze.width=width;freeze.height=height;}
    drawCrop(freeze,input,0,0,sourceWidth,sourceHeight);
    freeze.hidden=false;
  }
  function stopPainting(){clearInterval(paintTimer);}
  function startPainting(){
    stopPainting();
    if(!active || pending || held || video.paused || (!portrait && !margin))return;
    paintTimer=setInterval(()=>paint(false),portrait?130:300);
  }
  function ready(){
    if(!active || !pending || video.readyState<2 || video.currentSrc!==expected)return;
    pending=false; currentPoster=null; clearTimeout(posterTimer);
    root.dataset.motion='playing'; reveal(); freeze.hidden=true;
    paint(true); warmChoices(); resume(); startPainting();
  }
  function finish(){
    if(!active || pending || held || video.currentSrc!==expected || !video.ended)return;
    stopPainting();paint(true);
    if(aisle && root.dataset.entryAuto==='yes'){
      select(catalog[0],filmed(catalog[0])[0],1);
    }else{
      held=true;root.dataset.motion='held';
    }
  }
  function clip(range,name){
    const token=++generation;
    const nextUrl=clipUrl(name);
    clearTimeout(posterTimer);clearTimeout(loadTimer); clearTimeout(warmTimer);stopPainting();
    if(!pending && !video.hidden && video.readyState>=2 && video.style.opacity==='1' && freeze.hidden) freezeFrom(video);
    video.pause();
    held=false;pending=true;wanted=nextUrl;expected='';
    root.dataset.from=range[0];root.dataset.to=range[1];root.dataset.motion='loading';
    root.dataset.origin=Math.ceil(range[0]*fps-1e-8)/fps;
    root.dataset.asset=video.dataset.asset=nextUrl;
    video.dataset.origin=root.dataset.origin;
    function showPoster(){
      if(token!==generation || !pending || !active)return;
      const img=poster(name,'high');
      currentPoster=img;
      const show=()=>{
        if(token!==generation || !active || !pending || !img.naturalWidth)return;
        freezeFrom(img); paint(true,img);
      };
      if(img.complete)show();
      else img.addEventListener('load',show,{once:true});
    }
    if(posters.get(name)?.complete)showPoster();
    else posterTimer=setTimeout(showPoster,125);

    // Only the most recent intent may attach an asset. Streaming a cold clip lets
    // the browser present its opening keyframe while subsequent frames arrive.
    function mount(){
      if(token!==generation || !active || expected)return;
      clearTimeout(loadTimer);
      const asset=cache.get(nextUrl);
      mounted=asset?.src || new URL(nextUrl,document.baseURI).href;
      expected=mounted;
      if(!asset && warmRequest?.url===nextUrl)stopWarm();
      video.preload='auto'; video.src=mounted;
      video.load();
      if(!blocked() && picker.hidden) play();
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
    video.pause(); picker.hidden=false; button('categories').setAttribute('aria-expanded','true');
  }
  function select(nextGroup,nextItem,windowIndex=0,withJacket=false) {
    if(!nextGroup || !nextItem?.windows.length) return;
    group=nextGroup; item=nextItem; aisle=false;
    jacket=Boolean(withJacket && item.jacketWindows?.length);
    const windows=jacket ? item.jacketWindows : item.windows;
    which=Math.max(0,Math.min(windows.length-1,windowIndex));
    const saved=records[group.id];
    const wearing=saved?.worn===item.index && Boolean(saved?.jacket)===jacket;
    root.dataset.mode=wearing?'equipped':'browse';
    root.dataset.category=group.id; root.dataset.option=item.index; root.dataset.jacket=String(jacket);
    root.setAttribute('aria-label','Vestuario de Lucía — '+item.name);
    closeMenu(false); showPalette(); resize(); clip(windows[which],file(group,item,which,jacket));
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
    if(!held && expected) play();
    else if(held) paint(true);
  }
  function reset() {
    active=false; held=false; pending=false; generation++;
    stopPainting();stopWarm();clearTimeout(posterTimer);clearTimeout(loadTimer);
    currentPoster=null;expected='';wanted='';mounted='';layoutKey='';
    if(video.hasAttribute('src')) {video.pause();video.removeAttribute('src');video.load();}
    for(const c of cache.values())URL.revokeObjectURL(c.src);
    cache.clear();
    clearTimeout(messageTimer); status.textContent='';
    root.hidden=true; freeze.hidden=true; ambient.hidden=true; closeMenu(false);
  }
  function begin() {
    if(active)reset();
    active=true; root.hidden=false; beginAisle();
  }
  function snapshot() {
    const c=document.createElement('canvas');
    const scale=Math.min(1,1280/Math.max(view.clientWidth,view.clientHeight));
    c.width=Math.round(view.clientWidth*scale); c.height=Math.round(view.clientHeight*scale);
    const ctx=c.getContext('2d');
    if(!ctx || video.readyState<2) return null;
    const r=Math[portrait?'max':'min'](c.width/sourceWidth,c.height/sourceHeight);
    const w=sourceWidth*r, h=sourceHeight*r;
    ctx.fillStyle='#101115'; ctx.fillRect(0,0,c.width,c.height);
    const f=(parseFloat(view.style.getPropertyValue('--wr-focus'))||50)/100;
    ctx.drawImage(video,(c.width-w)*(portrait?f:.5),(c.height-h)*.5,w,h);
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
  for(const evt of ['loadeddata','canplay','playing'])video.addEventListener(evt,ready);
  video.addEventListener('playing',startPainting);
  video.addEventListener('pause',stopPainting);
  video.addEventListener('ended',finish);
  picker.addEventListener('pointerover',e=>{
    if(e.pointerType!=='mouse' || restrictPreload())return;
    const g=findGroup(e.target.closest('button')?.dataset.category);
    if(g)poster(file(g,filmed(g)[0]));
  });
  function retry(){
    if(!active)return;
    if(!video.error){resume();return;}
    const entry=cache.get(wanted);
    if(entry){URL.revokeObjectURL(entry.src);cache.delete(wanted);}
    if(aisle)beginAisle();else select(group,item,which,jacket);
  }
  if(window.ResizeObserver) new ResizeObserver(resize).observe(view);
  window.addEventListener('resize',resize,{passive:true});
  return {start:begin,reset,resume,prepare,retry,snapshot,
    failed:()=>active && Boolean(expected) && video.currentSrc===expected,
    action:()=>act(aisle?'enter':'confirm'),aisle:()=>aisle,
    wantsPlay:()=>active && !held && Boolean(expected) && picker.hidden};
}
