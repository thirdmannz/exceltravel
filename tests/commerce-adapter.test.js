'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
process.env.EXCELTRAVEL_SESSION_SECRET='isolated-test-secret';
const {createHandler}=require('../netlify/functions/api.cjs');
function fixture({broken=false}={}) {
 const mem=new Map([['users.json',[{id:'u',email:'staff@example.invalid',role:'admin'}]],['memberships.json',{plans:[],members:[]}],['inquiries.json',[]],['audit.json',[]]]);
 const blobs={get:async key=>{if(broken&&key==='memberships.json')throw new Error('storage offline');return structuredClone(mem.get(key)??null);},setJSON:async(k,v)=>mem.set(k,structuredClone(v))};
 const sessions={get:async()=>({userId:'u',exp:Date.now()+100000})};const rate={get:async()=>null,setJSON:async()=>{}};
 const handler=createHandler(blobs,sessions,rate);const payload='token.u.'+Math.floor(Date.now()/1000+60);const cookie='et_admin='+payload+'.'+crypto.createHmac('sha256','isolated-test-secret').update(payload).digest('base64url');
 async function call(method,body) {return handler(new Request('http://localhost/api/membership-plans',{method,headers:{host:'localhost',cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));}
 return {mem,call};
}
test('Netlify adapter persists and reloads manual membership plans using Blobs',async()=>{const f=fixture();const r=await f.call('POST',{name:'Yearly',priceCents:10000,interval:'year',enabled:true});assert.equal(r.status,200);assert.equal(f.mem.get('memberships.json').plans.length,1);const list=await (await f.call('GET')).json();assert.equal(list.records[0].name,'Yearly');assert.equal(list.paymentsEnabled,false);});
test('Netlify read error never overwrites stored membership data with empty fallback',async()=>{const f=fixture({broken:true});const before=structuredClone(f.mem.get('memberships.json'));const r=await f.call('POST',{name:'Yearly',priceCents:10000,interval:'year',enabled:true});assert.equal(r.status,503);assert.deepEqual(f.mem.get('memberships.json'),before);});
