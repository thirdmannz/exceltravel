/* Excel Travel — public side of the admin portal */
/* Reads published deals from the server API (/api/published).
   When served as a pure static snapshot (no server), shows sample cards. */
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

  var SAMPLE = [
    {
      title: '南島冰川溫泉 5 日遊 — 早鳥 -10%',
      category: '南島團游', salePrice: '1,555', originalPrice: '1,729',
      description: '庫克山、瓦納卡湖、福克斯冰川與漢默溫泉。6 人小團，中文導遊。',
      image: 'https://static.wixstatic.com/media/e492a7_8c482de2899b4bfab31f6309b9d1d1a5~mv2_d_5184_3456_s_4_2.jpg/v1/fill/w_800,h_500,al_c,q_85/e492a7_8c482de2899b4bfab31f6309b9d1d1a5~mv2_d_5184_3456_s_4_2.jpg'
    },
    {
      title: '北島火山溫泉 4 日遊 — 兩人同行 9 折',
      category: '北島團游', salePrice: '1,188', originalPrice: '1,320',
      description: '羅托魯瓦地熱、陶波湖與霍比屯。舒適住宿，含部分餐食。',
      image: 'https://static.wixstatic.com/media/e492a7_63287a37aee549b09ab00260d91655f0~mv2.jpg/v1/fill/w_800,h_500,al_c,q_85/e492a7_63287a37aee549b09ab00260d91655f0~mv2.jpg'
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

  function fetchPublished() {
    return fetch('/api/published', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) return Promise.reject(new Error('HTTP ' + r.status)); return r.json(); })
      .then(function (d) { return (d && Array.isArray(d.published)) ? d.published : []; })
      .catch(function () { return null; });
  }

  function renderWith(deals) {
    var sec = document.getElementById('deals');
    if (!sec) return;
    var grid = sec.querySelector('.deals-grid');
    if (!grid) return;
    if (!deals || !deals.length) { sec.style.display = 'none'; return; }
    sec.style.display = '';
    grid.innerHTML = deals.map(card).join('');
    var eyebrow = sec.querySelector('.eyebrow');
    var h2 = sec.querySelector('h2');
    if (eyebrow) eyebrow.innerHTML = '<span class="eyebrow-line"></span>' + esc(L('eyebrow'));
    if (h2) h2.innerHTML = L('title');
    if (window.initReveal) window.initReveal(grid);
  }

  function render() {
    fetchPublished().then(function (deals) {
      renderWith(deals === null ? SAMPLE : deals);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
  window.addEventListener('load', render);
})();
