const {test}=require('node:test');const assert=require('node:assert/strict');const {load}=require('./helpers.cjs');
function fixture(){
 const L=load(['10_math.js','30_physics.js','75_feedback.js','70_game.js'],['HitFeedbackSystem','Game','V3']);
 const calls={sound:[],burst:[],buzz:[],slowmo:0,whoosh:[]};
 const game=Object.assign(Object.create(L.Game.prototype),{
  time:0,reducedMotion:false,settings:{haptics:true,slowmoOnBigShots:true,showPredict:false},shake:0,shakeDir:L.V3.new(),hitFlash:0,camFov:48,
  emitParticles(...a){calls.burst.push(a);},buzz(a){calls.buzz.push(a);},punchSlowmo(){calls.slowmo++;},
  audio:{ok:true,hitRacket(...a){calls.sound.push(a);},whoosh(a){calls.whoosh.push(a);},onRallyHit(){}},
  career:{active:false},ball:{v:L.V3.new(0,1,-24),w:L.V3.new(-220,20,0),p:L.V3.new(0,1,1.6)},
  shotId:0,rallyBounces:[],isServeBall:true,stats:{shots:0,totalSpin:0,maxSpeed:0,maxSpin:0,byStroke:{}},
  lastSweet:.9,lastTiming:'ТОЧНО',recorder:{addShot(){}},moments:{addContact(){}},matchTasks:{topspin:0,smash:0,serves:0},
 });game.hitFeedback=new L.HitFeedbackSystem(game);return{...L,game,calls};
}
test('one physical hit = one sound, one burst and one haptic; no automatic hit slowmo',()=>{
 const {game,calls,V3}=fixture();
 game.applyHit(1,{stroke:{id:'SMASH'},arch:{},normal:V3.new(0,0,-1),power:.9},V3.new(0,1,1.6),.9,{contactSlip:7});
 assert.equal(calls.sound.length,1);assert.equal(calls.burst.length,1);assert.equal(calls.buzz.length,1);assert.equal(calls.slowmo,0);
 assert.equal(calls.sound[0][0],Math.hypot(1,24),'audio receives m/s, not km/h');
 assert.equal(calls.sound[0][1],7);assert.equal(game.camFov,48,'smashes never accumulate FOV drift');
 assert.ok(calls.burst[0][3]<=24);assert.ok(calls.whoosh.length<=1);
});
test('reduced-motion skips all impact motion/particles, not the physical contact sound',()=>{
 const {game,calls,V3}=fixture();game.reducedMotion=true;game.settings.haptics=false;
 game.applyHit(1,{stroke:{id:'LOOP'},arch:{},normal:V3.new(0,0,-1)},V3.new(0,1,1.6),.9,{contactSlip:10});
 assert.equal(calls.sound.length,1);assert.equal(calls.burst.length,0);assert.equal(calls.buzz.length,0);assert.equal(game.shake,0);assert.equal(game.hitFlash,0);
});
test('feedback honours zero quality, opponent side, reset clock and spin convention',()=>{
 const {game,calls,V3}=fixture();let quality;
 const visual=game.hitFeedback.visual;game.hitFeedback.visual=function(q,...a){quality=q;return visual.call(this,q,...a);};
 const ctx={quality:0,speed:10,spin:V3.new(-200,0,0),side:-1,contactPoint:V3.new(),contactNormal:V3.new(0,0,-1)};
 game.hitFeedback.execute(ctx);assert.equal(quality,0);assert.equal(calls.buzz.length,0);
 assert.equal(game.hitFeedback.determineSpinType(V3.new(-200,0,0)),'topspin');
 assert.equal(game.hitFeedback.determineSpinType(V3.new(200,0,0)),'backspin');
 game.time=100;game.hitFeedback.execute(ctx);game.time=0;game.hitFeedback.execute(ctx);
 assert.equal(calls.sound.length,3,'clock reset must not mute subsequent games');
});

test('block, serve and hard attack have distinct single haptic patterns',()=>{
 const {game,calls,V3}=fixture();
 const ctx={quality:.95,speed:20,side:1,spin:V3.new(-200,0,0),contactPoint:V3.new(),contactNormal:V3.new(0,0,-1)};
 for(const kind of ['BLOCK','SERVE_TOP','SMASH']){
  game.time+=1;game.hitFeedback.execute({...ctx,stroke:kind,isServeStroke:kind==='SERVE_TOP'});
 }
 assert.equal(calls.buzz.length,3);assert.equal(new Set(calls.buzz.map(JSON.stringify)).size,3);
 assert.ok(calls.burst[0][3]<calls.burst[2][3],'block must not look like an explosive smash');
});
