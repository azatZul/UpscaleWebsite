import test from 'node:test';
import assert from 'node:assert/strict';
import {installMarketing,pageContext} from '../../src/marketing/main.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(host='upscales.app',accepted=false) {
 const listeners=new Map();const calls=[];let loads=0;
 const memory=new Map([['uscale-consent',JSON.stringify({v:1,analytics:accepted})]]);
 const storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k),get length(){return memory.size},key:i=>[...memory.keys()][i]};
 const document={documentElement:{lang:'ru'},addEventListener:(k,v)=>listeners.set(k,v),defaultView:{addEventListener(){}}};
 const client={init:()=>calls.push('init'),track:(type,p)=>calls.push({type,p}),setTransport(){},flush(){},setOptOut:value=>calls.push({optOut:value})};
 installMarketing({document,location:{hostname:host,pathname:'/ru/'},storage,load:async()=>{loads++;return client;}});
 const consent=analytics=>listeners.get('uscale:consent')?.({detail:{analytics}});
 const click=()=>listeners.get('click')?.({target:{closest:()=>({dataset:{cta:'appstore'},closest:s=>s==='.hero'?{}:null})}});
 return {calls,consent,click,get loads(){return loads}};
}
test('marketing SDK is deferred until consent and is disabled off production',async()=>{
 for(const host of ['localhost','uscale-site-staging.sharrikk.workers.dev']) {const f=fixture(host,true);await tick();assert.equal(f.loads,0);}
 const f=fixture();f.click();await tick();assert.equal(f.loads,0);
 f.consent(true);await tick();f.click();assert.equal(f.loads,1);
 assert.equal(f.calls.filter(c=>c.type==='tap').length,1);
 const event=f.calls.find(c=>c.type==='tap');assert.equal(event.p.page_path,'/ru/');assert.equal(event.p.store,'app_store');
 f.consent(false);f.click();assert.equal(f.calls.filter(c=>c.type==='tap').length,1);
 f.consent(true);f.click();assert.equal(f.calls.filter(c=>c.type==='tap').length,2);
});
test('revoking consent while SDK loads discards pending clicks',async()=>{
 const f=fixture();f.consent(true);f.click();f.consent(false);await tick();assert.equal(f.calls.length,0);
});
test('context contains only explicit page fields',()=>assert.deepEqual(pageContext('/ru/guides/a.html','ru'),{platform:'web',environment:'production',locale:'ru',page_path:'/ru/guides/a.html',page_type:'guide'}));
