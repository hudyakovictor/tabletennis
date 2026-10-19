const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const {detectInputMode,trainingTip,TRAIN_STEPS}=load(['65_train.js'],['detectInputMode','trainingTip','TRAIN_STEPS']);
const screen=(coarse,fine)=>({matchMedia:q=>({matches:q==='(pointer: coarse)'?coarse:fine})});
test('phone is touch, mouse desktop is mouse, hybrid initially prefers its primary pointer',()=>{
  assert.equal(detectInputMode(screen(true,false),{maxTouchPoints:5}),'touch');
  assert.equal(detectInputMode(screen(false,true),{maxTouchPoints:0}),'mouse');
  assert.equal(detectInputMode(screen(false,true),{maxTouchPoints:10}),'mouse');
  assert.equal(detectInputMode({}, {maxTouchPoints:1}),'touch');
  assert.equal(detectInputMode({}, {}),'mouse');
});
test('every drill has a concise touch and left-mouse instruction',()=>{
  for(const step of TRAIN_STEPS){
    assert.ok(trainingTip(step,'touch').length<=40);
    assert.ok(trainingTip(step,'mouse').length<=40);
    assert.match(trainingTip(step,'mouse'),/ЛКМ/);
    assert.doesNotMatch(trainingTip(step,'touch'),/мыш|ЛКМ|колес|ПКМ/);
    assert.doesNotMatch(trainingTip(step,'mouse'),/палец|свайп/i);
    if(step.failHint)assert.ok(step.failHint.length<36);
  }
});

const physics = load(['10_math.js','30_physics.js','65_train.js'], ['Trainer','TRAIN_STEPS'], { GS: { RALLY:'RALLY', MENU:'MENU', SERVE_READY:'SERVE_READY', SERVE_TOSS:'SERVE_TOSS' } });
function trainerFixture() {
  const g = { score:[], ball:{live:false}, state:'RALLY', serveBounces:1, netTouched:false,
    audio:{ui(){}}, ui:{trainSync(){},trainDone(){}}, cancelInput(){this.cancelled=true;} };
  const t = new physics.Trainer(g);g.training=t;t.begin();return {g,t};
}
test('training objectives are short; no gesture animation data or obsolete ring instructions remain', () => {
  for (const step of TRAIN_STEPS) {
    assert.ok(step.goal.length<=30); assert.equal(step.gesture,undefined);
    assert.doesNotMatch(step.tip+step.mouseTip+(step.failHint||''), /кольц|замыкан/i);
  }
});
test('starting a drill clears stale input; one successful action cannot skip all repetitions', () => {
  const {g,t}=trainerFixture();assert.equal(g.cancelled,true);assert.equal(t.phase,'intro');
  t.phase='live';t.onBounce(-1,1);assert.equal(t.done,1);assert.equal(t.phase,'ok');
  t.onBounce(-1,1);assert.equal(t.done,1);assert.equal(t.step,0);
  t.update(1.1);assert.equal(t.phase,'wait');assert.equal(t.step,0);
});
test('serve let does not count as a successful training serve', () => {
  const {g,t}=trainerFixture();t.phase='live';g.netTouched=true;t.onBounce(-1,1);assert.equal(t.done,0);
  g.netTouched=false;t.onBounce(-1,1);assert.equal(t.done,1);
});
test('spin drills require actual spin AND a landing on the opponents half', () => {
  const {t}=trainerFixture();t.goStep(1);t.phase='live';t.onPlayerHit({topspin:60});assert.equal(t.done,0);
  t.onBounce(1,1);assert.equal(t.done,0);t.onBounce(-1,1);assert.equal(t.done,1);
  t.phase='live';t.onPlayerHit({topspin:-60});t.onBounce(-1,1);assert.equal(t.done,1);assert.equal(t.phase,'fail');
});
test('training progresses automatically after completed drill; no live next button is required', () => {
  const {t}=trainerFixture();t.done=t.S.need-1;t.phase='live';t.onBounce(-1,1);t.update(1.1);
  assert.equal(t.step,1);assert.equal(t.phase,'intro');assert.equal(t.done,0);
});
