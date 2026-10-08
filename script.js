/* Excel Travel 赛尔旅游 — 全站交互 */
(function () {
  'use strict';

  /* 翻譯 helper：定義在最前面，避免 var 提升時序問題（T is not a function） */
  var T = function (s) { return (window.ETLang && ETLang.lang() !== 'zh') ? ETLang.t(s) : s; };

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
      menuButton.setAttribute('aria-label', T('打开菜单'));
    };
    menuButton.addEventListener('click', function () {
      var open = mobileNav.classList.toggle('open');
      menuButton.classList.toggle('open', open);
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.setAttribute('aria-label', open ? T('关闭菜单') : T('打开菜单'));
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

  /* ---------- Auth-aware account links ---------- */
  var accountLinks = document.querySelectorAll('.account-link');
  if (accountLinks.length) {
    fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (response) {
        if (response.status === 401) return null;
        if (!response.ok) throw new Error('Account lookup failed: ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data || !data.user) return;
        accountLinks.forEach(function (link) {
          link.href = 'account.html';
          link.setAttribute('aria-label', T('我的帳戶') + ': ' + (data.user.name || data.user.email));
          link.textContent = '';
          var avatar = data.user.picture;
          if (avatar) {
            var image = document.createElement('img');
            image.className = 'nav-avatar';
            image.src = avatar;
            image.alt = '';
            image.referrerPolicy = 'no-referrer';
            link.appendChild(image);
          }
          var label = document.createElement('span');
          label.textContent = data.user.name || T('我的帳戶');
          link.appendChild(label);
        });
      })
      .catch(function () { /* Keep the signed-out link if auth lookup is unavailable. */ });
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

  /* ---------- 订阅表单（真实送出到 /api/subscribers） ---------- */
  document.querySelectorAll('[data-newsletter]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('input[type="email"]');
      var btn = form.querySelector('button[type="submit"]');
      var email = input ? input.value.trim() : '';
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        showToast(T('请输入有效的邮箱地址'));
        return;
      }
      var original = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; }
      fetch('/api/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf': '1' },
        body: JSON.stringify({ email: email, page: location.pathname + location.search })
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || '订阅失败，请稍后再试'); return d; }); })
        .then(function () {
          form.reset();
          showToast(T('感谢您的订阅！我们会把最新旅程与优惠寄给您。'));
        })
        .catch(function (err) { showToast(err.message || T('订阅失败，请稍后再试')); })
        .finally(function () { if (btn) { btn.disabled = false; btn.innerHTML = original; } });
    });
  });

  /* ---------- 联系表单（真实送出到 /api/inquiries） ---------- */
  var contactForm = document.querySelector('[data-contact-form]');
  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = contactForm.querySelector('button[type="submit"]');
      var fname = (contactForm.querySelector('[name="fname"]') || {}).value || '';
      var lname = (contactForm.querySelector('[name="lname"]') || {}).value || '';
      var email = ((contactForm.querySelector('[name="email"]') || {}).value || '').trim();
      var message = ((contactForm.querySelector('[name="message"]') || {}).value || '').trim();
      var name = (fname + ' ' + lname).trim();
      if (!name || !email || !message) { showToast(T('请填写姓名、邮箱与信息内容')); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showToast(T('邮箱格式不正确')); return; }
      if (message.length < 5) { showToast(T('信息内容太短，请多写一点')); return; }
      var original = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.textContent = T('发送中…'); }
      fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf': '1' },
        body: JSON.stringify({ name: name, email: email, message: message, page: location.pathname + location.search })
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || '提交失败，请稍后再试'); return d; }); })
        .then(function () {
          contactForm.reset();
          showToast(T('感谢您的提交！我们会在 1 个工作日内用中文回复您。'));
        })
        .catch(function (err) { showToast(err.message || T('提交失败，请稍后再试')); })
        .finally(function () { if (btn) { btn.disabled = false; btn.innerHTML = original; } });
    });
  }

  /* ---------- 预订申请（真实送出到 /api/inquiries） ----------
     原本「立即预订」直接外连 Wix service-page；实测 Wix Bookings 已无可用时段，
     因此改由本站收单：booking.html 表单 -> /api/inquiries -> admin 后台。 */
  var bookingForm = document.querySelector('[data-booking-form]');
  if (bookingForm) {
    var tourSelect = bookingForm.querySelector('[data-booking-tours]');
    var params0 = new URLSearchParams(location.search);
    var preSlug = params0.get('slug') || '';

    loadTours(function (tours) {
      if (!tourSelect) return;
      if (!tours.length) {
        tourSelect.innerHTML = '<option value="">' + esc(T('行程加载失败，请直接致电或微信联系我们')) + '</option>';
        return;
      }
      tourSelect.innerHTML = '<option value="">' + esc(T('请选择行程')) + '</option>' +
        tours.map(function (t) {
          var label = T(tourLang(t, 'title')) + (window.ETLang && ETLang.lang() === 'zh' ? '（' + ETPrice(t.price) + '）' : ' · ' + ETPrice(t.price));
          return '<option value="' + esc(t.slug) + '"' + (t.slug === preSlug ? ' selected' : '') + '>' + esc(label) + '</option>';
        }).join('');
    });

    bookingForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = bookingForm.querySelector('button[type="submit"]');
      var val = function (n) { var el = bookingForm.querySelector('[name="' + n + '"]'); return el ? String(el.value).trim() : ''; };
      var slug = val('tourId');
      var date = val('departDate');
      var adults = parseInt(val('adults'), 10) || 0;
      var children = parseInt(val('children'), 10) || 0;
      var room = val('room');
      var name = val('name');
      var phone = val('phone');
      var email = val('email');
      var extra = val('message');

      if (!slug) { showToast(T('请选择行程')); return; }
      if (!date) { showToast(T('请选择出发日期')); return; }
      if (adults < 1) { showToast(T('成人人数至少 1 位')); return; }
      if (!name) { showToast(T('请填写姓名')); return; }
      if (!email) { showToast(T('请填写邮箱地址')); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showToast(T('邮箱格式不正确')); return; }
      if (extra.length < 5) { showToast(T('请多写一点需求，方便我们准确报价')); return; }

      var tour = (tourCache || []).filter(function (x) { return x.slug === slug; })[0];
      var title = tour ? T(tourLang(tour, 'title')) : slug;
      var lines = [
        T('【预订申请】') + title,
        T('出发日期') + '：' + date,
        T('成人') + '：' + adults + T(' 位') + (children ? '，' + T('儿童') + '：' + children + T(' 位') : ''),
        room ? T('房型需求') + '：' + room : '',
        phone ? T('电话 / WhatsApp') + '：' + phone : '',
        T('其他需求') + '：' + extra
      ].filter(Boolean);

      var original = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.textContent = T('提交中…'); }
      fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf': '1' },
        body: JSON.stringify({
          name: name,
          email: email,
          phone: phone,
          message: lines.join('\n'),
          kind: 'booking',
          booking: { departDate: date, adults: adults, children: children, room: room },
          website: val('website'),
          tourId: slug,
          tourTitle: title,
          page: location.pathname + location.search
        })
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || T('提交失败，请稍后再试')); return d; }); })
        .then(function () {
          bookingForm.reset();
          showToast(T('预订申请已收到！中文顾问会在 1 个工作日内确认名额与报价。'));
        })
        .catch(function (err) { showToast(err.message || T('提交失败，请稍后再试')); })
        .finally(function () { if (btn) { btn.disabled = false; btn.innerHTML = original; } });
    });
  }

  /* ---------- 行程数据与渲染 ---------- */
  var tourCache = null;
  var CATS = [];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 多語言行程：依目前語言選取欄位，缺翻譯時回退中文 */
  function tourLang(t, key, idx) {
    if (!t) return '';
    var lang = (window.ETLang && ETLang.lang()) || 'zh';
    var val = '';
    if (lang !== 'zh' && t.i18n && t.i18n[lang]) {
      var p = t.i18n[lang];
      if (Array.isArray(p[key])) val = p[key];
      else val = p[key] != null ? p[key] : '';
      if (val === '' && idx === undefined) {
        // fallback: keep Chinese when translation missing (for scalar)
      }
      if (Array.isArray(p[key]) && (!val || !val.length)) val = t[key] || [];
      else if (!Array.isArray(p[key]) && !val) val = t[key] || '';
    } else {
      val = t[key] != null ? t[key] : '';
    }
    if (idx !== undefined && Array.isArray(val)) return val[idx] || '';
    return val;
  }


  var toursLiveLoaded = false;
  function loadTours(cb) {
    if (tourCache) { cb(tourCache); return; }
    fetch('/api/public-tours', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (payload) {
        CATS = ['全部'].concat((payload.categories || []).filter(function (cat) { return cat && cat !== '全部'; }));
        if (!Array.isArray(payload.tours)) throw new Error('Invalid tour payload');
        toursLiveLoaded = true;
        tourCache = payload.tours;
        cb(tourCache);
      })
      .catch(function (err) {
        console.error('tours.json 加载失败', err);
        cb([]);
      });
  }

  /* 價格格式化：只有純數值才可前綴 NZ$；文字佔位值（如「聯絡確認」）走「價格請諮詢」，
     避免出現「NZ$聯絡確認」這種把中文當價格的輸出。
     中文模式回原文（不走字典，否則中文頁會顯示英文）。 */
  window.ETPrice = function (v) {
    var zh = !window.ETLang || ETLang.lang() === 'zh';
    var onRequest = zh ? '价格请咨询' : ETLang.t('价格请咨询');
    var raw = String(v == null ? '' : v).replace(/[,\s]/g, '');
    return /^\d+(\.\d+)?$/.test(raw) ? 'NZ$' + v : onRequest;
  };

  /* 價目表單格：數值給 NZ$金額，非數值顯示破折號（不顯示「價格請諮詢」以免逐列重複）。 */
  window.ETPriceOrDash = function (v) {
    var raw = String(v == null ? '' : v).replace(/[,\s]/g, '');
    return /^\d+(\.\d+)?$/.test(raw) ? 'NZ$' + v : '—';
  };

  function tourURL(tour){
    if (typeof tour === 'object' && tour.dynamic) return '/tour.html?slug=' + encodeURIComponent(tour.slug) + '&lang=' + ETLang.lang();
    var slug = typeof tour === 'string' ? tour : tour.slug;
    var published = document.documentElement.hasAttribute('data-static-lang') ? ETSlug.publishedSlug({slug:slug,slugEn:tour.slugEn}, ETLang.lang()) : slug;
    return (document.documentElement.hasAttribute('data-static-lang') ? (ETLang.lang() === 'zh' ? '' : '/' + ETLang.lang()) + '/tours/' + ETSlug.slugURL(published) + '.html' : 'tour.html?slug=' + ETSlug.slugURL(published));
  }

  function localPage(file) {
    return document.documentElement.hasAttribute('data-static-lang') ? (ETLang.lang() === 'zh' ? '' : '/' + ETLang.lang()) + '/' + (file === 'index.html' ? '' : file) : file;
  }

  /* 行程卡片 */
  window.ETTourCard = function (t) {
    var img = t.images && t.images[0] ? t.images[0] : (t.fallbackImage || '');
    var price = ETPrice(t.price);
    return (
      '<a class="tour-card reveal" href="' + tourURL(t) + '">' +
        '<div class="card-media">' +
          (img ? '<img src="' + esc(img) + '" alt="' + esc(T(tourLang(t, 'title'))) + '" loading="lazy" decoding="async" width="1600" height="1000">' : '') +
          '<span class="tour-badge">' + esc(T(t.cat)) + '</span>' +
          '<span class="tour-price-float">' + esc(price) + '</span>' +
        '</div>' +
        '<div class="card-body">' +
          '<h3>' + esc(T(tourLang(t, 'title'))) + '</h3>' +
          '<p class="card-desc">' + esc(T(tourLang(t, 'desc'))) + '</p>' +
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
      if (!toursLiveLoaded && !tours.length && document.documentElement.hasAttribute('data-static-lang') && el.querySelector('.tour-card')) return;
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
      if (!toursLiveLoaded && !tours.length && document.documentElement.hasAttribute('data-static-lang') && el.querySelector('.tour-card')) return;
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
            esc(T(cat)) + '<span class="count">' + n + '</span></button>';
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
      var t = tours.filter(function (x) { return x.slug === slug || x.slugEn === slug; })[0];
      var root = document.getElementById('tour-detail');
      // Static snapshots stay readable if the live API is unavailable.
      if (!toursLiveLoaded && !t && root && document.documentElement.hasAttribute('data-static-lang') && root.querySelector('h1')) return;
      if (!t || !root) {
        if (root) {
          root.innerHTML =
            '<div class="not-found container"><h1>404</h1>' +
            '<p class="muted mt-2">' + T('找不到这条行程，回到') + ' <a class="text-link dark-link" href="group-tours.html">' + T('跟团游页面') + '</a> ' + T('看看其他路线吧。') + '</p></div>';
        }
        return;
      }
      document.title = T(tourLang(t, 'title')) + (window.ETLang && ETLang.lang() !== 'zh' ? ' | Excel Travel' : '｜Excel Travel 赛尔旅游');
      if (window.ETSEO) {
        ETSEO.apply(document, ETSEO.build(t, {
          title: T(tourLang(t, 'title')),
          short: T(tourLang(t, 'short')),
          desc: T(tourLang(t, 'desc')),
          lang: (window.ETLang && ETLang.lang()) || 'zh',
          published: !t.dynamic && document.documentElement.hasAttribute('data-static-lang')
        }, 'https://www.exceltravel.nz'));
      }
      var imgs = t.images && t.images.length ? t.images : [];
      var price = ETPrice(t.price);
      var gallery = imgs.map(function (u, i) {
        return '<figure class="g-item' + (i === 0 ? ' main' : '') + '">' +
          '<img src="' + esc(u) + '" alt="' + esc(T(tourLang(t, 'title'))) + ' ' + (i + 1) + '" loading="lazy" decoding="async" width="1600" height="1000"></figure>';
      }).join('');
      root.innerHTML =
        '<div class="container section-pad">' +
          '<div class="crumb"><a href="' + localPage('index.html') + '">' + T('首页') + '</a><span>/</span><a href="' + localPage('group-tours.html') + '">' + T('跟团游') + '</a><span>/</span>' + esc(T(t.cat)) + '</div>' +
          '<div class="tour-detail-head">' +
            '<span class="tour-badge">' + esc(T(t.cat)) + '</span>' +
            '<h1>' + esc(T(tourLang(t, 'title'))) + '</h1>' +
            '<div class="tour-detail-price">' +
              '<span class="price-big">' + esc(price) + '</span><small>' + T('起 / 每人') + '</small>' +
            '</div>' +
            '<p class="tour-detail-desc">' + esc(T(tourLang(t, 'desc'))) + '</p>' +
            '<div class="hero-actions">' +
              '<a class="button button-orange" href="' + (t.dynamic && ETLang.lang() !== 'zh' ? '/' + ETLang.lang() + '/booking.html' : localPage('booking.html')) + '?slug=' + encodeURIComponent(t.slug) + '&lang=' + ETLang.lang() + '">' + T('立即预订') + ' <span>→</span></a>' +
              '<a class="button button-ghost" href="' + localPage('contact.html') + '">' + T('咨询客服') + ' <span>→</span></a>' +
            '</div>' +
          '</div>' +
          (gallery ? '<div class="gallery mt-4">' + gallery + '</div>' : '') +
          (tourLang(t,'highlights') && tourLang(t,'highlights').length ? '<div class="tour-fw mt-4"><h3 class="fw-title">' + T('行程亮点') + '</h3><ul class="fw-list">' + tourLang(t,'highlights').map(function (h) { return '<li>' + esc(T(h)) + '</li>'; }).join('') + '</ul></div>' : '') +
          (tourLang(t,'itin') && tourLang(t,'itin').length ? '<div class="tour-fw mt-4"><h3 class="fw-title">' + T('每日行程') + '</h3><div class="itin-days">' + tourLang(t,'itin').map(function (d) { return '<div class="itin-day"><div class="itin-day-head"><b>' + esc(((T('第') ? T('第') + ' ' : '') + String(d.day) + (T('天') ? ' ' + T('天') : '')).trim()) + '</b><span>' + esc(T(d.title)) + '</span></div><p>' + esc(T(d.desc)) + '</p></div>'; }).join('') + '</div></div>' : '') +
          (tourLang(t,'priceTable') && tourLang(t,'priceTable').length ? '<div class="tour-fw mt-4"><h3 class="fw-title">' + T('价格表') + '</h3><table class="price-table"><thead><tr><th>' + T('项目') + '</th><th>' + T('售价 NZD') + '</th></tr></thead><tbody>' + tourLang(t,'priceTable').map(function (r) { return '<tr><td>' + esc(T(r.label)) + '</td><td>' + esc(ETPriceOrDash(r.price)) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
          (tourLang(t,'departDates') ? '<div class="tour-fw mt-4"><h3 class="fw-title">' + T('出发日期') + '</h3><p>' + esc(T(tourLang(t,'departDates'))) + '</p></div>' : '') +
          (tourLang(t,'include') && tourLang(t,'include').length ? '<div class="tour-fw mt-4"><h3 class="fw-title">' + T('费用包含') + '</h3><ul class="fw-list good">' + tourLang(t,'include').map(function (x) { return '<li>' + esc(T(x)) + '</li>'; }).join('') + '</ul></div>' : '') +
          (tourLang(t,'exclude') && tourLang(t,'exclude').length ? '<div class="tour-fw mt-4"><h3 class="fw-title">' + T('费用不含') + '</h3><ul class="fw-list bad">' + tourLang(t,'exclude').map(function (x) { return '<li>' + esc(T(x)) + '</li>'; }).join('') + '</ul></div>' : '') +
          (tourLang(t,'notes') ? '<div class="tour-fw mt-4"><h3 class="fw-title">' + T('特别提醒') + '</h3><p>' + esc(T(tourLang(t,'notes'))) + '</p></div>' : '') +
          '<div class="tour-detail-extra mt-4">' +
            '<div class="step-card"><h3>' + T('为什么选择我们') + '</h3><p>' + T('当地中文服务团队，资质齐全（Qualmark / TAANZ / IATA），行程真实可查。') + '</p></div>' +
            '<div class="step-card"><h3>' + T('如何预订') + '</h3><p>' + T('点击「立即预订」前往官网查看出发日期，或联系我们微信客服为您安排。') + '</p></div>' +
            '<div class="step-card"><h3>' + T('出发信息') + '</h3><p>' + T('价格仅供参考，实际以官网实时价格与成团情况为准。') + '</p></div>' +
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
  if (!slug && /\/tours\/[^/]+\.html$/.test(location.pathname)) {
    slug = decodeURIComponent(location.pathname.split('/').pop().slice(0, -5));
  }
  if (slug) window.ETTourDetail(slug);

  /* ---------- 首屏多层视差背景 ---------- */
  var plxHero = document.querySelector('[data-parallax-hero]');
  if (plxHero && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var plxLayers = Array.prototype.slice.call(plxHero.querySelectorAll('[data-plx-speed]'));
    var plxH = plxHero.offsetHeight;
    var plxTicking = false;
    function updatePlx() {
      var rect = plxHero.getBoundingClientRect();
      var progress = Math.min(Math.max(-rect.top / plxH, 0), 1);
      for (var i = 0; i < plxLayers.length; i++) {
        var speed = parseFloat(plxLayers[i].getAttribute('data-plx-speed')) || 0;
        plxLayers[i].style.setProperty('--plx-y', (-progress * speed * plxH).toFixed(1) + 'px');
      }
      plxTicking = false;
    }
    function requestPlx() {
      if (!plxTicking) { plxTicking = true; requestAnimationFrame(updatePlx); }
    }
    window.addEventListener('scroll', requestPlx, { passive: true });
    window.addEventListener('resize', function () { plxH = plxHero.offsetHeight; requestPlx(); }, { passive: true });
    updatePlx();
  }
})();

/* ============================================================
   Landing 創意層 — 統計數字 count-up、卡片微傾斜、路線動態數
   ============================================================ */
(function () {
  'use strict';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fineHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;

  /* 統計數字：進場後由 0 數到目標值 */
  var counters = document.querySelectorAll('[data-count]');
  if (counters.length && !reduceMotion && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        io.unobserve(el);
        var target = parseInt(el.getAttribute('data-count'), 10) || 0;
        var start = null;
        function frame(ts) {
          if (start === null) start = ts;
          var p = Math.min((ts - start) / 1400, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(target * eased).toLocaleString('en-US');
          if (p < 1) requestAnimationFrame(frame);
          else el.textContent = target.toLocaleString('en-US');
        }
        requestAnimationFrame(frame);
      });
    }, { threshold: 0.4 });
    counters.forEach(function (c) { io.observe(c); });
  }

  /* 精選路線數：與公開 API 同步（後台新增行程即自動更新） */
  if (document.querySelector('[data-count="17"]')) fetch('/api/public-tours', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (p) {
      var n = Array.isArray(p.tours) ? p.tours.length : 0;
      var el = document.querySelector('[data-count="17"]');
      if (n && el) { el.setAttribute('data-count', String(n)); el.textContent = String(n); }
    })
    .catch(function () { /* 保留靜態 17 兜底 */ });

  /* 行程卡微傾斜：僅滑鼠裝置、尊重 reduced-motion（事件委派，卡片非同步渲染也適用） */
  if (fineHover && !reduceMotion) {
    var lastCard = null;
    document.addEventListener('mousemove', function (e) {
      var card = e.target.closest ? e.target.closest('.tour-card') : null;
      if (lastCard && lastCard !== card) { lastCard.style.transform = ''; lastCard = null; }
      if (!card || !card.matches(':hover')) return;
      lastCard = card;
      var r = card.getBoundingClientRect();
      var dx = (e.clientX - r.left) / r.width - 0.5;
      var dy = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = 'translateY(-6px) perspective(900px) rotateX(' + (-dy * 4).toFixed(2) + 'deg) rotateY(' + (dx * 4).toFixed(2) + 'deg)';
    });
    document.addEventListener('mouseout', function (e) {
      var card = e.target.closest ? e.target.closest('.tour-card') : null;
      if (card) card.style.transform = '';
      lastCard = null;
    });
  }
})();
