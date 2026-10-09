/* Excel Travel — inquiry chat widget (Netlify free: Blobs + /api/inquiries). */
(function () {
  'use strict';
  if (window.__etChatWidget) return;
  window.__etChatWidget = true;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // 走 i18n 字典；i18n.js 未載入或未翻譯時原樣回傳中文。
  function T(s) { return (window.ETLang && ETLang.t) ? ETLang.t(s) : s; }
  function esc2(s) { return esc(T(s)); }

  function createEl() {
    var wrap = document.createElement('div');
    wrap.id = 'et-chat-widget';
    wrap.innerHTML =
      '<button type="button" class="et-chat-fab" aria-label="' + esc(T('聯絡我們')) + '" aria-expanded="false">' +
      '  <span class="et-chat-fab-icon" aria-hidden="true">💬</span>' +
      '  <span class="et-chat-fab-label">' + esc(T('留言')) + '</span>' +
      '</button>' +
      '<div class="et-chat-panel" hidden role="dialog" aria-label="' + esc(T('聯絡我們')) + '">' +
      '  <div class="et-chat-head">' +
      '    <div><strong data-chat-title>' + esc(T('聯絡 Excel Travel')) + '</strong><div class="et-chat-sub" data-chat-status>' + esc(T('我們會盡快回覆')) + '</div></div>' +
      '    <button type="button" class="et-chat-close" aria-label="' + esc(T('關閉')) + '">×</button>' +
      '  </div>' +
      '  <div class="et-chat-welcome" data-chat-welcome></div>' +
      '  <div class="et-chat-contacts" data-chat-contacts hidden></div>' +
      '  <form class="et-chat-form" novalidate>' +
      '    <label>' + esc(T('姓名')) + '<span aria-hidden="true">*</span><input name="name" autocomplete="name" required maxlength="80" placeholder="' + esc(T('例如：王小明')) + '"></label>' +
      '    <label>' + esc(T('邮箱')) + '<span aria-hidden="true">*</span><input name="email" type="email" autocomplete="email" required maxlength="120" placeholder="you@example.com"></label>' +
      '    <label>' + esc(T('電話')) + '<input name="phone" autocomplete="tel" maxlength="30" placeholder="' + esc(T('選填')) + '"></label>' +
      '    <label>' + esc(T('感兴趣的服务')) + '<select name="interest"><option value="">' + esc(T('一般咨询')) + '</option><option value="group-tours">' + esc(T('跟团游')) + '</option><option value="independent-travel">' + esc(T('自由行')) + '</option><option value="study-tours">' + esc(T('游学服务')) + '</option><option value="cruise">' + esc(T('游轮行')) + '</option><option value="flights-visa">' + esc(T('机票签证')) + '</option><option value="other">' + esc(T('其他 / 尚未决定')) + '</option></select></label>' +
      '    <label data-chat-tour hidden>' + esc(T('请选择行程')) + '<select name="tourId"><option value="">' + esc(T('未选择行程')) + '</option></select></label>' +
      '    <label>' + esc(T('留言')) + '<span aria-hidden="true">*</span><textarea name="message" required maxlength="2000" rows="4" placeholder="' + esc(T('想去哪裡？人數 / 日期 / 預算…')) + '"></textarea></label>' +
      '    <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px;opacity:0" aria-hidden="true">' +
      '    <div class="et-chat-actions"><button type="submit" class="et-chat-submit">' + esc(T('送出留言')) + '</button></div>' +
      '    <p class="et-chat-hint" aria-live="polite"></p>' +
      '  </form>' +
      '</div>';
    return wrap;
  }

  function init() {
    var host = createEl();
    document.body.appendChild(host);
    var fab = host.querySelector('.et-chat-fab');
    var panel = host.querySelector('.et-chat-panel');
    var closeBtn = host.querySelector('.et-chat-close');
    var form = host.querySelector('.et-chat-form');
    var hint = host.querySelector('.et-chat-hint');
    var submitBtn = host.querySelector('.et-chat-submit');
    var interestSelect = form.elements.interest;
    var tourSelect = form.elements.tourId;
    var tourField = host.querySelector('[data-chat-tour]');
    var preInterest = location.pathname.split('/').pop().replace('.html', '');
    if (['group-tours', 'independent-travel', 'study-tours', 'cruise', 'flights-visa'].indexOf(preInterest) !== -1) interestSelect.value = preInterest;
    function updateTours() { tourField.hidden = interestSelect.value !== 'group-tours'; if (tourField.hidden) tourSelect.value = ''; }
    interestSelect.addEventListener('change', updateTours);
    updateTours();
    fetch('/api/public-tours', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('unavailable'); return r.json(); }).then(function (data) {
      var lang = window.ETLang && ETLang.lang ? ETLang.lang() : 'zh';
      tourSelect.innerHTML = '<option value="">' + esc(T('未选择行程')) + '</option>' + (data.tours || []).map(function (tour) {
        var title = tour.i18n && tour.i18n[lang] && tour.i18n[lang].title || tour.title;
        return '<option value="' + esc(tour.slug) + '">' + esc(title) + '</option>';
      }).join('');
      var slug = new URLSearchParams(location.search).get('slug') || document.body.getAttribute('data-tour-id');
      if (!slug) { var match = /\/tours\/([^/]+)\.html$/.exec(location.pathname); if (match) { var selected = (data.tours || []).filter(function (t) { return t.slugEn === match[1] || t.slug === decodeURIComponent(match[1]); })[0]; slug = selected && selected.slug; } }
      if (slug && (data.tours || []).some(function (t) { return t.slug === slug; })) { interestSelect.value = 'group-tours'; tourSelect.value = slug; updateTours(); }
    }).catch(function () { tourSelect.disabled = true; });
    applyChatSettings({ title: '聯絡 Excel Travel', status: '我們會盡快回覆', welcome: '嗨！歡迎留言告訴我們你的旅遊計畫。' });

    var settingsLoaded = false;
    function applyChatSettings(settings) {
      settings = settings || {};
      var title = host.querySelector('[data-chat-title]');
      var status = host.querySelector('[data-chat-status]');
      var welcome = host.querySelector('[data-chat-welcome]');
      var contacts = host.querySelector('[data-chat-contacts]');
      // 後台設定的文案同樣是中文原文，需一併過字典；管理員自訂且字典無對應者原樣顯示。
      if (title) title.textContent = T(settings.title || '聯絡 Excel Travel');
      if (status) status.textContent = T(settings.status || '我們會盡快回覆');
      if (welcome) welcome.textContent = T(settings.welcome || '嗨！歡迎留言告訴我們你的旅遊計畫。');
      var lines = [];
      if (settings.wechat) lines.push('<span><b>WeChat</b> ' + esc(settings.wechat) + '</span>');
      if (settings.kakaotalk) lines.push('<span><b>KakaoTalk</b> ' + esc(settings.kakaotalk) + '</span>');
      if (contacts) { contacts.innerHTML = lines.join(''); contacts.hidden = !lines.length; }
    }
    function loadChatSettings() {
      if (settingsLoaded) return Promise.resolve();
      return fetch('/api/chat-settings', { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (d) { applyChatSettings(d.settings); settingsLoaded = true; })
        .catch(function () { settingsLoaded = true; });
    }
    function open() {
      panel.hidden = false;
      loadChatSettings();
      requestAnimationFrame(function () { panel.classList.add('is-open'); });
      fab.setAttribute('aria-expanded', 'true');
      var first = form.querySelector('input[name="name"]');
      if (first) first.focus();
    }
    function close() {
      panel.classList.remove('is-open');
      fab.setAttribute('aria-expanded', 'false');
      setTimeout(function () { panel.hidden = true; }, 180);
    }

    fab.addEventListener('click', function () {
      if (panel.hidden) open(); else close();
    });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) close(); });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      hint.textContent = '';
      hint.className = 'et-chat-hint';
      var fd = new FormData(form);
      var payload = {
        name: String(fd.get('name') || '').trim(),
        email: String(fd.get('email') || '').trim(),
        phone: String(fd.get('phone') || '').trim(),
        message: String(fd.get('message') || '').trim(),
        website: String(fd.get('website') || '').trim(),
        page: location.pathname + location.search,
      };
      payload.interest = String(fd.get('interest') || '');
      payload.tourId = payload.interest === 'group-tours' ? String(fd.get('tourId') || '') : '';

      if (!payload.name || !payload.email || !payload.message) {
        hint.textContent = T('請填寫姓名、Email 與留言內容。');
        hint.classList.add('is-error');
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email)) {
        hint.textContent = T('Email 格式不正確。');
        hint.classList.add('is-error');
        return;
      }
      if (payload.message.length < 5) {
        hint.textContent = T('留言內容太短，請多寫一點。');
        hint.classList.add('is-error');
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = T('送出中…');
      try {
        var res = await fetch('/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf': '1' },
          body: JSON.stringify(payload),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(data.error || T('提交失敗，請稍後再試'));
        hint.textContent = T('已送出！我們會盡快 Email 回覆你。');
        hint.classList.add('is-ok');
        form.reset();
        updateTours();
        setTimeout(close, 1600);
      } catch (err) {
        hint.textContent = err.message || T('提交失敗，請稍後再試');
        hint.classList.add('is-error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = T('送出留言');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
