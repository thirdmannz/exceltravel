/* Excel Travel — public side of the admin portal */
/* Reads the published deals snapshot + tour price overrides written by /admin/ */
(function () {
  'use strict';

  var LABELS = {
    zh: { eyebrow: '本週促銷 · 限時優惠', title: '限時<em>優惠</em>', go: '查看詳情' },
    en: { eyebrow: 'This Week · Limited Deals', title: 'Limited Time<em> Deals</em>', go: 'View deal' },
    ko: { eyebrow: '이번 주 · 한정 특가', title: '한정<em> 특가</em>', go: '자세히 보기' }
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lang() { return (window.ETLang && ETLang.lang()) || 'zh'; }
  function L(key) { return (LABELS[lang()] || LABELS.zh)[key] || LABELS.zh[key]; }

  /* Tour price overrides set by the admin console — consumed by script.js */
  window.ETPriceOverrides = (function () {
    try { return JSON.parse(localStorage.getItem('etadmin_tourprices') || '{}'); } catch (e) { return {}; }
  })();

  function publishedDeals() {
    try {
      var p = JSON.parse(localStorage.getItem('etadmin_published') || 'null');
      if (p && p.deals && p.deals.length) return p.deals;
    } catch (e) { /* fall through */ }
    return null;
  }

  var SAMPLE = [
    {
      title: '南島冰川溫泉 5 日遊 — 早鳥 -10%',
      category: '南島團游', salePrice: '1,555', originalPrice: '1,729',
      description: '庫克山、瓦納卡湖、福克斯冰川與漢默溫泉。6 人小團，中文導遊。',
      image: 'https://static.wixstatic.com/media/e492a7_8c482de2899b4bfab31f6309b9d1d1a5~mv2_d_5184_3456_s_4_2.jpg/v1/fill/w_800,h_500,al_c,q_85/e492a7_8c482de2899b4bfab31f6309b9d1d1a5~mv2_d_5184_3456_s_4_2.jpg'
    },
    {
      title: '北島火山溫泉 4 日遊 — 兩人同行 9 折',
      category: '北島團游', salePrice: '1,080', originalPrice: '1,200',
      description: '羅托魯瓦地熱、陶波湖、哈比屯與螢火蟲洞。舒適小巴，天天出發。',
      image: 'https://static.wixstatic.com/media/e492a7_9a3c0e7b6a5d4f3e8c2b1a9d7e6f5c4b~mv2.jpg/v1/fill/w_800,h_500,al_c,q_85/e492a7_9a3c0e7b6a5d4f3e8c2b1a9d7e6f5c4b~mv2.jpg'
    },
    {
      title: '南北島全景 10 日遊 — 暑期專案',
      category: '南北島團游', salePrice: '3,999', originalPrice: '4,380',
      description: '一次走遍南北島精華：基督城、皇后鎮、米爾福德峽灣、羅托魯瓦。',
      image: 'https://static.wixstatic.com/media/e492a7_5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c~mv2.jpg/v1/fill/w_800,h_500,al_c,q_85/e492a7_5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c~mv2.jpg'
    }
  ];

  function card(d) {
    var price = 'NZ$' + esc(d.salePrice);
    return '<a class="tour-card reveal" href="#contact">' +
      '<div class="card-media">' +
      (d.image ? '<img src="' + esc(d.image) + '" alt="' + esc(d.title) + '" loading="lazy">' : '') +
      '<span class="tour-badge">' + esc(d.category || 'Promo') + '</span>' +
      '<span class="tour-price-float">' + esc(price) + '</span>' +
      '</div>' +
      '<div class="card-body">' +
      '<h3>' + esc(d.title) + '</h3>' +
      '<p class="card-desc">' + esc(d.description || '') + '</p>' +
      '<div class="card-foot"><span class="price">' +
      (d.originalPrice ? '<s>NZ$' + esc(d.originalPrice) + '</s> ' : '') + '<b>' + esc(price) + '</b></span>' +
      '<span class="go">' + esc(L('go')) + ' <span>→</span></span></div>' +
      '</div></a>';
  }

  function render() {
    var sec = document.getElementById('deals');
    if (!sec) return;
    var deals = publishedDeals() || SAMPLE;
    var grid = sec.querySelector('.deals-grid');
    if (!grid) return;
    var eyebrow = sec.querySelector('.eyebrow');
    var h2 = sec.querySelector('h2');
    if (eyebrow) eyebrow.innerHTML = '<span class="eyebrow-line"></span>' + esc(L('eyebrow'));
    if (h2) h2.innerHTML = L('title');
    grid.innerHTML = deals.map(card).join('');
    if (window.ETReveal && typeof window.ETReveal === 'function') window.ETReveal(grid);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
  window.addEventListener('load', render);
})();
