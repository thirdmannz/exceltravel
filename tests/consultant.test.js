'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'ai-travel-consultant.html'),'utf8');
test('consultant preserves original six services and the official GPT destination',()=>{
  for(const title of ['个性化旅行推荐','全方位行程详情','目的地深入探索','一键快速预订','团体政策解答','更多公司服务']) assert.ok(html.includes('<h3>'+title+'</h3>'),title);
  assert.equal((html.match(/<h1>/g)||[]).length,1);
  assert.equal((html.match(/href="https:\/\/chatgpt.com\/g\/g-8PheYK33c-excel-travel-consultant"/g)||[]).length,5);
  assert.ok(!html.includes('href="https://www.exceltravel.nz/ai-travel-consultant" target='));
  assert.ok(html.includes('class="ai-chat-input"'));
  assert.ok(html.includes('href="contact.html">联系人工客服'));
});
