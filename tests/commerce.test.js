'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApi } = require('../lib/api-core');
function fixture(perms = ['bookings.view','bookings.manage','memberships.view','memberships.manage']) {
 const mem = { inquiries: [{id:'inq_old',tourId:'tour',name:'Old',email:'old@example.com',message:'Original',status:'new'}], memberships:{plans:[],members:[]},audit:[] };
 const user = {id:'staff',email:'staff@example.com',role:'staff',perms};
 const storage = {getUsers:async()=>[user],getTours:async()=>[{slug:'tour',title:'Tour'}]};
 for (const key of ['Inquiries','Memberships','Audit']) {
  const name = key.toLowerCase(); storage['get'+key] = async()=>structuredClone(mem[name]); storage['save'+key] = async(v)=>{mem[name]=structuredClone(v);};
 }
 const api=createApi({storage,sessions:{get:async()=>user.id},rateLimit:{isLimited:async()=>false,noteFail:async()=>{}}});
 async function call(method,path,body={},auth=true,origin) {
  const req=Readable.from([Buffer.from(JSON.stringify(body))]); Object.assign(req,{method,headers:{host:'localhost',...(auth?{cookie:'et_admin=test'}:{}),...(origin?{origin}:{})},socket:{remoteAddress:'127.0.0.1'},url:path});
  let status,data; const res={writeHead:c=>{status=c;},end:v=>{data=JSON.parse(v);}};
  await api.handleAPI(req,res,new URL(path,'http://localhost'));return {status,...data};
 }
 return {call,mem};
}
async function plan(f,enabled=true) {return (await f.call('POST','/api/membership-plans',{name:'Monthly',priceCents:2500,interval:'month',enabled})).record;}
test('manual routes require login and granular permissions',async()=>{
 for(const route of ['/api/booking-records','/api/membership-plans','/api/memberships']) {
  assert.equal((await fixture().call('GET',route,{},false)).status,403);
  assert.equal((await fixture([]).call('GET',route)).status,403);
  assert.equal((await fixture(['bookings.view','memberships.view']).call('PATCH',route,{})).status,403);
 }
});
test('manual booking list includes legacy inquiries without creating duplicate orders',async()=>{
 const f=fixture();const r=await f.call('GET','/api/booking-records');assert.equal(r.records.length,1);assert.equal(r.paymentsEnabled,false);assert.equal(f.mem.inquiries.length,1);
});
test('structured booking validates tour/date/counts and preserves original inquiry',async()=>{
 const f=fixture();const b={kind:'booking',tourId:'tour',name:'Visitor',email:'visitor@example.com',message:'Please quote',booking:{departDate:'2027-01-15',adults:2,children:1,room:'Twin'}};
 const r=await f.call('POST','/api/inquiries',b,false);assert.equal(r.status,200);assert.equal(f.mem.inquiries[0].booking.adults,2);assert.equal(f.mem.inquiries[0].bookingStatus,'requested');
 for(const bad of [{...b,tourId:'unknown'},{...b,booking:{...b.booking,departDate:'2027-02-30'}},{...b,booking:{...b.booking,adults:0}},{...b,booking:{...b.booking,children:-1}}]) assert.equal((await f.call('POST','/api/inquiries',bad,false)).status,400);
});
test('honeypot structured booking does not save',async()=>{const f=fixture();const before=structuredClone(f.mem);assert.equal((await f.call('POST','/api/inquiries',{name:'Bot',email:'bot@example.com',message:'hello world',website:'spam'},false)).status,200);assert.deepEqual(f.mem,before);});
test('booking updates quote/deposit safely with audit and revision',async()=>{
 const f=fixture();const r=await f.call('PATCH','/api/booking-records',{id:'inq_old',revision:0,bookingStatus:'quoted',quoteCents:10000,depositCents:2000,staffNotes:'Call guest'});assert.equal(r.status,200);assert.equal(r.record.currency,'NZD');assert.equal(r.record.revision,1);assert.equal(r.record.message,'Original');assert.equal(f.mem.audit.length,1);
 assert.equal((await f.call('PATCH','/api/booking-records',{id:'inq_old',revision:0,bookingStatus:'confirmed'})).status,409);
});
test('invalid booking amounts, fake payment fields and status do not mutate',async()=>{
 for(const changes of [{quoteCents:-1},{quoteCents:1.5},{quoteCents:100,depositCents:101},{bookingStatus:'paid'},{paymentStatus:'paid'},{quoteCents:'100'},{quoteCents:1e15}]) {const f=fixture();const before=structuredClone(f.mem);assert.equal((await f.call('PATCH','/api/booking-records',{id:'inq_old',revision:0,...changes})).status,400);assert.deepEqual(f.mem,before);}
});
test('manual write checks origin, missing record and methods',async()=>{
 const f=fixture();assert.equal((await f.call('PATCH','/api/booking-records',{},true,'https://evil.example')).status,403);assert.equal((await f.call('PATCH','/api/booking-records',{id:'unknown',revision:0})).status,404);assert.equal((await f.call('POST','/api/booking-records',{})).status,405);
});
test('plan create/update rejects duplicates, invalid cents and unknown keys',async()=>{
 const f=fixture();const p=await plan(f);assert.equal(p.currency,'NZD');assert.equal(p.revision,1);
 assert.equal((await f.call('POST','/api/membership-plans',{name:'Monthly',priceCents:2500,interval:'month',enabled:true})).status,409);
 assert.equal((await f.call('POST','/api/membership-plans',{name:'Bad',priceCents:2.5,interval:'month',enabled:true})).status,400);
 assert.equal((await f.call('PATCH','/api/membership-plans',{id:p.id,revision:1,enabled:false})).status,200);
 assert.equal((await f.call('PATCH','/api/membership-plans',{id:p.id,revision:1,enabled:true})).status,409);
 assert.equal((await f.call('POST','/api/membership-plans',null)).status,400);
});
test('manual member creation and lifecycle with duplicate/date protection',async()=>{
 const f=fixture();const p=await plan(f);const b={name:'Guest',email:'GUEST@EXAMPLE.COM',planId:p.id,status:'pending',startsOn:'',endsOn:''};
 const r=await f.call('POST','/api/memberships',b);assert.equal(r.status,200);assert.equal(r.record.email,'guest@example.com');assert.equal(r.record.activationMode,'manual');
 assert.equal((await f.call('POST','/api/memberships',b)).status,409);
 assert.equal((await f.call('PATCH','/api/memberships',{id:r.record.id,revision:1,status:'active'})).status,400);
 assert.equal((await f.call('PATCH','/api/memberships',{id:r.record.id,revision:1,status:'active',startsOn:'2027-01-01',endsOn:'2027-12-31'})).status,200);
 assert.equal((await f.call('PATCH','/api/memberships',{id:r.record.id,revision:2,status:'cancelled'})).status,200);
 assert.equal((await f.call('POST','/api/memberships',b)).status,200);
});
test('full inquiry storage fails without discarding historical bookings',async()=>{
 const f=fixture(); f.mem.inquiries = Array.from({length:1000},(_,i)=>({id:'inq_'+i,tourId:'tour'})); const before=structuredClone(f.mem);
 assert.equal((await f.call('POST','/api/inquiries',{name:'Guest',email:'g@example.com',message:'Please quote'},false)).status,503);assert.deepEqual(f.mem,before);
});
test('disabled plans, invalid member dates/status/payment fields rejected',async()=>{
 const f=fixture();const p=await plan(f,false);const b={name:'Guest',email:'g@example.com',planId:p.id};assert.equal((await f.call('POST','/api/memberships',b)).status,400);
 await f.call('PATCH','/api/membership-plans',{id:p.id,revision:1,enabled:true});
 for(const extra of [{status:'paid'},{startsOn:'2027-02-30'},{startsOn:'2027-01-02',endsOn:'2027-01-01'},{paymentStatus:'paid'},{planId:'unknown'},{email:'bad'}]) assert.equal((await f.call('POST','/api/memberships',{...b,...extra})).status,400);
});
