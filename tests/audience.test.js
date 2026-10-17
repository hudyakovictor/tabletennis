const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const { spectatorClapPlan, AudioEngine } = load(['10_math.js','50_audio.js'], ['spectatorClapPlan','AudioEngine']);
test('small-club applause is separate claps from at most six people', () => {
  for(const amount of [.3,1,1.6,99]) {
    const plan=spectatorClapPlan(amount,()=>.5);
    assert.ok(new Set(plan.map(c=>c.person)).size<=6);
    assert.ok(plan.length<=36);
    assert.ok(plan.every(c=>c.t>0 && c.t<2.5 && c.gain>0 && c.gain<=.018 && Math.abs(c.pan)<=1));
    const counts=new Map();
    for(const c of plan) { const previous=counts.get(c.person); if(previous)assert.ok(c.t-previous>.2);counts.set(c.person,c.t); }
  }
  assert.equal(spectatorClapPlan(NaN).length,0);
  assert.equal(spectatorClapPlan(0).length,0);
});
test('rally spectators react to milestones, not to every impact', () => {
  const a=new AudioEngine(), calls=[];a.ok=true;a.ctx={currentTime:10};
  a._spectatorOh=(...args)=>calls.push(args);
  for(let hit=1;hit<=7;hit++)a.onRallyHit(hit);
  assert.equal(calls.length,2);
  a.onRallyHit(8);assert.equal(calls.length,2); // cooldown
  a.ctx.currentTime=14;a.onRallyHit(12);assert.equal(calls.length,5);
  a.onRallyHit(12);assert.equal(calls.length,5);
  a.resetRally();a.ctx.currentTime=18;a.onRallyHit(4);assert.equal(calls.length,7);
  a.setMuted(true);a.ctx.currentTime=22;a.onRallyHit(8);assert.equal(calls.length,7);
});
test('applause is bounded, respects mute and cannot pile up repeatedly', () => {
  const a=new AudioEngine(), calls=[];a.ok=true;a.ctx={currentTime:1};a._clap=(...args)=>calls.push(args);
  a.applause(1.6);assert.equal(calls.length,36);
  a.applause(1.6);assert.equal(calls.length,36);
  a.ctx.currentTime=4;a.setMuted(true);a.applause(1.6);assert.equal(calls.length,36);
});
test('stopping the audience cancels scheduled and playing spectators', () => {
  const a=new AudioEngine();let stopped=0;
  a._audienceSources.add({stop(){stopped++;}});a._audienceSources.add({stop(){stopped++;}});
  a.stopAudience();assert.equal(stopped,2);assert.equal(a._audienceSources.size,0);
});
