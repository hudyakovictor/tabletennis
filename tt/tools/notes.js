const puppeteer=require('puppeteer');
(async()=>{const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p=await br.newPage();await p.setViewport({width:900,height:560});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});await new Promise(r=>setTimeout(r,1800));
const out=await p.evaluate(()=>{document.querySelectorAll('.screen').forEach(e=>e.classList.remove('on'));
 const g=window.__game;g.settings.targetScore=21;g.startMatch(2);g.paused=true;const DT=1/120;const notes=[];
 const oa=g.awardPoint.bind(g);g.awardPoint=function(w,r){oa(w,r);if(g.pointNote)notes.push((w>0?'+ ':'- ')+'['+r+'] '+g.pointNote.key+' | '+g.pointNote.text);};
 let ges=null,cool=0;
 const pd=(x,y)=>{g.swipe.down(x,y,g.time);g.pointer={x,y};g.pointerDown=true;if(g.state==='SERVE_READY'&&g.server===1)g.startToss();};
 const pm=(x,y)=>{g.pointer={x,y};if(g.swipe.active)g.swipe.move(x,y,g.time);};
 const pu=()=>{if(!g.swipe.active)return;g.swipe.up(g.pointer.x,g.pointer.y,g.time);g.pointerDown=false;g.swipeReleasedAt=g.time;g.lastSwipeT=g.time;};
 const aim=()=>{const W=g._strike;let wx=0,wy=PH.TABLE_Y+0.25;if(W&&W.on&&W.kind==='rally'){wx=W.x;wy=W.y;}
  wx=Math.max(-1.1,Math.min(1.1,wx));wy=Math.max(PH.TABLE_Y-0.2,Math.min(PH.TABLE_Y+0.85,wy));
  return{x:0.5+wx/2.10,y:0.18+(PH.TABLE_Y+0.62-wy)/0.95};};
 for(let i=0;i<120*150;i++){
  if(!ges){const q=aim();pm(q.x,q.y);}
  if(ges){const s=Math.min(1,(g.time-ges.t0)/0.15);pm(ges.x0+0.01*s,ges.y0-0.30*s);if(s>=1){pu();ges=null;cool=0.3;}}
  if(!ges&&cool<=0){const b=g.ball,W=g._strike;
   if(g.state==='SERVE_READY'&&g.server===1){const q=aim();ges={t0:g.time,x0:q.x,y0:q.y};pd(q.x,q.y);}
   else if(g.state==='RALLY'&&b.live&&b.lastHitBy===-1&&W&&W.on&&W.kind==='rally'&&W.t<0.15){const q=aim();ges={t0:g.time,x0:q.x,y0:q.y};pd(q.x,q.y);}}
  cool-=DT;g.update(DT);if(g.state==='MATCH_END')break;}
 return {score:g.score,notes:notes.slice(0,14),n:notes.length,hand:+g.ai.handicap.toFixed(3)};});
console.log('score',out.score.join(':'),'| notes',out.n,'| handicap',out.hand);
out.notes.forEach(n=>console.log('  ',n));
await br.close();})();
