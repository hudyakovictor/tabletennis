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
