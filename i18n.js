/* Excel Travel bilingual UI. One shared layer keeps every page in sync. */
(function () {
  'use strict';
  var KEY = 'exceltravel-language';
  var translations = { '首页':'Home' ,'跟团游':'Group Tours' ,'自由行':'Independent Travel' ,'游学服务':'Study Tours' ,'游轮行':'Cruises' ,'机票签证':'Flights & Visas' ,'关于我们':'About Us' ,'联系我们':'Contact Us' ,'AI 旅行顾问':'AI Travel Consultant' ,'中文服务 · 新西兰当地团队 · EST. 2003 AUCKLAND':'Chinese service · Local New Zealand team · EST. 2003 AUCKLAND' ,'赛尔旅游 · 新西兰':'Excel Travel · New Zealand' ,'跳到主要内容':'Skip to main content' ,'主要导航':'Main navigation' ,'订阅':'Subscribe' ,'你的邮箱':'Your email' ,'发送':'Send' ,'提交':'Submit' ,'了解更多':'Learn more' ,'查看全部行程':'View all tours' ,'立即咨询':'Contact us' ,'一键预订':'Book now' ,'下一站，等你决定':'Your next stop is up to you' ,'专业的团队':'A professional team' ,'一站式服务':'One-stop service' ,'酒店预订':'Hotel booking' ,'门票预订':'Ticket booking' ,'销售顾问':'Travel consultant' ,'姓名':'Name' ,'邮箱':'Email' ,'电话':'Phone' ,'留言':'Message' ,'发送留言':'Send message' ,'行程详情':'Tour details' ,'价格请咨询':'Price on request' ,'天':' days' ,'人起':' people' ,'年':' years' ,'全部':'All' ,'查看详情':'View details' ,'立即预订':'Book now' ,'咨询客服':'Contact us' ,'为什么选择我们':'Why choose us' ,'如何预订':'How to book' ,'出发信息':'Departure info' ,'起 / 每人':'from / per person' ,'该分类暂无行程，欢迎联系客服定制。':'No tours in this category yet — contact us for a custom trip.' ,'找不到这条行程，回到':'Tour not found. Back to' ,'跟团游页面':'the group tours page' ,'看看其他路线吧。':'to browse other routes.' ,'感谢您的提交！我们会在 1 个工作日内用中文回复您。':'Thank you! We will reply within 1 business day.' ,'已订阅，感谢！':'Subscribed, thank you!' ,'关于我们｜Excel Travel 赛尔旅游':'About Us | Excel Travel' ,'行程详情｜Excel Travel 赛尔旅游':'Tour Details | Excel Travel' ,'AI 旅行顾问｜Excel Travel 赛尔旅游':'AI Travel Consultant | Excel Travel' ,'联系我们｜Excel Travel 赛尔旅游':'Contact | Excel Travel' ,'跟团游｜Excel Travel 赛尔旅游':'Group Tours | Excel Travel' ,'自由行｜Excel Travel 赛尔旅游':'Independent Travel | Excel Travel' ,'游学服务｜Excel Travel 赛尔旅游':'Study Tours | Excel Travel' ,'游轮行｜Excel Travel 赛尔旅游':'Cruises | Excel Travel' ,'机票签证｜Excel Travel 赛尔旅游':'Flights & Visas | Excel Travel' ,'Excel Travel 赛尔旅游｜把新西兰，走成你的故事':'Excel Travel | Turn New Zealand into your story','Excel Travel 赛尔旅游：探索新西兰，发现适合你的团游、自由行、游学与定制旅程。本地团队 · 中文服务 · 始于 2003。':'Excel Travel: explore New Zealand with group tours, independent travel, study tours and custom journeys. Local team, Chinese service, since 2003.','新西兰跟团游：南岛、北岛、南北岛精品团，中文导游，8人成团。':'New Zealand group tours: South Island, North Island and combined itineraries with Mandarin-speaking guides.','新西兰自由行定制：机票、酒店、行程规划一站式安排，中文服务。':'Independent travel in New Zealand: flights, hotels and itinerary planning with Chinese service.','新西兰游学服务：冬夏令营、微留学、插班体验，本地学校资源与支持。':'Study tours in New Zealand: camps, micro-study and school immersion programmes with local support.','新西兰游轮行：澳新航线、峡湾巡游，港口接送与中文服务。':'Cruises from New Zealand: Australia-New Zealand routes and fjord cruises with port transfers.','新西兰机票与签证：特价机票、签证申请协助，本地团队一站式服务。':'Flights and visas for New Zealand: airfares and visa assistance from a local team.','关于赛尔旅游 Excel Travel：始于 2003 年的奥克兰华人旅行社，Qualmark / TAANZ / IATA 资质。':'About Excel Travel: an Auckland-based Chinese travel agency since 2003 with Qualmark, TAANZ and IATA credentials.','联系赛尔旅游：奥克兰总部 220 Queen Street，电话 09-366-6889，微信 ExcelTravel，中文客服。':'Contact Excel Travel: 220 Queen Street, Auckland; phone 09-366-6889; WeChat ExcelTravel.','AI 旅行顾问：在线智能行程助手，快速生成新西兰旅行方案。':'AI Travel Consultant: an online assistant that quickly builds New Zealand itineraries.','Excel Travel 行程详情：查看新西兰团游、自由行路线的详细安排与价格。':'Excel Travel tour details: itineraries and pricing for New Zealand tours.' ,'输入你的问题…':'Ask about our tours…' ,'发送':'Send' ,'数据来源：本站 18 条真实行程':'Powered by 18 real tours from this site' };
  function lang(){ return localStorage.getItem(KEY) || 'zh'; }
  function textFor(s){
    if (!s) return s;
    if (translations[s]) return translations[s];
    for (var k in translations) if (s.indexOf(k) === 0 && s.length > k.length) return translations[k] + s.slice(k.length);
    return s;
  }
  function translate(root, to) {
    root.querySelectorAll('[data-i18n]').forEach(function(el){ var key=el.getAttribute('data-i18n'); el.textContent=to==='en'?(translations[key]||key):key; });
    root.querySelectorAll('input[placeholder],textarea[placeholder]').forEach(function(el){ if(to==='en') el.setAttribute('placeholder', textFor(el.getAttribute('placeholder'))); });
    var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:function(n){ if(!n.parentElement.closest('script,style')) return NodeFilter.FILTER_ACCEPT; return NodeFilter.FILTER_REJECT; }});
    var nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function(n){ if(!n.parentElement.closest('script,style')) { var v=n.nodeValue.trim(); if(to==='en'&&v&&translations[v]) n.nodeValue=n.nodeValue.replace(v,translations[v]); }});
    var tt=document.querySelector('title'); if(tt){ var tk=tt.textContent.trim(); tt.textContent=to==='en'?(translations[tk]||tk):tk; }
    document.querySelectorAll('meta[name=description]').forEach(function(m){ var dk=m.getAttribute('content').trim(); if(to==='en') m.setAttribute('content', textFor(dk)); });
    var tt=document.querySelector('title'); if(tt){ var tk=tt.textContent.trim(); tt.textContent=to==='en'?(translations[tk]||tk):tk; }
    var tt=document.querySelector('title'); if(tt){ var tk=tt.textContent.trim(); tt.textContent=to==='en'?(translations[tk]||tk):tk; }
    var tt=document.querySelector('title'); if(tt){ var tk=tt.textContent.trim(); tt.textContent=to==='en'?(translations[tk]||tk):tk; }
    document.documentElement.lang=to==='en'?'en':'zh-CN';
    document.querySelectorAll('[data-language-toggle]').forEach(function(b){b.textContent=to==='en'?'中文':'EN';b.setAttribute('aria-label',to==='en'?'切回中文':'Switch to English');});
  }
  function set(to){ localStorage.setItem(KEY,to); location.reload(); }
  window.ETLang={ lang:lang, set:set, t:textFor, translate:translate };
  document.addEventListener('DOMContentLoaded',function(){
    document.querySelectorAll('a.language').forEach(function(a){ var b=document.createElement('button');b.type='button';b.className=a.className;b.setAttribute('data-language-toggle','');b.textContent=lang()==='en'?'中文':'EN';a.replaceWith(b);b.addEventListener('click',function(){ETLang.set(lang()==='en'?'zh':'en');}); });
    translate(document,lang());
  });
})();
