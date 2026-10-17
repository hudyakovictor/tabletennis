const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebSocket = require('ws');
const { createRelay } = require('../tt/server');
const { load } = require('./helpers.cjs');
function fixture() {
  const sockets = [];
  class Socket {
    static OPEN = 1;
    constructor() { this.readyState = 1; sockets.push(this); }
    send() {} close() { this.readyState = 3; }
  }
  const lib = load(['10_math.js', '30_physics.js', '27_network.js'], ['NetworkManager', 'V3'],
    { WebSocket: Socket, location: { search: '' } });
  const game = { ball: { p: lib.V3.new(), v: lib.V3.new(), w: lib.V3.new(), live: true }, score: [0,0] };
  return { ...lib, sockets, net: new lib.NetworkManager(game), game };
}
test('old WebSocket close/open cannot overwrite a new connection', () => {
  const { net, sockets } = fixture(); net.connect('ws://one'); const old=sockets[0];
  net.connect('ws://two'); sockets[1].onopen(); old.onclose(); old.onopen();
  assert.equal(net.connected,true); assert.equal(net.ws,sockets[1]); assert.equal(net.state,'LOBBY'); net.disconnect();
});
test('disconnect and leave clear host identity and interpolation', () => {
  const { net } = fixture(); net.isHost=true; net._interpBuf.push({}); net.disconnect();
  assert.equal(net.isHost,false); assert.equal(net._interpBuf.length,0);
  net.connected=true; net.isHost=true; net.leaveRoom(); assert.equal(net.isHost,false);
});
test('remote updates refresh ball spin and stop a dead ball', () => {
  const { net, game } = fixture(); net._applyRemoteState({ ball: { p:[1,2,3],v:[1,2,3],w:[9,8,7] } });
  assert.equal(game.ball.w.x,9); net._applyRemoteState({ball:null}); assert.equal(game.ball.live,false);
});
test('invalid remote packet cannot partially corrupt ball or racket', () => {
  const { net, game } = fixture(); const before=JSON.stringify(game);
  net._applyRemoteState({ball:{p:[1,2,3],v:[1,2,3],w:[0,null,0]}});
  net._applyRemoteState({racket:{pos:[1,2],n:[0,1,0]}});
  net._applyRemoteState({score:[-1,2]}); assert.equal(JSON.stringify(game),before);
  const pos=JSON.stringify(net.opponentRacket);
  net._applyRemoteInput({pos:[NaN,0,0]}); assert.equal(JSON.stringify(net.opponentRacket),pos);
  net._handle(null); net._handle([]);
});
test('remote scores are copied, not aliased', () => {
  const {net,game}=fixture(); const score=[2,1]; net._applyRemoteState({score}); score[0]=999;
  assert.equal(game.score[0],2);
});
test('relay room lifecycle, capacity, authority and malformed messages', { timeout: 15000 }, async t => {
  const { server, wss, rooms } = createRelay(); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const clients=[];
  t.after(async()=>{ for(const c of clients)c.terminate(); wss.close(); await new Promise(r=>server.close(r)); });
  async function client() {
    const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}`); clients.push(ws);
    ws.queue=[]; ws.on('message',d=>ws.queue.push(JSON.parse(d))); await once(ws,'open'); return ws;
  }
  function receive(ws, type) {
    const queued=ws.queue.findIndex(m=>m.type===type);
    if(queued>=0) return Promise.resolve(ws.queue.splice(queued,1)[0]);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{ws.off('message',listener);reject(Error('missing '+type));},2000);
      function listener(d){const m=JSON.parse(d);if(m.type!==type)return;clearTimeout(timer);ws.off('message',listener);
        ws.queue.splice(ws.queue.findIndex(x=>x.type===type),1);resolve(m);}
      ws.on('message',listener);
    });
  }
  const send=(ws,obj)=>ws.send(JSON.stringify(obj));
  const a=await client(),b=await client(),c=await client();
  // Previously JSON null crashed the process in switch(msg.type).
  for(const bad of ['null','[]','"text"','{'])a.send(bad);
  send(a,{type:'join'}); const assigned=await receive(a,'assigned'); const code=assigned.room;
  assert.match(code,/^[A-Z0-9]{5}$/);
  send(b,{type:'join',room:code.toLowerCase()}); assert.equal((await receive(b,'assigned')).side,-1);
  await receive(a,'ready'); await receive(b,'ready');
  send(c,{type:'join',room:code}); assert.match((await receive(c,'error')).message,/заполнена/);
  assert.equal(rooms.size,1); assert.equal(rooms.get(code).host._room,code);
  send(a,{type:'state',score:[3,1]}); assert.deepEqual((await receive(b,'state')).score,[3,1]);
  send(b,{type:'point',who:-1}); send(b,{type:'ping',t:123}); await receive(b,'pong');
  assert.equal(a.queue.some(m=>m.type==='point'),false);
  send(c,{type:'join',room:'ZZZZZ'}); assert.match((await receive(c,'error')).message,/не найдена/);
  assert.equal(rooms.size,1);
  send(a,{type:'join',room:code}); send(a,{type:'ping'}); await receive(a,'pong');
  assert.equal(rooms.size,1); // host cannot become their own guest
  send(b,{type:'leave'}); assert.equal((await receive(a,'peer_left')).roomClosed,false);
  send(c,{type:'join',room:code}); await receive(c,'assigned'); await receive(a,'ready'); await receive(c,'ready');
  send(a,{type:'leave'}); assert.equal((await receive(c,'peer_left')).roomClosed,true); assert.equal(rooms.size,0);
  send(c,{type:'join'}); assert.equal((await receive(c,'assigned')).side,1);
});
