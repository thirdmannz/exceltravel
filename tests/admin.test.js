'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../admin/admin.js'),'utf8');
function code(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
test('admin API helper accepts prefix exactly once and returns parsed data',async()=>{
 const paths=[];const ctx={fetch:async p=>{paths.push(p);return {status:200,json:async()=>({subscribers:[{id:'sub1'}]})};}};
 vm.createContext(ctx);vm.runInContext(code('  function api(','  /* ---------------- toast'),ctx);
 assert.equal((await ctx.api('/subscribers')).subscribers[0].id,'sub1');await ctx.api('/api/subscribers');assert.deepEqual(paths,['/api/subscribers','/api/subscribers']);
});
test('subscriber loader renders parsed API response instead of calling json twice',async()=>{
 let rendered=false;const ctx={document:{getElementById:()=>({value:''})},state:{},api:async()=>({subscribers:[{id:'sub1'}]}),renderSubscribers:()=>{rendered=true;},esc:String};vm.createContext(ctx);vm.runInContext(code('  function loadSubscribers()','  function renderSubscribers()'),ctx);ctx.loadSubscribers();await new Promise(r=>setImmediate(r));assert.equal(rendered,true);assert.equal(ctx.state.subscribers[0].id,'sub1');
});
test('CSV prevents spreadsheet formula injection and preserves escaping',()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(code('  function csvCell(','  function exportSubscribers()'),ctx);
 for(const s of ['=1+1','+CMD','@x','-2','  =SUM(1)','\tx'])assert.equal(ctx.csvCell(s),'"\''+s+'"');assert.equal(ctx.csvCell('a,"b"'),'"a,""b"""');
});
test('admin settings and inquiries callers honor the parsed JSON contract',()=>{
 const callers=source.slice(source.indexOf('  function loadChatSettings()'));
 assert.doesNotMatch(callers,/r\.json\(|r\.ok/);
 assert.ok(source.lastIndexOf('})();') > source.indexOf('function loadSubscribers'));
 assert.match(source,/data-manual-kind/);assert.match(source,/revision: row\.revision/);
});
