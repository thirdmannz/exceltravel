/* Excel Travel AI chat — answers from the site's own tours.json data.
   No external API: a small deterministic keyword engine over the 18 real tours. */
(function () {
  'use strict';

  var GPT_URL = 'https://chatgpt.com/g/g-8PheYK33c-new-zealand-travel-consultant';
  var STOP = ['请', '请问', '你', '我', '想', '要', '去', '有', '吗', '呢', '的', '了', '什么', '推荐', '一下', '谢谢', '可以', '怎么', '怎样', '如何', '帮', '介绍', '看看', '麻烦', '大概', '知道', '告诉', '一个', '一些'];
  var tours = [];
  var listEl = null;

  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }
  function has(hay, needle) { return norm(hay).indexOf(norm(needle)) !== -1; }

  function T(s) {
    if (window.ETLang && ETLang.t) return ETLang.t(s);
    return s;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function price(t) {
    var p = String(t.price || '').replace(/[^\d.]/g, '');
    return p ? 'NZ$' + p : '价格请咨询';
  }

  function extractDays(title) {
    var m = String(title).match(/(\d+)[日天]|(\d+)\s*day/i);
    return m ? (m[1] || m[2]) : '';
  }

  function cardHtml(t) {
    var img = (t.images && t.images[0]) || '';
    var days = extractDays(t.title);
    return '<a class="tour-mini" href="' + esc(t.url) + '" target="_blank" rel="noopener">' +
      (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '') +
      '<span class="tour-mini-info">' +
        '<span class="tour-mini-title">' + esc(t.title) + '</span>' +
        '<span class="tour-mini-meta"><span class="tour-mini-cat">' + esc(t.cat) + '</span>' +
        (days ? '<span>约' + esc(days) + '日</span>' : '') +
        '<span class="tour-mini-price">' + esc(price(t)) + '</span></span>' +
      '</span>' +
      '<span class="tour-mini-go" aria-hidden="true">↗</span>' +
    '</a>';
  }

  function toursHtml(list) {
    return list.map(cardHtml).join('');
  }

  function addMsg(html, who) {
    var d = document.createElement('div');
    d.className = 'msg ' + (who === 'user' ? 'msg-user' : 'msg-bot');
    d.innerHTML = html;
    listEl.appendChild(d);
    listEl.scrollTop = listEl.scrollHeight;
  }

  function typingThen(fn) {
    var d = document.createElement('div');
    d.className = 'msg msg-bot msg-typing';
    d.textContent = '…';
    listEl.appendChild(d);
    listEl.scrollTop = listEl.scrollHeight;
    setTimeout(function () {
      if (d.parentNode) d.parentNode.removeChild(d);
      fn();
    }, 400);
  }

  function featured() {
    var f = tours.filter(function (t) { return t.featured; });
    return (f.length ? f : tours).slice(0, 3);
  }

  function regionOf(q) {
    if (has(q, '南北岛') || (has(q, '南岛') && has(q, '北岛'))) return '南北岛';
    if (has(q, '南岛')) return '南岛';
    if (has(q, '北岛')) return '北岛';
    if (has(q, '出境') || has(q, '中国') || has(q, '国内')) return '出境';
    return '';
  }

  function matchTours(q) {
    var words = norm(q).split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
    var scored = tours.map(function (t) {
      var hay = norm((t.cat + ' ' + t.title + ' ' + (t.desc || '')));
      var score = 0;
      words.forEach(function (w) {
        if (w.length < 2 && !/[a-z]/i.test(w)) return;
        if (has(t.title, w)) score += 3;
        if (has(t.cat, w)) score += 2;
        if (has(t.desc, w)) score += 1;
      });
      if (has(t.title, q)) score += 6;
      return { t: t, score: score };
    });
    return scored.filter(function (s) { return s.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 3)
      .map(function (s) { return s.t; });
  }

  function replyTours(lead, list) {
    return '<p>' + esc(lead) + '</p>' + toursHtml(list) +
      '<p class="msg-foot">' + T('数据来源：本站 18 条真实行程') + '</p>';
  }

  function seasonReply(q) {
    if (has(q, '8月') || has(q, '7月') || has(q, '6月') || has(q, '冬') || has(q, 'winter')) {
      var picks = tours.filter(function (t) {
        return has(t.title, '观鲸') || has(t.title, '冰川') || has(t.title, '温泉') || has(t.title, '怀托摩') || has(t.title, 'Waitomo');
      }).slice(0, 3);
      return replyTours('6–8 月是新西兰的冬天：观鲸、冰川、温泉和北岛洞穴都是好选择。为你找到这些：', picks.length ? picks : featured());
    }
    if (has(q, '12月') || has(q, '1月') || has(q, '2月') || has(q, '夏') || has(q, 'summer')) {
      return replyTours('12–2 月是新西兰的夏天，适合中线美食、环岛和南北岛连玩。为你找到这些：', featured());
    }
    return replyTours('新西兰四季玩法不太一样：冬天（6–8月）适合观鲸、冰川温泉；夏天（12–2月）适合环岛和美食团。热门行程参考：', featured());
  }

  function fallback() {
    return '<p>这个问题我还没学会 😅 但我可以帮你从 18 条真实行程里查：</p>' +
      '<p class="msg-list">• 南岛有什么团？<br>• 冰川温泉多少钱？<br>• 北岛推荐行程</p>' +
      '<p>更复杂的问题，点下面的「在 ChatGPT 开启对话」问官方顾问。</p>';
  }

  function answer(q) {
    var region = regionOf(q);
    var priceQ = /价格|价钱|多少钱|费用|budget|price/i.test(q);
    var recQ = /推荐|有什么|路线|行程|tour|suggest|recommend|show|list/i.test(q);
    var greetQ = /^(你好|嗨|hello|hi|您好|早上好|下午好|晚上好|在吗)/.test(norm(q));
    var studyQ = /游学|夏令营|冬令营|留学|study/i.test(q);
    var cruiseQ = /游轮|邮轮|cruise/i.test(q);
    var flightQ = /机票|签证|flight|visa/i.test(q);

    if (greetQ) {
      return '你好！我是 Excel Travel AI 顾问 🗺️ 已读取本站 18 条真实行程，可以帮你找行程、查价格、看天数。试试直接输入，或点上面的快捷问题～';
    }
    if (studyQ) {
      return '<p>游学（夏令营 / 冬令营 / 学校团）在专门的游学服务页面：<a href="study-tours.html">游学服务 →</a></p><p>行程细节也可以去 ChatGPT 官方顾问咨询。</p>';
    }
    if (cruiseQ) {
      return '<p>游轮行程请看游轮页面：<a href="cruise.html">游轮行 →</a></p><p>具体船期和价格建议问 ChatGPT 官方顾问。</p>';
    }
    if (flightQ) {
      return '<p>机票签证服务请看：<a href="flights-visa.html">机票签证 →</a></p>';
    }
    if (region) {
      var regionTours = tours.filter(function (t) { return has(t.cat, region); }).slice(0, 3);
      if (regionTours.length) {
        return replyTours('「' + region + '」的行程有这些' + (priceQ ? '，价格如下：' : '：'), regionTours);
      }
    }
    var m = matchTours(q);
    if (m.length) {
      return replyTours(priceQ ? '找到这些行程，价格如下：' : '为你找到这些行程：', m);
    }
    if (priceQ) return replyTours('热门行程价格参考：', featured());
    if (/月|季|season|winter|summer|spring|autumn/i.test(q)) return seasonReply(q);
    if (recQ) return replyTours('为你推荐这些热门行程：', featured());
    return fallback();
  }

  function sendQuestion(q) {
    q = String(q || '').trim();
    if (!q) return;
    addMsg(esc(q), 'user');
    typingThen(function () {
      addMsg(answer(q), 'bot');
    });
  }

  function init(panel) {
    if (!panel) return;
    listEl = panel.querySelector('.ai-msglist');
    var chips = panel.querySelectorAll('[data-chat-chip]');
    var form = panel.querySelector('.ai-chat-input');
    var input = panel.querySelector('input');
    if (input) input.placeholder = T('输入你的问题…');

    chips.forEach(function (btn) {
      btn.addEventListener('click', function () {
        sendQuestion(btn.getAttribute('data-q'));
      });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      sendQuestion(input.value);
      input.value = '';
      input.focus();
    });

    addMsg(T('你好！我是 Excel Travel AI 顾问 🗺️') + ' ' + T('数据来源：本站 18 条真实行程') + '。' + T('可以帮你找行程、查价格、看天数，试试下面快捷问题～'), 'bot');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var panel = document.querySelector('.ai-chat-panel');
    if (!panel) return;
    fetch('tours.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        tours = Array.isArray(data) ? data : (data.tours || []);
        init(panel);
      })
      .catch(function () {
        init(panel);
        addMsg('行程数据暂时无法读取 😢 请确认 tours.json 可访问，或点下面的按钮到 ChatGPT 官方顾问咨询。', 'bot');
      });
  });
})();
