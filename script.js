/* Excel Travel 赛尔旅游 — 全站交互 */
(function () {
  'use strict';

  /* ---------- 顶栏滚动状态 ---------- */
  var header = document.querySelector('[data-header]');
  var syncHeader = function () {
    if (header) header.classList.toggle('scrolled', window.scrollY > 24);
  };
  syncHeader();
  window.addEventListener('scroll', syncHeader, { passive: true });

  /* ---------- 移动端菜单 ---------- */
  var menuButton = document.querySelector('.menu-button');
  var mobileNav = document.querySelector('.mobile-nav');
  if (menuButton && mobileNav) {
    var closeMenu = function () {
      mobileNav.classList.remove('open');
      menuButton.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', '打开菜单');
    };
    menuButton.addEventListener('click', function () {
      var open = mobileNav.classList.toggle('open');
      menuButton.classList.toggle('open', open);
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    });
    mobileNav.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mobileNav.classList.contains('open')) {
        closeMenu();
        menuButton.focus();
      }
    });
  }

  /* ---------- 滚动显现 ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && reveals.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- Toast ---------- */
  var toast = document.querySelector('.toast');
  var showToast = function (msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 3200);
  };
  window.ETToast = showToast;

  /* ---------- 订阅表单 ---------- */
  document.querySelectorAll('[data-newsletter]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('input[type="email"]');
      var email = input ? input.value.trim() : '';
      if (!email) {
        showToast(T('请先输入邮箱地址'));
        return;
      }
      form.reset();
      showToast('感谢您的订阅！我们会把最新旅程与优惠寄给您。');
    });
  });

  /* ---------- 联系表单 ---------- */
  var contactForm = document.querySelector('[data-contact-form]');
  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();
      contactForm.reset();
      showToast(T('感谢您的提交！我们会在 1 个工作日内用中文回复您。'));
    });
  }

  /* ---------- 行程数据与渲染 ---------- */
  var TOUR_JSON = 'tours.json';
  var tourCache = null;
  var CATS = ['全部', '南岛团游', '北岛团游', '南北岛团游', '出境游'];
  var T = function(s){ return (window.ETLang && ETLang.lang()==='en') ? ETLang.t(s) : s; };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function loadTours(cb) {
    if (tourCache) { cb(tourCache); return; }
    fetch(TOUR_JSON)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) { tourCache = data; cb(data); })
      .catch(function (err) {
        console.error('tours.json 加载失败', err);
        cb([]);
      });
  }

  /* 行程卡片 */
  window.ETTourCard = function (t) {
    var img = t.images && t.images[0] ? t.images[0] : '';
    var price = t.price ? 'NZ$' + t.price : (window.ETLang ? ETLang.t('价格请咨询') : '价格请咨询');
    return (
      '<a class="tour-card reveal" href="tour.html?slug=' + encodeURIComponent(t.slug) + '">' +
        '<div class="card-media">' +
          (img ? '<img src="' + esc(img) + '" alt="' + esc(t.title) + '" loading="lazy">' : '') +
          '<span class="tour-badge">' + esc(t.cat) + '</span>' +
          '<span class="tour-price-float">' + esc(price) + '</span>' +
        '</div>' +
        '<div class="card-body">' +
          '<h3>' + esc(t.title) + '</h3>' +
          '<p class="card-desc">' + esc(t.desc) + '</p>' +
          '<div class="card-foot">' +
            '<span class="price">' + esc(price) + '</span>' +
            '<span class="go">' + T('查看详情') + ' <span>→</span></span>' +
          '</div>' +
        '</div>' +
      '</a>'
    );
  };

  /* 精选行程：优先 featured 标记，再补足其余 */
  window.ETFeaturedTours = function (el, n) {
    loadTours(function (tours) {
      if (!el) return;
      var pick = tours.filter(function (t) { return t.featured; });
      tours.forEach(function (t) { if (!t.featured && pick.length < n) pick.push(t); });
      el.innerHTML = pick.slice(0, n || 3).map(window.ETTourCard).join('');
      bindReveals(el);
    });
  };

  /* 跟团游筛选列表 */
  window.ETTourGrid = function (el, chipsEl) {
    loadTours(function (tours) {
      if (!el) return;
      var state = '全部';

      function counts() {
        var c = {};
        tours.forEach(function (t) { c[t.cat] = (c[t.cat] || 0) + 1; });
        return c;
      }

      function render() {
        var list = state === '全部' ? tours : tours.filter(function (t) { return t.cat === state; });
        el.innerHTML = list.map(window.ETTourCard).join('') ||
          '<p class="muted center" style="grid-column:1/-1;padding:40px 0">' + T('该分类暂无行程，欢迎联系客服定制。') + '</p>';
        bindReveals(el);
      }

      function renderChips() {
        if (!chipsEl) return;
        var c = counts();
        chipsEl.innerHTML = CATS.map(function (cat) {
          var n = cat === '全部' ? tours.length : (c[cat] || 0);
          return '<button class="chip' + (cat === state ? ' active' : '') + '" data-cat="' + cat + '">' +
            esc(cat) + '<span class="count">' + n + '</span></button>';
        }).join('');
        chipsEl.querySelectorAll('.chip').forEach(function (chip) {
          chip.addEventListener('click', function () {
            state = chip.getAttribute('data-cat');
            renderChips();
            render();
          });
        });
      }

      renderChips();
      render();
    });
  };

  /* 行程详情页 */
  window.ETTourDetail = function (slug) {
    loadTours(function (tours) {
      var t = tours.filter(function (x) { return x.slug === slug; })[0];
      var root = document.getElementById('tour-detail');
      if (!t || !root) {
        if (root) {
          root.innerHTML =
            '<div class="not-found container"><h1>404</h1>' +
            '<p class="muted mt-2">' + T('找不到这条行程，回到') + ' <a class="text-link dark-link" href="group-tours.html">' + T('跟团游页面') + '</a> ' + T('看看其他路线吧。') + '</p></div>';
        }
        return;
      }
      document.title = t.title + '｜Excel Travel 赛尔旅游';
      var imgs = t.images && t.images.length ? t.images : [];
      var gallery = imgs.map(function (u, i) {
        return '<figure class="g-item' + (i === 0 ? ' main' : '') + '">' +
          '<img src="' + esc(u) + '" alt="' + esc(t.title) + ' ' + (i + 1) + '" loading="lazy"></figure>';
      }).join('');
      root.innerHTML =
        '<div class="container section-pad">' +
          '<div class="crumb"><a href="index.html">首页</a><span>/</span><a href="group-tours.html">跟团游</a><span>/</span>' + esc(t.cat) + '</div>' +
          '<div class="tour-detail-head">' +
            '<span class="tour-badge">' + esc(t.cat) + '</span>' +
            '<h1>' + esc(t.title) + '</h1>' +
            '<div class="tour-detail-price">' +
              '<span class="price-big">NZ$' + esc(t.price || '——') + '</span><small>' + T('起 / 每人') + '</small>' +
            '</div>' +
            '<p class="tour-detail-desc">' + esc(t.desc) + '</p>' +
            '<div class="hero-actions">' +
              '<a class="button button-orange" href="' + esc(t.url) + '" target="_blank" rel="noopener">' + T('立即预订') + ' <span>↗</span></a>' +
              '<a class="button button-ghost" href="contact.html">' + T('咨询客服') + ' <span>→</span></a>' +
            '</div>' +
          '</div>' +
          (gallery ? '<div class="gallery mt-4">' + gallery + '</div>' : '') +
          '<div class="tour-detail-extra mt-4">' +
            '<div class="step-card"><h3>' + T('为什么选择我们') + '</h3><p>当地中文服务团队，资质齐全（Qualmark / TAANZ / IATA），行程真实可查。</p></div>' +
            '<div class="step-card"><h3>' + T('如何预订') + '</h3><p>点击「立即预订」前往官网查看出发日期，或联系我们微信客服为您安排。</p></div>' +
            '<div class="step-card"><h3>' + T('出发信息') + '</h3><p>价格仅供参考，实际以官网实时价格与成团情况为准。</p></div>' +
          '</div>' +
        '</div>';
      bindReveals(root);
      window.scrollTo(0, 0);
    });
  };

  /* 重新绑定新渲染的 reveal */
  function bindReveals(scope) {
    var els = scope.querySelectorAll ? scope.querySelectorAll('.reveal:not(.in)') : [];
    if ('IntersectionObserver' in window && els.length) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, { threshold: 0.1 });
      els.forEach(function (el) { io.observe(el); });
    } else {
      els.forEach(function (el) { el.classList.add('in'); });
    }
  }

  /* 当前页高亮 */
  var path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.desktop-nav a, .mobile-nav a').forEach(function (a) {
    var href = a.getAttribute('href');
    if (href && href.split('#')[0] === path) a.classList.add('active');
  });

  /* 自动初始化数据组件 */
  var featuredEl = document.querySelector('[data-featured-tours]');
  if (featuredEl) window.ETFeaturedTours(featuredEl, 6);
  var gridEl = document.querySelector('[data-tour-grid]');
  var chipsEl = document.querySelector('[data-tour-chips]');
  if (gridEl) window.ETTourGrid(gridEl, chipsEl);

  var params = new URLSearchParams(location.search);
  var slug = params.get('slug');
  if (slug) window.ETTourDetail(slug);

  /* AI chat chips: open the official ChatGPT consultant */
  var GPT_URL = 'https://chatgpt.com/g/g-8PheYK33c-new-zealand-travel-consultant';
  document.querySelectorAll('[data-chat-chip]').forEach(function(btn){
    btn.addEventListener('click', function(){ window.open(GPT_URL, '_blank', 'noopener'); });
  });
})();
