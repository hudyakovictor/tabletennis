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
  const g = { score:[], ball:{live:false,p:{x:0,y:1,z:0},v:{x:0,y:0,z:0}}, state:'RALLY', serveBounces:1, netTouched:false,
    rallyBounces:[], time:0, audio:{ui(){}}, ui:{trainSync(){},trainDone(){}}, cancelInput(){this.cancelled=true;} };
  const t = new physics.Trainer(g);g.training=t;t.begin();return {g,t};
}
const stepIndex = (id) => TRAIN_STEPS.findIndex((s) => s.id === id);
test('drills go easy → hard: serve first, then hit, aim, spins, recap', () => {
  assert.equal(TRAIN_STEPS.map((s) => s.id).join(','), 'SERVE,HIT,AIM,TOPSPIN,PUSH,RALLY');
  for (const step of TRAIN_STEPS) { assert.ok(step.goal.length<=30); assert.equal(step.gesture,undefined); }
});
test('starting a drill clears stale input; one successful action cannot skip all repetitions', () => {
  const {g,t}=trainerFixture();assert.equal(g.cancelled,true);assert.equal(t.phase,'intro');
  t.phase='live';t.onPlayerHit({});t.onBounce(-1,1);assert.equal(t.done,1);assert.equal(t.phase,'ok');
  t.onBounce(-1,1);assert.equal(t.done,1);assert.equal(t.step,0);
  t.update(1.1);assert.equal(t.phase,'wait');assert.equal(t.step,0);
});
test('guided drills hold every ball until the gesture; only the recap step drops the crutches', () => {
  /* Тренировка — обучение, не экзамен: мяч ждёт жеста на КАЖДОМ мяче во
   * всех шагах с подсказкой, никакой лесенки усложнений внутри урока. */
  const {t}=trainerFixture();
  t.ballNo=1;assert.equal(t.guide,'freeze');
  t.ballNo=2;assert.equal(t.guide,'freeze');
  t.ballNo=3;assert.equal(t.guide,'freeze');
  t.phase='live';t.fail('x');t.phase='live';t.fail('x');assert.equal(t.guide,'freeze');
  t.goStep(stepIndex('RALLY'));t.ballNo=1;assert.equal(t.guide,'none');
});
test('a held ball is released only by a press the contact gate accepts', () => {
  const {t}=trainerFixture();t.phase='live';t.frozen=true;
  t.onPress({accepted:false,reason:'OUTSIDE_ZONE'});assert.equal(t.frozen,true);assert.ok(t.nudge>0);
  t.onPress({accepted:true});assert.equal(t.frozen,false);
});
test('intro waits for a tap; fail message is readable but never blocks the flow', () => {
  /* объявление урока ждёт касания; разбор ошибки сам исчезает через 3.2 с,
   * а касание мгновенно подаёт следующий мяч — попытки не «застревают» */
  const {t}=trainerFixture();
  t.update(5);assert.equal(t.phase,'intro');          // никакого авто-таймаута на карточке
  t.onPress({accepted:false});assert.equal(t.phase,'wait');
  t.phase='fail';t.update(1.0);assert.equal(t.phase,'fail');   // время прочитать
  t.update(2.4);assert.equal(t.phase,'wait');                  // поток не блокируется
  t.phase='fail';t.onPress({accepted:false});assert.equal(t.phase,'wait');  // тап ускоряет
});
test('serve let does not count as a successful training serve', () => {
  const {g,t}=trainerFixture();t.goStep(stepIndex('SERVE'));t.phase='live';g.netTouched=true;t.onBounce(-1,1);assert.equal(t.done,0);
  g.netTouched=false;t.onBounce(-1,1);assert.equal(t.done,1);
});
test('spin drills require actual spin AND a landing on the opponents half', () => {
  const {t}=trainerFixture();t.goStep(stepIndex('TOPSPIN'));t.phase='live';t.onPlayerHit({topspin:60});assert.equal(t.done,0);
  t.onBounce(1,1);assert.equal(t.done,0);t.onBounce(-1,1);assert.equal(t.done,1);
  t.phase='live';t.onPlayerHit({topspin:-60});t.onBounce(-1,1);assert.equal(t.done,1);assert.equal(t.phase,'fail');
});
test('aim drill counts only a landing on the highlighted half', () => {
  const {g,t}=trainerFixture();t.goStep(stepIndex('AIM'));t.aimSide=1;
  t.phase='live';t.onPlayerHit({});g.ball.p.x=-0.3;t.onBounce(-1,1);assert.equal(t.done,0);assert.equal(t.phase,'fail');
  t.phase='live';t.onPlayerHit({});g.ball.p.x=0.3;t.onBounce(-1,1);assert.equal(t.done,1);
});
test('training progresses automatically after completed drill; no live next button is required', () => {
  /* урок 1 — подача в три зоны: центр → лево → право; закрываем третью цель */
  const {g,t}=trainerFixture();t.done=t.S.need-1;t.phase='live';g.ball.p.x=0.34;t.onPlayerHit({});t.onBounce(-1,1);t.update(1.1);
  assert.equal(t.step,1);assert.equal(t.phase,'intro');assert.equal(t.done,0);
});
