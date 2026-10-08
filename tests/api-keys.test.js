'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const { createApi } = require('../lib/api-core');

function fixture() {
  const data = { users: [{id:'admin-1',email:'admin@test',role:'admin',perms:['tours.view','tours.edit.image']}], tours:[{slug:'demo',title:'Demo',images:[]}], keys:[], audit:[] };
  const storage = {};
  for (const [plural,singular] of [['Users','users'],['Tours','tours'],['ApiKeys','keys'],['Audit','audit']]) {
    storage['get'+plural]=async()=>data[singular]; storage['save'+plural]=async x=>{data[singular]=x;};
  }
  const api=createApi({storage,sessions:{get:async t=>t==='admin-session'?'admin-1':null},rateLimit:{isLimited:async()=>false}});
  async function call(method,path,body,headers={}) {
    const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);
    Object.assign(req,{method,url:path,headers:{host:'localhost','x-csrf':'1','cookie':'et_admin=admin-session',...headers},socket:{remoteAddress:'127.0.0.1'}});
    let status,payload; const res={writeHead:s=>status=s,setHeader(){},end:b=>{payload=JSON.parse(b);}};
    await api.handleAPI(req,res,new URL(path,'http://localhost')); return {status,...payload};
  }
  return {data,call};
}

test('API key create: one-time token, stored hash only, scoped access, expiry and revocation',async()=>{
  const f=fixture();
  const created=await f.call('POST','/api/api-keys',{name:'Image agent',expiresAt:new Date(Date.now()+86400000).toISOString(),scopes:['tours.view','tours.edit.image']});
  assert.equal(created.status,201); assert.match(created.token,/^etk_[a-f0-9]{64}$/);
  assert.equal('hash' in created.key,false); assert.equal(f.data.keys.length,1);
  const key=f.data.keys[0]; assert.equal(key.hash,crypto.createHash('sha256').update(created.token).digest('hex'));
  assert.equal((await f.call('GET','/api/api-keys')).keys.length,1);
  const auth={authorization:'Bearer '+created.token,cookie:''};
  assert.equal((await f.call('GET','/api/tours',undefined,auth)).status,200);
  assert.equal((await f.call('PUT','/api/tours/demo',{images:['/img.jpg']},auth)).status,200);
  assert.equal((await f.call('PUT','/api/tours/demo',{price:55},auth)).status,403);
  f.data.users[0].perms=['tours.view'];
  assert.equal((await f.call('PUT','/api/tours/demo',{images:['/denied.jpg']},auth)).status,403);
  f.data.users[0].perms=['tours.view','tours.edit.image'];
  assert.equal((await f.call('GET','/api/users',undefined,auth)).status,403);
  assert.ok(key.lastUsedAt);
  assert.equal((await f.call('DELETE','/api/api-keys/'+key.id,undefined,auth)).status,403);
  assert.equal((await f.call('DELETE','/api/api-keys/'+key.id)).status,200);
  assert.equal((await f.call('GET','/api/tours',undefined,auth)).status,401);
});

test('API key creation rejects expired, overlong, empty-scope and privileged scopes',async()=>{
  const f=fixture();
  for(const body of [
    {name:'bad',expiresAt:new Date(Date.now()-1000).toISOString(),scopes:['tours.view']},
    {name:'bad',expiresAt:new Date(Date.now()+400*86400000).toISOString(),scopes:['tours.view']},
    {name:'bad',expiresAt:new Date(Date.now()+86400000).toISOString(),scopes:[]},
    {name:'bad',expiresAt:new Date(Date.now()+86400000).toISOString(),scopes:['users.manage']},
  ]) assert.equal((await f.call('POST','/api/api-keys',body)).status,400);
});

test('expired keys and disabled owner are rejected',async()=>{
  const f=fixture(); const token='etk_'+crypto.randomBytes(32).toString('hex');
  f.data.keys.push({id:'expired',name:'expired',ownerId:'admin-1',scopes:['tours.view'],expiresAt:new Date(Date.now()-1000).toISOString(),hash:crypto.createHash('sha256').update(token).digest('hex')});
  const auth={authorization:'Bearer '+token,cookie:''}; assert.equal((await f.call('GET','/api/tours',undefined,auth)).status,401);
  f.data.keys[0].expiresAt=new Date(Date.now()+86400000).toISOString(); f.data.users[0].disabled=true;
  assert.equal((await f.call('GET','/api/tours',undefined,auth)).status,401);
});
