/* Excel Travel Admin Portal — server-backed operations console */
/* Auth + permissions enforced on the server (see server.js). This file only
   renders the UI and calls the API; it never decides who may do what. */
(function () {
  'use strict';

  var state = { user: null, tours: [], drafts: [], published: [], meta: null, editingId: null, dealImageUrl: '', users: [], rolePreset: 'media', categories: [], inquiries: [], subscribers: [] };

  /* 可擴充語言：未來新增語言只需在此加一筆 {code,label}，tab 與編輯面板自動產生 */
  var LANGUAGES = [{ code: 'zh', label: '中文' }, { code: 'en', label: 'English' }, { code: 'ko', label: '한국어' }];

  /* ---------------- api helper ---------------- */
  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Content-Type': 'application/json', 'X-CSRF': '1' }, opts.headers || {});
    return fetch(path.startsWith('/api/') ? path : '/api' + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (r.status === 401 && !path.startsWith('/auth/')) { showLogin('登入已過期，請重新登入'); throw new Error(data.error || '未登入'); }
          if (r.status === 403) { toast(data.error || '無權限', true); throw new Error(data.error || '無權限'); }
          if (r.status >= 400) { toast(data.error || '錯誤 (' + r.status + ')', true); throw new Error(data.error || '錯誤'); }
          return data;
        });
      });
  }

  /* ---------------- toast ---------------- */
  var toastTimer;
  var totpTimer;
  var resetTotpTimer;
  function toast(msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle('error', !!isError);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3000);
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function has(p) { return state.user && state.user.perms && state.user.perms.indexOf(p) !== -1; }
  function roleLabel(r) { return { admin: '管理員', editor: '內容編輯', media: '圖片管理' }[r] || r; }
  function fmtPrice(n) { return n ? 'NZ$' + Number(n).toLocaleString('en-NZ') : '價格請諮詢'; }
  function fmtTime(iso) { try { return new Date(iso).toLocaleString('zh-TW'); } catch (e) { return iso; } }

  /* ---------------- boot ---------------- */
  function boot() {
    api('/me').then(function (d) {
      state.user = d.user;
      enterApp();
    }).catch(function (e) {
      if (e.message === '未登入') {
        api('/auth/setup-start').then(function (d) {
          showSetup(d);
        }).catch(function () { showLogin(); });
      }
    });
  }

  /* ---------------- auth UI ---------------- */
  function showAuthPanel(name) {
    document.getElementById('auth-screen').hidden = false;
    ['setup-panel', 'login-panel', 'totp-setup-panel'].forEach(function (p) { document.getElementById(p).hidden = (p !== name); });
  }
  /* Step 2 of first-time setup: the secret, a scannable QR for authenticator
     apps, and the live test code. Both entry points (page load and the setup
     form submit) go through here so the QR can never be left out again. */
  /* One renderer serves both places a secret appears: first-time setup and a
     later reset. `prefix` picks the matching secret/live/qr element trio. */
  function renderTotp(prefix, secret, uri, label) {
    document.getElementById(prefix + '-secret').textContent = secret;
    document.getElementById(prefix + '-live').textContent = '…';
    var box = document.getElementById(prefix + '-qr');
    box.innerHTML = '';
    try {
      /* Rendered locally: the secret is never sent to an image service. */
      box.innerHTML = window.ETQR.toSvg(uri || window.ETTOTP.otpauthURI(label, secret), { size: 220, label: '2FA QR code' });
    } catch (err) { /* manual key entry below still works */ }
    return function tick() {
      window.ETTOTP.currentCode(secret).then(function (c) { document.getElementById(prefix + '-live').textContent = c; });
    };
  }
  function showTotpSecret(secret, uri) {
    var tick = renderTotp('totp', secret, uri, 'admin');
    tick();
    clearInterval(totpTimer);
    totpTimer = setInterval(tick, 5000);
  }
  /* A reset is useless if the new secret is only a wall of base32 text: show
     the same QR + live code the first-time setup uses, so it can be scanned. */
  function showResetTotp(email, secret, uri) {
    document.getElementById('totp-dialog-title').textContent = '新的 2FA 密鑰 · ' + email;
    var tick = renderTotp('reset-totp', secret, uri, email);
    tick();
    clearInterval(resetTotpTimer);
    resetTotpTimer = setInterval(tick, 5000);
    document.getElementById('totp-dialog').showModal();
  }
  function showSetup(secretData) {
    showAuthPanel('setup-panel');
    showTotpSecret(secretData.secret, secretData.uri);
  }
  function showLogin(msg) {
    showAuthPanel('login-panel');
    if (msg) { var er = document.getElementById('auth-error'); er.textContent = msg; er.hidden = false; }
  }

  function bindAuth() {
    document.getElementById('setup-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      api('/auth/setup-start').then(function (d) {
        showAuthPanel('totp-setup-panel');
        showTotpSecret(d.secret, d.uri);
        document.getElementById('totp-setup-form').onsubmit = function (e2) {
          e2.preventDefault();
          api('/auth/setup', { method: 'POST', body: { email: f.email.value, password: f.password.value, secret: d.secret, code: document.getElementById('setup-totp').value } })
            .then(function (d2) { state.user = d2.user; enterApp(); })
            .catch(function (e) { var er = document.getElementById('setup-totp-error'); er.textContent = e.message; er.hidden = false; });
        };
      });
    });
    document.getElementById('login-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var button = f.querySelector('button[type="submit"]');
      var error = document.getElementById('auth-error');
      error.hidden = true;
      button.disabled = true;
      button.textContent = '登入中…';
      var body = { email: f.email.value, password: f.password.value };
      if (f.totp.value) body.code = f.totp.value;
      api('/auth/login', { method: 'POST', body: body }).then(function (d) {
        if (d.needTotp) { document.getElementById('totp-field').hidden = false; error.hidden = true; f.totp.focus(); return; }
        state.user = d.user;
        enterApp();
      }).catch(function (err) {
        error.textContent = err.message || '登入失敗，請檢查網路後重試';
        error.hidden = false;
      }).finally(function () {
        button.disabled = false;
        button.textContent = '登入';
      });
    });
    document.getElementById('logout').addEventListener('click', function () {
      api('/auth/logout', { method: 'POST' }).then(function () { location.reload(); });
    });
  }

  /* ---------------- app shell ---------------- */
  function enterApp() {
    document.getElementById('auth-screen').hidden = true;
    document.getElementById('app-screen').hidden = false;
    document.getElementById('user-label').textContent = state.user.email + ' · ' + roleLabel(state.user.role);
    document.querySelectorAll('[data-admin-only]').forEach(function (b) { b.style.display = has('users.manage') ? '' : 'none'; });
    var inqBtn = document.querySelector('[data-view="inquiries"]'); if (inqBtn) inqBtn.style.display = (has('inquiries.view') || has('inquiries.manage') || state.user.role === 'admin') ? '' : 'none';
    var recipientsPanel = document.getElementById('inquiry-recipients-panel'); if (recipientsPanel) recipientsPanel.hidden = !has('inquiries.recipients.manage');
    document.querySelectorAll('[data-audit-only]').forEach(function (b) { b.style.display = has('audit.view') ? '' : 'none'; });
      const keyNav = document.querySelector('[data-api-key-admin]'); if (keyNav) keyNav.hidden = !has('api-keys.manage');
      var keyCreate = document.getElementById('api-key-create'); if (keyCreate) keyCreate.hidden = !has('api-keys.manage');
    var commerceBtn = document.querySelector('[data-view="commerce"]'); commerceBtn.hidden = !has('bookings.view') && !has('memberships.view') && !has('carts.manage') && !has('coupons.manage');
    document.getElementById('staff-cart-form').hidden = !has('carts.manage');
    document.getElementById('coupon-form').hidden = !has('coupons.manage');
    document.getElementById('manual-plan-create').hidden = !has('memberships.manage');
    document.getElementById('manual-member-create').hidden = !has('memberships.manage');
    document.getElementById('tour-create').hidden = !has('tours.create');
    switchView('deals');
    loadMeta();
  }

  function switchView(name) {
    document.querySelectorAll('.side-link').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
    ['deals', 'tours', 'users', 'audit', 'inquiries', 'commerce', 'api-keys'].forEach(function (v) { document.getElementById('view-' + v).hidden = (v !== name); });
    if (name === 'deals') loadDeals();
    if (name === 'tours') loadTours();
    if (name === 'users') loadUsers();
    if (name === 'audit') loadAudit();
    if (name === 'commerce') { loadManual('bookings'); loadManual('plans'); loadManual('members'); loadCartCustomers(); }
    if (name === 'api-keys') loadApiKeys();
    if (name === 'inquiries') { loadChatSettings(); loadInquiryRecipients(); loadInquiries(); loadSubscribers(); }
  }
  document.querySelectorAll('.side-link').forEach(function (b) { b.addEventListener('click', function () { switchView(b.dataset.view); }); });
    var csf = document.getElementById('chat-settings-form'); if (csf) csf.addEventListener('submit', saveChatSettings);
    var irf = document.getElementById('inquiry-recipients-form'); if (irf) irf.addEventListener('submit', saveInquiryRecipients);
    var inf = document.getElementById('inquiry-filter'); if (inf) inf.addEventListener('change', loadInquiries);
    var inr = document.getElementById('inquiry-refresh'); if (inr) inr.addEventListener('click', loadInquiries);
    var suf = document.getElementById('subscriber-filter'); if (suf) suf.addEventListener('change', loadSubscribers);
    var sur = document.getElementById('subscriber-refresh'); if (sur) sur.addEventListener('click', loadSubscribers);
    var sue = document.getElementById('subscriber-export'); if (sue) sue.addEventListener('click', exportSubscribers);
    var apiKeyForm = document.getElementById('api-key-create'); if (apiKeyForm) apiKeyForm.addEventListener('submit', createApiKey);
  document.querySelectorAll('[data-close-dialog]').forEach(function (b) { b.addEventListener('click', function () { var d = b.closest('dialog'); if (d) d.close(); }); });
  var totpDialog = document.getElementById('totp-dialog');
  if (totpDialog) totpDialog.addEventListener('close', function () { clearInterval(resetTotpTimer); });

  function loadMeta() {
    return api('/meta').then(function (d) { state.meta = d; }).catch(function () {});
  }

  /* ---------------- API keys ---------------- */
  function loadApiKeys() {
    api('/api-keys').then(function (d) {
      var box=document.getElementById('api-key-list');
      if (!d.keys.length) { box.textContent='尚無 API 金鑰'; return; }
      box.innerHTML='<table class="records-table"><thead><tr><th>名稱</th><th>權限</th><th>到期時間</th><th>最後使用</th><th>狀態</th><th>操作</th></tr></thead><tbody>'+d.keys.map(function(k){return '<tr><td>'+esc(k.name)+'</td><td>'+esc(k.scopes.join(', '))+'</td><td>'+esc(k.expiresAt)+'</td><td>'+esc(k.lastUsedAt||'尚未使用')+'</td><td>'+((k.revokedAt||Date.parse(k.expiresAt)<=Date.now())?'已失效':'有效')+'</td><td>'+(!k.revokedAt&&Date.parse(k.expiresAt)>Date.now()?'<button class="admin-button" data-revoke-api-key="'+esc(k.id)+'">撤銷</button>':'—')+'</td></tr>';}).join('')+'</tbody></table>';
      box.querySelectorAll('[data-revoke-api-key]').forEach(function(b){b.onclick=function(){if(confirm('確定立即撤銷此 API 金鑰？'))api('/api-keys/'+encodeURIComponent(b.dataset.revokeApiKey),{method:'DELETE'}).then(loadApiKeys);};});
    });
  }
  function createApiKey(ev) {
    ev.preventDefault(); var f=ev.currentTarget; var scopes=[];
    if(f.readTours.checked)scopes.push('tours.view'); if(f.editImages.checked)scopes.push('tours.edit.image');
    api('/api-keys',{method:'POST',body:{name:f.name.value,expiresAt:new Date(f.expiresAt.value).toISOString(),scopes:scopes}}).then(function(d){
      var p=document.getElementById('api-key-once');p.hidden=false;p.textContent='請立即複製並安全保存，此金鑰只顯示一次： '+d.token;f.reset();f.readTours.checked=true;loadApiKeys();
    }).catch(function(e){alert(e.message);});
  }

  /* ---------------- deals ---------------- */
  function loadDeals() {
    api('/deals').then(function (d) {
      state.drafts = d.drafts || [];
      state.published = d.published || [];
      renderDeals();
    });
  }

  function dealCard(d) {
    var actions = '';
    if (has('deals.edit')) actions += '<button class="text-button" data-act="edit" data-id="' + d.id + '">編輯</button>';
    if (d.status === 'published' && has('deals.publish')) actions += '<button class="text-button" data-act="preview" data-id="' + d.id + '">預覽</button><button class="text-button" data-act="unpublish" data-id="' + d.id + '">下架</button>';
    if (d.status === 'draft' && has('deals.publish')) actions += '<button class="text-button" data-act="preview" data-id="' + d.id + '">預覽並發布</button>';
    if (has('deals.delete')) actions += '<button class="text-button" data-act="delete" data-id="' + d.id + '">刪除</button>';
    var img = d.image ? '<img class="deal-thumb" src="' + esc(d.image) + '" alt="">' : '<div class="deal-thumb" style="background:linear-gradient(135deg,#0e3b52,#ef6b2e)"></div>';
    return '<div class="deal-row">' + img +
      '<div class="deal-sub"><div class="deal-title">' + esc(d.title) + '</div>' +
      '<div class="deal-sub">' + esc(d.category || '未分類') + ' · ' + (d.featured ? '⭐ 精選 · ' : '') + '<span class="pill ' + (d.status === 'published' ? 'pub' : '') + '">' + (d.status === 'published' ? '已發布' : '草稿') + '</span></div></div>' +
      '<div class="deal-price"><s>' + fmtPrice(d.originalPrice) + '</s> <b>' + fmtPrice(d.salePrice) + '</b></div>' +
      '<div class="row-actions">' + actions + '</div></div>';
  }

  function renderDeals() {
    var pub = state.published.length, draft = state.drafts.filter(function (d) { return d.status !== 'published'; }).length;
    document.getElementById('deal-stats').innerHTML =
      '<div class="stat"><b>' + state.drafts.length + '</b><span>全部</span></div>' +
      '<div class="stat"><b>' + pub + '</b><span>已發布</span></div>' +
      '<div class="stat"><b>' + draft + '</b><span>草稿</span></div>';
    var list = document.getElementById('deal-list');
    if (!state.drafts.length) { list.innerHTML = '<div class="empty-state">還沒有 promotion deal — 點「＋ 新增 deal」開始。</div>'; return; }
    list.innerHTML = state.drafts.map(dealCard).join('');
  }

  function openDealDialog(d) {
    var f = document.getElementById('deal-form');
    f.reset();
    document.getElementById('dialog-title').textContent = d ? '編輯 deal' : '新增 promotion deal';
    state.editingId = d ? d.id : null;
    state.dealImageUrl = d ? d.image : '';
    if (d) {
      f.elements['title'].value = d.title;
      f.elements['category'].value = d.category || '';
      f.elements['originalPrice'].value = d.originalPrice || '';
      f.elements['salePrice'].value = d.salePrice || '';
      f.elements['description'].value = d.description || '';
      f.elements['featured'].checked = !!d.featured;
    }
    updateDealPreview();
    document.getElementById('deal-dialog').showModal();
  }

  function updateDealPreview() {
    var box = document.getElementById('deal-image-preview');
    if (state.dealImageUrl) { box.innerHTML = '<img src="' + esc(state.dealImageUrl) + '" alt="deal 主圖">'; box.hidden = false; } else { box.hidden = true; box.innerHTML = ''; }
  }

  function cropImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var W = 1200, H = 750; // 16:10 cover
        var c = document.createElement('canvas');
        c.width = W; c.height = H;
        var ctx = c.getContext('2d');
        var scale = Math.max(W / img.width, H / img.height);
        var sw = W / scale, sh = H / scale;
        var sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
        c.toBlob(function (blob) {
          var fr = new FileReader();
          fr.onload = function () { resolve(fr.result); };
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        }, 'image/jpeg', 0.85);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  function bindDealForm() {
    document.getElementById('new-deal').addEventListener('click', function () { if (has('deals.create')) openDealDialog(null); else toast('無權限', true); });
    document.getElementById('deal-image').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      toast('裁切中…');
      cropImage(file).then(function (dataUrl) {
        return api('/upload', { method: 'POST', body: { dataUrl: dataUrl } });
      }).then(function (d) {
        state.dealImageUrl = d.url;
        updateDealPreview();
        toast('圖片已上傳並裁切為 16:10');
      }).catch(function (e) { toast('圖片失敗：' + e.message, true); });
    });
    document.getElementById('deal-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var body = {
        title: f.elements['title'].value, category: f.elements['category'].value,
        originalPrice: Number(f.elements['originalPrice'].value) || null, salePrice: Number(f.elements['salePrice'].value) || null,
        description: f.elements['description'].value, image: state.dealImageUrl, featured: f.elements['featured'].checked
      };
      var req = state.editingId ? api('/deals/' + state.editingId, { method: 'PUT', body: body }) : api('/deals', { method: 'POST', body: body });
      req.then(function () { document.getElementById('deal-dialog').close(); loadDeals(); toast('已儲存'); });
    });
    document.getElementById('publish-deal').addEventListener('click', function () {
      if (!state.previewId) return;
      api('/deals/' + state.previewId + '/publish', { method: 'POST' }).then(function () {
        document.getElementById('preview-dialog').close();
        loadDeals();
        toast('已發布到公開網站 🎉');
      });
    });
    document.getElementById('deal-list').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (!btn) return;
      var id = btn.dataset.id, act = btn.dataset.act;
      var d = state.drafts.find(function (x) { return x.id === id; });
      if (!d) return;
      if (act === 'edit') openDealDialog(d);
      else if (act === 'preview') openPreview(d);
      else if (act === 'unpublish') api('/deals/' + id + '/unpublish', { method: 'POST' }).then(function () { loadDeals(); toast('已下架'); });
      else if (act === 'delete') { if (confirm('確定刪除「' + d.title + '」？')) api('/deals/' + id, { method: 'DELETE' }).then(function () { loadDeals(); toast('已刪除'); }); }
    });
  }

  function openPreview(d) {
    state.previewId = d.id;
    var img = d.image ? '<img class="deal-thumb" src="' + esc(d.image) + '" alt="">' : '<div class="deal-thumb" style="background:linear-gradient(135deg,#0e3b52,#ef6b2e)"></div>';
    document.getElementById('preview-card').innerHTML = '<div class="deal-row">' + img +
      '<div class="deal-sub"><div class="deal-title">' + esc(d.title) + '</div><div class="deal-sub">' + esc(d.category || '未分類') + '</div></div>' +
      '<div class="deal-price"><s>' + fmtPrice(d.originalPrice) + '</s> <b>' + fmtPrice(d.salePrice) + '</b></div></div>' +
      '<p class="admin-muted" style="margin-top:12px">' + esc(d.description) + '</p>';
    document.getElementById('preview-dialog').showModal();
  }

  /* ---------------- tours ---------------- */
  function loadTours() {
    api('/tours').then(function (d) {
      state.tours = d.tours || [];
      renderTours();
    });
    loadCategories();
  }

  function loadCategories() {
    api('/categories').then(function (d) {
      state.categories = d.categories || [];
      fillCatSelect();
    }).catch(function () {});
  }

  function fillCatSelect(current) {
    var sel = document.getElementById('tour-form').elements['cat'];
    if (!sel) return;
    var cats = (state.categories && state.categories.length) ? state.categories.slice() : [];
    if (!cats.length) {
      var seen = {};
      state.tours.forEach(function (t) { if (t.cat && !seen[t.cat]) { seen[t.cat] = 1; cats.push(t.cat); } });
    }
    if (current && cats.indexOf(current) === -1) cats.unshift(current);
    var prev = (current !== undefined) ? current : sel.value;
    sel.innerHTML = '<option value="">選擇分類…</option>' + cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    if (prev) sel.value = prev;
  }

  // 翻譯覆蓋率提示：讓管理員一眼看出缺哪個語言的文案，避免英文/韓文訪客看到中文內容。
  var I18N_FIELDS = ['title', 'short', 'desc', 'highlights', 'priceTable', 'itin', 'include', 'exclude', 'notes'];
  function i18nStats(t) {
    var out = {};
    ['en', 'ko'].forEach(function (code) {
      var p = (t.i18n && t.i18n[code]) || {};
      var missing = I18N_FIELDS.filter(function (k) {
        var base = t[k];
        if (base == null || (Array.isArray(base) && !base.length)) return false;
        var cur = p[k];
        if (cur == null || (Array.isArray(cur) && !cur.length)) return true;
        return /[\u4e00-\u9fff]/.test(JSON.stringify(cur));
      });
      out[code] = { missing: missing, ok: !missing.length };
    });
    return out;
  }
  function i18nBadge(t) {
    var s = i18nStats(t);
    if (s.en.ok && s.ko.ok) return '';
    var parts = [];
    ['en', 'ko'].forEach(function (code) {
      if (s[code].ok) return;
      var lbl = code === 'en' ? 'EN' : 'KO';
      parts.push('<span class="pill warn" title="' + esc(code.toUpperCase() + ' 缺少：' + s[code].missing.join(', ')) + '">' + lbl + ' 缺 ' + s[code].missing.length + '</span>');
    });
    return parts.join(' ');
  }

  function tourRow(t, i) {
    var canPrice = has('tours.edit.price'), canImage = has('tours.edit.image'), canText = has('tours.edit.text');
    var editable = canPrice || canImage || canText;
    var img = (t.images && t.images[0]) ? t.images[0] : '';
    var trBadge = i18nBadge(t);
    var scheduleState = t.visibility === 'hidden' ? '隱藏' : (t.publishAt && Date.parse(t.publishAt) > Date.now() ? '尚未上架' : (t.unpublishAt && Date.parse(t.unpublishAt) <= Date.now() ? '已下架' : (t.bookingDeadline && Date.parse(t.bookingDeadline) <= Date.now() ? '已截止' : '公開中')));
    return '<div class="tour-row" data-slug="' + esc(t.slug) + '">' +
      '<div class="deal-sub" style="min-width:0"><div class="deal-title">' + esc(t.title) + '</div>' +
      '<div class="deal-sub">' + esc(t.cat || '') + ' · ' + scheduleState + ' · <input data-f="featured" type="checkbox" ' + (t.featured ? 'checked' : '') + (canText ? '' : ' disabled') + '> 精選 · ' + (t.itin && t.itin.length ? t.itin.length + ' 天行程' : '') + (trBadge ? ' · ' + trBadge : '') + '</div></div>' +
      '<label class="fld">價格 NZ$<input data-f="price" type="number" min="0" value="' + (t.price != null ? t.price : '') + '" placeholder="請諮詢" ' + (canPrice ? '' : ' disabled') + '></label>' +
      '<label class="fld">主圖<input data-f="img0" type="text" value="' + esc(img) + '" placeholder="/assets/… 或貼 URL" ' + (canImage ? '' : ' disabled') + '>' +
      (canImage ? '<span class="img-line"><button type="button" class="admin-button" data-img-upload>上傳</button><button type="button" class="admin-button danger" data-img-delete>刪除</button><input type="file" accept="image/*" data-img-file hidden></span>' : '') +
      '<img class="img-preview" data-img-preview src="' + esc(img) + '" ' + (img ? '' : 'hidden') + ' alt=""></label>' +
      '<div class="row-actions">' + (canText ? '<button class="text-button" data-act="detail">詳細編輯</button>' : '') + (editable ? '<button class="text-button" data-act="save">儲存</button>' : '<span class="pill">唯讀</span>') + (has('tours.delete') ? '<button class="text-button danger" data-act="delete">刪除行程</button>' : '') + '</div></div>';
  }

  function renderTours() {
    var box = document.getElementById('tour-summary');
    if (!state.tours.length) { box.innerHTML = '<div class="empty-state">還沒有行程</div>'; return; }
    box.innerHTML = state.tours.map(tourRow).join('');
  }

  /* ---- image upload / delete helpers (tours + deals) ---- */
  function deleteUploaded(urlInput, scope) {
    var url = urlInput.value;
    if (url && url.indexOf('/data/uploads/') === 0) {
      var name = url.split('/').pop();
      api('/uploads/' + encodeURIComponent(name), { method: 'DELETE' }).then(function () {
        toast('圖片已刪除');
      }).catch(function () { toast('刪除失敗', true); });
    }
    urlInput.value = '';
    var prev = scope && scope.querySelector('[data-img-preview]');
    if (prev) { prev.hidden = true; prev.src = ''; }
  }
  function uploadImageFile(file, urlInput, scope) {
    if (!file) return;
    cropImage(file).then(function (dataUrl) {
      return api('/upload', { method: 'POST', body: { dataUrl: dataUrl } });
    }).then(function (d) {
      urlInput.value = d.url;
      var prev = scope && scope.querySelector('[data-img-preview]');
      if (prev) { prev.src = d.url; prev.hidden = false; }
      toast('圖片已上傳');
    }).catch(function () { toast('上傳失敗', true); });
  }
  function bindTourImageActions() {
    var summary = document.getElementById('tour-summary');
    summary.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-img-upload], [data-img-delete]');
      if (!btn) return;
      var row = btn.closest('.tour-row');
      var input = row.querySelector('[data-f="img0"]');
      if (!input) return;
      if (btn.hasAttribute('data-img-upload')) {
        var file = row.querySelector('[data-img-file]');
        file.value = '';
        file.click();
      } else {
        deleteUploaded(input, row);
      }
    });
    summary.addEventListener('change', function (ev) {
      var file = ev.target;
      if (!file || !file.hasAttribute('data-img-file')) return;
      var row = file.closest('.tour-row');
      var input = row.querySelector('[data-f="img0"]');
      if (input) uploadImageFile(file.files && file.files[0], input, row);
    });
  }
  function bindDialogImageActions() {
    var dialog = document.getElementById('tour-dialog');
    var input = dialog.querySelector('[name="img0"]');
    var prev = dialog.querySelector('[data-img-preview]');
    var file = dialog.querySelector('[data-img-file]');
    dialog.querySelector('[data-img-upload]').addEventListener('click', function () { file.value = ''; file.click(); });
    file.addEventListener('change', function () { uploadImageFile(file.files && file.files[0], input, dialog); });
    dialog.querySelector('[data-img-delete]').addEventListener('click', function () { deleteUploaded(input, dialog); });
    input.addEventListener('input', function () {
      if (input.value) { prev.src = input.value; prev.hidden = false; }
      else { prev.hidden = true; prev.src = ''; }
    });
  }

  function nzDateTimeInput(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '';
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
    var p = {}; parts.forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
  }
  function nzLocalInputToIso(value) {
    if (!value) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!m) throw new Error('日期時間格式錯誤');
    var target = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    var candidate = target;
    for (var i = 0; i < 3; i++) {
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(candidate));
      var p = {}; parts.forEach(function (x) { p[x.type] = x.value; });
      candidate += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    }
    if (nzDateTimeInput(new Date(candidate).toISOString()) !== value) throw new Error('此紐西蘭時間不存在（夏令時間切換時段）');
    return new Date(candidate).toISOString();
  }

  function openTourDialog(t) {
    if (!has(t.slug ? 'tours.edit.text' : 'tours.create')) { toast('無權限', true); return; }
    var f = document.getElementById('tour-form');
    f.reset();
    document.getElementById('tour-dialog').dataset.slug = t.slug || '';
    document.getElementById('tour-dialog-title').textContent = t.slug ? '編輯行程：' + (t.title || t.slug) : '新增行程';
    f.elements['cat'].value = t.cat || '';
    f.elements['price'].value = (t.price != null && t.price !== '') ? t.price : '';
    f.elements['featured'].checked = !!t.featured;
    f.elements['paymentMode'].value = t.paymentPolicy ? t.paymentPolicy.mode : '';
    f.elements['paymentValue'].value = t.paymentPolicy && t.paymentPolicy.value !== undefined ? t.paymentPolicy.value / 100 : '';
    f.elements['paymentMode'].disabled = f.elements['paymentValue'].disabled = !!t.slug && !has('tours.edit.price');
    ['publishAt', 'unpublishAt', 'bookingDeadline', 'purchaseStartAt', 'purchaseEndAt'].forEach(function (key) {
      var value = t[key] ? new Date(t[key]) : null;
      f.elements[key].value = value && !isNaN(value.getTime()) ? nzDateTimeInput(value.toISOString()) : '';
    });
    f.elements['visibility'].value = t.visibility === 'hidden' ? 'hidden' : 'public';
    f.elements['img0'].value = (t.images && t.images[0]) ? t.images[0] : '';
    var _prev = document.getElementById('tour-dialog').querySelector('[data-img-preview]');
    if (_prev) { if (f.elements['img0'].value) { _prev.src = f.elements['img0'].value; _prev.hidden = false; } else { _prev.hidden = true; _prev.src = ''; } }
    LANGUAGES.forEach(function (L) {
      var src = (L.code === 'zh') ? t : ((t.i18n && t.i18n[L.code]) || {});
      f.elements['title_' + L.code].value = src.title || '';
      f.elements['short_' + L.code].value = src.short || '';
      f.elements['desc_' + L.code].value = src.desc || '';
      f.elements['highlights_' + L.code].value = (src.highlights || []).join('\n');
      f.elements['priceTable_' + L.code].value = (src.priceTable || []).map(function (r) { return (r.label || '') + '|' + (r.price != null ? r.price : ''); }).join('\n');
      f.elements['departDates_' + L.code].value = src.departDates || '';
      f.elements['itin_' + L.code].value = (src.itin || []).map(function (d) { return d.day + '|' + (d.title || '') + '|' + (d.desc || ''); }).join('\n');
      f.elements['include_' + L.code].value = (src.include || []).join('\n');
      f.elements['exclude_' + L.code].value = (src.exclude || []).join('\n');
      f.elements['notes_' + L.code].value = src.notes || '';
    });
    fillCatSelect(t.cat);
    switchLangTab('zh');
    document.getElementById('tour-dialog').showModal();
  }

  function bindTours() {
    document.getElementById('tour-create').addEventListener('click', function () { openTourDialog({}); });
    document.getElementById('tour-summary').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (!btn) return;
      var row = btn.closest('.tour-row');
      var slug = row.dataset.slug;
      var act = btn.dataset.act;
      if (act === 'detail') {
        var t = state.tours.find(function (x) { return x.slug === slug; });
        if (t) openTourDialog(t);
        return;
      }
      if (act === 'delete') {
        if (!confirm('刪除這個行程？公開網站將移除，既有預訂紀錄會保留。')) return;
        btn.disabled = true;
        api('/tours/' + encodeURIComponent(slug), { method: 'DELETE' }).then(function () {
          loadTours(); toast('行程已刪除');
        }).catch(function () {}).finally(function () { btn.disabled = false; });
        return;
      }
      if (act !== 'save') return;
      var body = {};
      var f;
      f = row.querySelector('[data-f="price"]'); if (!f.disabled && f.value !== '') body.price = Number(f.value);
      f = row.querySelector('[data-f="img0"]'); if (!f.disabled) body.images = f.value ? [f.value] : [];
      f = row.querySelector('[data-f="featured"]'); if (!f.disabled) body.featured = f.checked;
      api('/tours/' + encodeURIComponent(slug), { method: 'PUT', body: body }).then(function () {
        loadTours();
        toast('行程已更新，公開網站立即生效');
      });
    });
    document.getElementById('tour-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var slug = document.getElementById('tour-dialog').dataset.slug;
      var splitLines = function (s) { return s.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); };
      function buildLang(code) {
        var priceTable = splitLines(f.elements['priceTable_' + code].value).map(function (line) {
          var i = line.indexOf('|');
          return { label: (i >= 0 ? line.slice(0, i) : line).trim(), price: Number((i >= 0 ? line.slice(i + 1) : '').trim()) || 0 };
        });
        var itin = splitLines(f.elements['itin_' + code].value).map(function (line) {
          var p = line.split('|');
          return { day: Number(p[0]) || 0, title: (p[1] || '').trim(), desc: (p.slice(2).join('|') || '').trim() };
        });
        return {
          title: f.elements['title_' + code].value,
          short: f.elements['short_' + code].value,
          desc: f.elements['desc_' + code].value,
          highlights: splitLines(f.elements['highlights_' + code].value),
          priceTable: priceTable, departDates: f.elements['departDates_' + code].value,
          itin: itin,
          include: splitLines(f.elements['include_' + code].value),
          exclude: splitLines(f.elements['exclude_' + code].value),
          notes: f.elements['notes_' + code].value
        };
      }
      var zh = buildLang('zh');
      var scheduleDates;
      try {
        scheduleDates = { publishAt: nzLocalInputToIso(f.elements['publishAt'].value), unpublishAt: nzLocalInputToIso(f.elements['unpublishAt'].value), bookingDeadline: nzLocalInputToIso(f.elements['bookingDeadline'].value), purchaseStartAt: nzLocalInputToIso(f.elements['purchaseStartAt'].value), purchaseEndAt: nzLocalInputToIso(f.elements['purchaseEndAt'].value) };
      } catch (dateError) { toast(dateError.message, true); return; }
      var body = {
        title: zh.title, cat: f.elements['cat'].value,
        price: f.elements['price'].value !== '' ? Number(f.elements['price'].value) : null,
        featured: !!f.elements['featured'].checked,
        purchaseStartAt: scheduleDates.purchaseStartAt,
        purchaseEndAt: scheduleDates.purchaseEndAt,
        publishAt: scheduleDates.publishAt,
        unpublishAt: scheduleDates.unpublishAt,
        bookingDeadline: scheduleDates.bookingDeadline,
        visibility: f.elements['visibility'].value === 'hidden' ? 'hidden' : 'public',
        images: f.elements['img0'].value ? [f.elements['img0'].value] : [],
        short: zh.short, desc: zh.desc,
        highlights: zh.highlights,
        priceTable: zh.priceTable, departDates: zh.departDates,
        itin: zh.itin, include: zh.include, exclude: zh.exclude,
        notes: zh.notes
      };
      if (!f.elements['paymentMode'].disabled) body.paymentPolicy = formPolicy(f);
      var i18n = {};
      LANGUAGES.forEach(function (L) { if (L.code !== 'zh') i18n[L.code] = buildLang(L.code); });
      body.i18n = i18n;
      var submit = f.querySelector('[type="submit"]');
      if (submit.disabled) return;
      submit.disabled = true;
      api(slug ? '/tours/' + encodeURIComponent(slug) : '/tours', { method: slug ? 'PUT' : 'POST', body: body }).then(function () {
        document.getElementById('tour-dialog').close();
        loadTours();
        toast('行程已儲存，公開網站立即生效');
      }).catch(function () {}).finally(function () { submit.disabled = false; });
    });
  }

  function switchLangTab(code) {
    document.querySelectorAll('.language-tab').forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-lang-tab') === code); });
    document.querySelectorAll('.language-panel').forEach(function (p) { p.hidden = p.getAttribute('data-lang-panel') !== code; });
  }

  document.querySelectorAll('.language-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { switchLangTab(tab.getAttribute('data-lang-tab')); });
  });

  var addCatBtn = document.getElementById('add-cat-btn');
  if (addCatBtn) addCatBtn.addEventListener('click', function () {
    var name = window.prompt('新增分類名稱（例如：南島團遊）');
    if (!name || !name.trim()) return;
    api('/categories', { method: 'POST', body: { name: name.trim() } }).then(function (d) {
      state.categories = d.categories || [];
      fillCatSelect();
      toast('分類「' + name.trim() + '」已新增，前台分類 tag 會自動出現');
    }).catch(function (e) { toast('新增分類失敗：' + (e.message || ''), true); });
  });

  /* ---------------- users ---------------- */
  function loadUsers() {
    api('/users').then(function (d) {
      state.users = d.users || [];
      renderUsers();
    });
  }

  function userRow(u) {
    var me = state.user.id === u.id;
    var permsList = (u.perms || []).map(function (p) { return '<span class="pill">' + esc(p) + '</span>'; }).join(' ');
    return '<div class="user-row" data-id="' + u.id + '">' +
      '<div class="user-meta"><b>' + esc(u.email) + '</b>' + (me ? ' <span class="pill">你</span>' : '') + '<div class="deal-sub">角色：<span class="role-chip">' + roleLabel(u.role) + '</span> · 2FA：' + (u.totpEnabled ? '✅' : '❌') + (u.disabled ? ' · <b style="color:#e5484d">已停用</b>' : '') + '</div><div class="deal-sub">' + permsList + '</div></div>' +
      '<div class="row-actions">' +
      (has('users.manage') && !me ? '<button class="text-button" data-act="edit">編輯</button>' : '') +
      (has('users.manage') ? '<button class="text-button" data-act="password">重設密碼</button><button class="text-button" data-act="totp">重置 2FA</button><button class="text-button" data-act="toggle-totp">' + (u.totpEnabled ? '關閉 2FA' : '開啟 2FA') + '</button>' : '') +
      (has('users.manage') && !me ? '<button class="text-button" data-act="toggle">' + (u.disabled ? '啟用' : '停用') + '</button>' : '') +
      (has('users.manage') && !me ? '<button class="text-button" data-act="del">刪除</button>' : '') +
      '</div></div>';
  }

  function renderUsers() {
    var list = document.getElementById('user-list');
    if (!state.users.length) { list.innerHTML = '<div class="empty-state">還沒有帳號。</div>'; return; }
    list.innerHTML = state.users.map(userRow).join('');
  }

  function openUserDialog() {
    if (!state.meta) { toast('權限清單載入中…'); loadMeta().then(openUserDialog); return; }
    document.getElementById('user-dialog-title').textContent = '新增帳號';
    var f = document.getElementById('user-form');
    f.reset();
    f.elements['email'].disabled = false;
    f.elements['password'].disabled = false;
    f.elements['password'].required = true;
    document.getElementById('save-user').textContent = '建立帳號';
    document.getElementById('user-dialog').dataset.editing = '';
    renderPresets('media');
    document.getElementById('user-dialog').showModal();
  }

  function renderPresets(presetId) {
    state.rolePreset = presetId;
    var box = document.getElementById('role-presets');
    box.innerHTML = (state.meta.roles || []).map(function (r) {
      return '<button type="button" class="admin-button ' + (r.id === presetId ? 'primary' : '') + '" data-preset="' + r.id + '">' + esc(r.label) + '</button>';
    }).join('');
    var checks = document.getElementById('perm-checks');
    checks.innerHTML = (state.meta.perms || []).map(function (p) {
      var preset = state.meta.roles.find(function (r) { return r.id === presetId; });
      var on = preset && preset.perms.indexOf(p.id) !== -1;
      return '<label class="toggle-row"><input type="checkbox" name="perm" value="' + p.id + '" ' + (on ? 'checked' : '') + '> <span>' + esc(p.label) + ' <small>' + esc(p.id) + '</small></span></label>';
    }).join('');
  }

  function bindUsers() {
    document.getElementById('password-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var dialog = document.getElementById('password-dialog');
      var button = f.querySelector('button[type="submit"]');
      button.disabled = true;
      api('/users/' + dialog.dataset.userId + '/reset-password', { method: 'POST', body: { password: f.elements.password.value } }).then(function () {
        f.reset(); dialog.close(); toast('密碼已重設');
      }).catch(function () {}).finally(function () { button.disabled = false; });
    });
    document.getElementById('password-dialog').addEventListener('close', function () { document.getElementById('password-form').reset(); });
    document.getElementById('new-user').addEventListener('click', openUserDialog);
    document.getElementById('role-presets').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-preset]');
      if (b) renderPresets(b.dataset.preset);
    });
    document.getElementById('user-list').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (!btn) return;
      var id = btn.closest('.user-row').dataset.id;
      var u = state.users.find(function (x) { return x.id === id; });
      if (!u) return;
      var act = btn.dataset.act;
      if (act === 'edit') {
        // inline edit dialog: role select + perm checks
        if (!state.meta) return toast('載入中…');
        document.getElementById('user-dialog-title').textContent = '編輯 ' + u.email;
        var f = document.getElementById('user-form');
        f.elements['email'].value = u.email;
        f.elements['email'].disabled = true;
        f.elements['password'].disabled = true;
        f.elements['password'].required = false;
        document.getElementById('save-user').textContent = '儲存權限';
        f.elements['password'].value = 'unchanged-placeholder';
        document.getElementById('user-dialog').dataset.editing = u.id;
        renderPresets(u.role);
        // re-check actual perms
        (state.meta.perms || []).forEach(function (p) {
          var c = f.querySelector('input[name="perm"][value="' + p.id + '"]');
          if (c) c.checked = (u.perms || []).indexOf(p.id) !== -1;
        });
        document.getElementById('user-dialog').showModal();
      } else if (act === 'password') {
        var passwordDialog = document.getElementById('password-dialog');
        passwordDialog.dataset.userId = id;
        document.getElementById('password-form').reset();
        passwordDialog.showModal();
      } else if (act === 'toggle-totp') {
        if (u.totpEnabled) {
          if (!confirm('關閉 ' + u.email + ' 的 2FA？此帳號之後只需密碼即可登入。')) return;
          api('/users/' + id + '/disable-totp', { method: 'POST' }).then(function () { loadUsers(); toast('2FA 已關閉'); });
        } else {
          api('/users/' + id + '/reset-totp', { method: 'POST' }).then(function (d) {
            showResetTotp(u.email, d.secret, d.uri);
            loadUsers();
          });
        }
      } else if (act === 'totp') {
        if (confirm('重置 ' + u.email + ' 的 2FA？將顯示一次新密鑰。')) {
          api('/users/' + id + '/reset-totp', { method: 'POST' }).then(function (d) {
            showResetTotp(u.email, d.secret, d.uri);
            loadUsers();
          });
        }
      } else if (act === 'toggle') {
        api('/users/' + id, { method: 'PUT', body: { disabled: !u.disabled } }).then(function () { loadUsers(); toast(u.disabled ? '已啟用' : '已停用'); });
      } else if (act === 'del') {
        if (confirm('確定刪除帳號 ' + u.email + '？')) api('/users/' + id, { method: 'DELETE' }).then(function () { loadUsers(); toast('已刪除'); });
      }
    });
    document.getElementById('user-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var editing = document.getElementById('user-dialog').dataset.editing;
      var perms = Array.from(f.querySelectorAll('input[name="perm"]:checked')).map(function (c) { return c.value; });
      var role = state.rolePreset;
      var body = { role: role, perms: perms };
      var req = editing ? api('/users/' + editing, { method: 'PUT', body: body }) : api('/users', { method: 'POST', body: Object.assign({ email: f.elements['email'].value, password: f.elements['password'].value }, body) });
      req.then(function (d) {
        return editing ? null : api('/users/' + d.user.id + '/reset-totp', { method: 'POST' }).then(function (totp) {
          return { email: d.user.email, secret: totp.secret, uri: totp.uri };
        });
      }).then(function (totp) {
        document.getElementById('user-dialog').close();
        f.elements['email'].disabled = false;
        f.elements['password'].disabled = false;
        loadUsers();
        if (totp) showResetTotp(totp.email, totp.secret, totp.uri);
        toast('已儲存');
      });
    });
  }

  /* ---------------- audit ---------------- */
  function loadAudit() {
    api('/audit').then(function (d) {
      var list = document.getElementById('audit-list');
      var rows = d.audit || [];
      if (!rows.length) { list.innerHTML = '<div class="empty-state">尚無紀錄。</div>'; return; }
      list.innerHTML = rows.map(function (a) {
        return '<div class="audit-row"><span class="audit-time">' + fmtTime(a.at) + '</span><span class="audit-user">' + esc(a.email) + '</span><span class="audit-action">' + esc(a.detail) + '</span></div>';
      }).join('');
    });
  }

  function formPolicy(f) {
    var mode = f.elements.paymentMode.value;
    return mode ? (mode === 'full' ? { mode: mode } : { mode: mode, value: Math.round(Number(f.elements.paymentValue.value) * 100) }) : null;
  }
  function loadCartCustomers() {
    if (!has('carts.manage')) return;
    api('/cart-customers').then(function (data) {
      var select = document.getElementById('staff-cart-form').elements.customerId;
      select.replaceChildren();
      data.customers.forEach(function (c) { var option = document.createElement('option'); option.value = c.id; option.textContent = c.email + ' · ' + c.id; select.appendChild(option); });
    }).catch(function () {});
  }
  function showStaffCart() {
    var f = document.getElementById('staff-cart-form'), box = document.getElementById('staff-cart-result');
    api('/staff-cart/' + encodeURIComponent(f.elements.customerId.value)).then(function (data) {
      box.replaceChildren();
      data.items.forEach(function (item) {
        var row = document.createElement('p'); row.textContent = item.title + ' · ' + item.quantity + ' · ' + item.departureDate;
        var button = document.createElement('button'); button.type = 'button'; button.textContent = '移除';
        button.addEventListener('click', function () { api('/staff-cart/' + encodeURIComponent(f.elements.customerId.value), { method: 'DELETE', body: { slug: item.slug, departureDate: item.departureDate } }).then(showStaffCart).catch(function () {}); });
        row.appendChild(button); box.appendChild(row);
      });
      data.removed.forEach(function (item) { var note = document.createElement('p'); note.textContent = item.reason; box.appendChild(note); });
      (data.orders || []).forEach(function (order) { var note = document.createElement('p'); note.textContent = order.id + ' · NZ$ ' + (order.totalCents / 100).toFixed(2) + ' · 未啟用付款'; box.appendChild(note); });
    }).catch(function (e) { box.textContent = e.message; });
  }
  document.getElementById('staff-cart-load').addEventListener('click', showStaffCart);
  document.getElementById('staff-cart-form').addEventListener('submit', function (e) {
    e.preventDefault(); var f = e.target;
    var body = { slug: f.elements.slug.value, departureDate: f.elements.departureDate.value, quantity: Number(f.elements.quantity.value), grantExpiresAt: f.elements.grantExpiresAt.value || null, quote: null };
    if (f.elements.quotePrice.value !== '') body.quote = { unitCents: Math.round(Number(f.elements.quotePrice.value) * 100), expiresAt: f.elements.quoteExpiresAt.value, paymentPolicy: formPolicy(f) };
    api('/staff-cart/' + encodeURIComponent(f.elements.customerId.value), { method: 'PUT', body: body }).then(function () { toast('客戶購物車已儲存，未收款'); showStaffCart(); }).catch(function () {});
  });
  document.getElementById('coupon-form').addEventListener('submit', function (e) {
    e.preventDefault(); var f = e.target;
    var list = function (value) { return value.split(',').map(function (s) { return s.trim(); }).filter(Boolean); };
    var body = { code: f.elements.code.value, mode: f.elements.mode.value, value: Math.round(Number(f.elements.value.value) * 100), startsAt: f.elements.startsAt.value, endsAt: f.elements.endsAt.value, minCents: Math.round(Number(f.elements.minPrice.value) * 100), maxUses: Number(f.elements.maxUses.value), slugs: list(f.elements.slugs.value), customerIds: list(f.elements.customerIds.value), enabled: f.elements.enabled.checked };
    api('/coupons', { method: 'POST', body: body }).then(function () { document.getElementById('coupon-result').textContent = '優惠碼已儲存；尚未兌換或收款'; }).catch(function () {});
  });
  /* ---------------- init ---------------- */
  bindAuth();
  bindDealForm();
  bindTours();
  bindTourImageActions();
  bindDialogImageActions();
  bindUsers();
  // Initialize after all module state and listeners are defined.

  var inquiryFilter = '';
  function loadChatSettings() {
    api('/chat-settings').then(function (j) {
      var s = j.settings || {}; var f = document.getElementById('chat-settings-form'); if (!f) return;
      ['title', 'status', 'welcome', 'wechat', 'kakaotalk'].forEach(function (key) { if (f.elements[key]) f.elements[key].value = s[key] || ''; });
    }).catch(function (e) { var el = document.getElementById('chat-settings-status'); if (el) el.textContent = '讀取失敗：' + e.message; });
  }
  function saveChatSettings(e) {
    e.preventDefault(); var f = e.currentTarget; var status = document.getElementById('chat-settings-status');
    var body = {}; ['title', 'status', 'welcome', 'wechat', 'kakaotalk'].forEach(function (key) { body[key] = f.elements[key].value; });
    var btn = f.querySelector('button[type="submit"]'); if (btn) btn.disabled = true; if (status) status.textContent = '保存中…';
    api('/chat-settings', { method: 'PUT', body: body }).then(function () { if (status) status.textContent = '已保存'; }).catch(function (e) { if (status) status.textContent = e.message; }).finally(function () { if (btn) btn.disabled = false; });
  }

  var recipientDraft = [];
  function renderRecipientRows() {
    var body = document.getElementById('recipient-rows');
    body.innerHTML = recipientDraft.map(function (email, i) {
      return '<tr><td>' + (i + 1) + '</td><td><input type="email" required maxlength="254" aria-label="收件人 ' + (i + 1) + ' email" data-recipient="' + i + '" value="' + esc(email) + '"></td><td><button type="button" class="admin-button danger" data-recipient-remove="' + i + '" aria-label="刪除收件人 ' + (i + 1) + '">刪除</button></td></tr>';
    }).join('');
    document.getElementById('recipient-count').textContent = recipientDraft.length + ' / 20 位收件人';
    document.getElementById('recipient-add').disabled = recipientDraft.length >= 20;
    body.querySelectorAll('[data-recipient]').forEach(function (input) { input.addEventListener('input', function () { recipientDraft[Number(input.dataset.recipient)] = input.value; document.getElementById('inquiry-recipients-status').textContent = '有尚未保存的變更'; }); });
    body.querySelectorAll('[data-recipient-remove]').forEach(function (button) { button.addEventListener('click', function () { recipientDraft.splice(Number(button.dataset.recipientRemove), 1); renderRecipientRows(); document.getElementById('inquiry-recipients-status').textContent = '有尚未保存的變更'; }); });
  }
  var recipientAdd = document.getElementById('recipient-add');
  if (recipientAdd) recipientAdd.addEventListener('click', function () { if (recipientDraft.length >= 20) return; recipientDraft.push(''); renderRecipientRows(); var inputs = document.querySelectorAll('[data-recipient]'); inputs[inputs.length - 1].focus(); });
  var inquirySearch = document.getElementById('inquiry-search');
  if (inquirySearch) inquirySearch.addEventListener('input', renderInquiries);
  function loadInquiryRecipients() {
    if (!has('inquiries.recipients.manage')) return;
    var status = document.getElementById('inquiry-recipients-status');
    api('/inquiry-recipients').then(function (j) { recipientDraft = (j.recipients || []).slice(); renderRecipientRows(); }).catch(function (e) { status.textContent = '讀取失敗：' + e.message; });
  }
  function saveInquiryRecipients(e) {
    e.preventDefault(); var status = document.getElementById('inquiry-recipients-status');
    if (!recipientDraft.length) { status.textContent = '至少保留一位收件人'; return; }
    e.currentTarget.querySelectorAll('button, input').forEach(function (control) { control.disabled = true; }); status.textContent = '保存中…';
    api('/inquiry-recipients', { method: 'PUT', body: { recipients: recipientDraft } }).then(function (j) { recipientDraft = j.recipients.slice(); renderRecipientRows(); status.textContent = '已保存 ' + j.recipients.length + ' 位收件人'; }).catch(function (e2) { status.textContent = e2.message; }).finally(function () { document.querySelectorAll('#inquiry-recipients-form button, #inquiry-recipients-form input').forEach(function (control) { control.disabled = false; }); document.getElementById('recipient-add').disabled = recipientDraft.length >= 20; });
  }

  function loadInquiries() {
    api('/inquiries').then(function (j) {
      state.inquiries = j.inquiries || [];
      renderInquiries();
    }).catch(function (e) {
      var el = document.getElementById('inquiry-list');
      if (el) el.innerHTML = '<p class="admin-empty">讀取失敗：' + esc(String(e.message || e)) + '</p>';
    });
  }
  function renderInquiries() {
    var el = document.getElementById('inquiry-list');
    if (!el) return;
    var labels = { new: '新留言', read: '已讀', replied: '已回覆', archived: '已封存' };
    var summary = document.getElementById('inquiry-summary');
    if (summary) summary.innerHTML = Object.keys(labels).map(function (key) { return '<div><span>' + labels[key] + '</span><strong>' + state.inquiries.filter(function (q) { return q.status === key; }).length + '</strong></div>'; }).join('');
    var search = document.getElementById('inquiry-search'); var term = search ? search.value.trim().toLowerCase() : '';
    var filter = document.getElementById('inquiry-filter').value;
    var rows = state.inquiries.filter(function (q) { return (!filter || q.status === filter) && [q.name, q.email, q.phone, q.tourTitle, q.tourId, q.message].join(' ').toLowerCase().indexOf(term) !== -1; });
    var table = '<div class="records-scroll"><table class="records-table inquiry-table"><caption class="sr-only">客詢留言紀錄</caption><thead><tr><th scope="col">收到時間</th><th scope="col">客戶 / 聯絡方式</th><th scope="col">訊息與來源</th><th scope="col">狀態 / 操作</th></tr></thead><tbody>';
    el.innerHTML = table + (rows.length ? rows.map(function (q) {
      var when = q.createdAt ? new Date(q.createdAt).toLocaleString('zh-TW', { timeZone: 'Pacific/Auckland' }) : '—';
      return '<tr><td><time>' + esc(when) + '</time><small>紐西蘭時間</small><small>' + esc(q.id) + '</small></td><td><strong>' + esc(q.name) + '</strong><small>' + esc(q.email) + '</small><small>' + esc(q.phone || '未提供電話') + '</small></td><td><details><summary>' + esc((q.message || '').slice(0, 90)) + '</summary><p class="inquiry-message">' + esc(q.message) + '</p></details><small>行程：' + esc(q.tourTitle || q.tourId || '一般詢問') + '</small><small>來源：' + esc(q.page || '未提供') + '</small></td><td><span class="inquiry-badge status-' + (Object.prototype.hasOwnProperty.call(labels, q.status) ? q.status : 'new') + '">' + esc(labels[q.status] || '新留言') + '</span><select aria-label="' + esc(q.name) + ' 的留言狀態" data-inq-status data-id="' + esc(q.id) + '"' + (has('inquiries.manage') ? '' : ' disabled') + '>' + Object.keys(labels).map(function (key) { return '<option value="' + key + '"' + (q.status === key ? ' selected' : '') + '>' + labels[key] + '</option>'; }).join('') + '</select><a href="mailto:' + esc(q.email) + '?subject=' + encodeURIComponent('Re: Excel Travel 詢問 - ' + (q.tourTitle || '')) + '" class="admin-button">回覆 Email</a></td></tr>';
    }).join('') : '<tr><td colspan="4"><div class="records-empty"><strong>' + (term ? '沒有符合的客詢' : '尚無客詢紀錄') + '</strong><p>' + (term ? '請調整搜尋條件或狀態篩選。' : '客人送出網站留言後，姓名、聯絡方式與完整內容會顯示在此。') + '</p></div></td></tr>') + '</tbody></table></div>';
    el.querySelectorAll('[data-inq-status]').forEach(function (sel) { sel.addEventListener('change', function () { sel.disabled = true; api('/inquiries', { method: 'PATCH', body: { id: sel.dataset.id, status: sel.value } }).then(loadInquiries).catch(function (e) { toast(e.message); loadInquiries(); }); }); });
  }

  /* ---------------- manual bookings / memberships ---------------- */
  var manualRows = { bookings: [], plans: [], members: [] };
  var manualPaths = { bookings: '/booking-records', plans: '/membership-plans', members: '/memberships' };
  function manualPermission(kind, manage) { return has((kind === 'bookings' ? 'bookings' : 'memberships') + (manage ? '.manage' : '.view')); }
  function loadManual(kind) {
    if (!manualPermission(kind, false)) return;
    api(manualPaths[kind]).then(function (d) { manualRows[kind] = d.records || []; renderManual(kind); if (kind === 'plans') { var select = document.querySelector('#manual-member-create [name="planId"]'); select.innerHTML = manualOptions(manualRows.plans.filter(function (p) { return p.enabled; }).map(function (p) { return [p.id,p.name]; }), ''); if (manualRows.members.length) renderManual('members'); } }).catch(function (e) {
      document.getElementById('manual-' + kind + '-list').textContent = '讀取失敗：' + e.message;
    });
  }
  function manualOptions(values, current) { return values.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (x[0] === current ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join(''); }
  var bookingStatuses = [['requested','新申請'],['quoted','已報價'],['confirmed','人工確認'],['completed','已完成'],['cancelled','已取消']];
  var memberStatuses = [['pending','待確認'],['active','人工啟用'],['paused','暫停'],['cancelled','取消']];
  function renderManual(kind) {
    var list = document.getElementById('manual-' + kind + '-list');
    var filter = document.getElementById('manual-' + kind + '-search').value.toLowerCase();
    var rows = manualRows[kind].filter(function (r) { return [r.id,r.name,r.email,r.tourTitle,r.planName].join(' ').toLowerCase().indexOf(filter) !== -1; });
    list.innerHTML = rows.length ? rows.map(function (r) {
      var fields = '';
      if (kind === 'bookings') {
        fields = '<p>' + esc(r.tourTitle || r.tourId) + ' · ' + esc(r.email) + ' · ' + esc(r.phone || '') + '</p><p>' + esc(r.booking ? r.booking.departDate + ' · 成人 ' + r.booking.adults + ' / 兒童 ' + r.booking.children + ' · ' + r.booking.room : '舊預訂：詳情見原始訊息') + '</p><p class="manual-message">' + esc(r.message) + '</p>' +
          '<label>預訂狀態<select name="bookingStatus">' + manualOptions(bookingStatuses,r.bookingStatus || 'requested') + '</select></label>' +
          '<div class="form-grid"><label>報價 NZ$<input name="quote" type="number" min="0" max="1000000" step="0.01" value="' + (r.quoteCents === undefined ? '' : r.quoteCents/100) + '"></label><label>要求定金 NZ$（非收款紀錄）<input name="deposit" type="number" min="0" max="1000000" step="0.01" value="' + (r.depositCents === undefined ? '' : r.depositCents/100) + '"></label></div>';
      } else if (kind === 'plans') {
        fields = '<label>方案名稱<input name="name" required maxlength="100" value="' + esc(r.name) + '"></label><label>描述<textarea name="description" maxlength="2000">' + esc(r.description) + '</textarea></label><div class="form-grid"><label>參考費用 NZ$<input name="price" type="number" required min="0" max="1000000" step="0.01" value="' + r.priceCents/100 + '"></label><label>週期<select name="interval">' + manualOptions([['month','月'],['year','年'],['once','一次']],r.interval) + '</select></label></div><label><input type="checkbox" name="enabled"' + (r.enabled ? ' checked' : '') + '> 開放人工建檔（不會發布或自動扣款）</label>';
      } else {
        fields = '<label>姓名<input name="name" required maxlength="100" value="' + esc(r.name) + '"></label><label>Email<input name="email" type="email" required maxlength="120" value="' + esc(r.email) + '"></label><label>方案<select name="planId" required>' + manualOptions(manualRows.plans.map(function (p) { return [p.id,p.name + (p.enabled ? '' : '（已停用）')]; }),r.planId) + '</select></label><label>會員狀態<select name="status">' + manualOptions(memberStatuses,r.status) + '</select></label><div class="form-grid"><label>開始日期<input name="startsOn" type="date" value="' + esc(r.startsOn || '') + '"></label><label>結束日期<input name="endsOn" type="date" value="' + esc(r.endsOn || '') + '"></label></div>';
      }
      if (kind !== 'plans') fields += '<label>內部備註<textarea name="staffNotes" maxlength="3000">' + esc(r.staffNotes || '') + '</textarea></label>';
      return '<form class="admin-card manual-record" data-manual-kind="' + kind + '" data-id="' + esc(r.id) + '"><strong>' + esc(r.name || r.id) + '</strong><small> · ' + esc(r.id) + '</small><fieldset' + (manualPermission(kind,true) ? '' : ' disabled') + '>' + fields + '<button class="admin-button primary" type="submit">儲存人工紀錄</button></fieldset></form>';
    }).join('') : '<p class="admin-empty">尚無符合的紀錄</p>';
  }
  function moneyCents(input) { return Math.round(Number(input)*100); }
  function saveManual(e) {
    var form = e.target.closest('[data-manual-kind]'); if (!form) return;
    e.preventDefault();
    var kind = form.dataset.manualKind;
    var row = manualRows[kind].find(function (r) { return r.id === form.dataset.id; });
    var f = new FormData(form); var body = row ? { id: row.id, revision: row.revision || 0 } : {};
    if (kind === 'bookings') {
      body.bookingStatus = f.get('bookingStatus'); body.staffNotes = f.get('staffNotes');
      if (f.get('quote') !== '') body.quoteCents = moneyCents(f.get('quote'));
      if (f.get('deposit') !== '') body.depositCents = moneyCents(f.get('deposit'));
    } else if (kind === 'plans') {
      body.name = f.get('name'); body.description = f.get('description'); body.priceCents = moneyCents(f.get('price')); body.interval = f.get('interval'); body.enabled = f.get('enabled') === 'on';
    } else { ['name','email','planId','status','startsOn','endsOn','staffNotes'].forEach(function (k) { body[k] = f.get(k); }); }
    var btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
    api(manualPaths[kind], { method: row ? 'PATCH' : 'POST', body: body }).then(function () { toast('人工紀錄已儲存；未執行收款'); if (!row) form.reset(); loadManual(kind); }).catch(function (err) { toast(err.message,true); }).finally(function () { btn.disabled = false; });
  }
  function exportManual(kind) {
    var rows = manualRows[kind]; if (!rows.length) return toast('沒有可匯出資料');
    var keys = kind === 'bookings' ? ['id','name','email','phone','tourTitle','bookingStatus','quoteCents','depositCents','staffNotes','createdAt'] : kind === 'plans' ? ['id','name','priceCents','currency','interval','enabled'] : ['id','name','email','planName','status','startsOn','endsOn','staffNotes'];
    var csv = [keys.map(csvCell).join(',')].concat(rows.map(function (r) { return keys.map(function (k) { return csvCell(r[k]); }).join(','); })).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})); a.download = 'excel-travel-'+kind+'.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  }
  ['bookings','plans','members'].forEach(function (kind) {
    document.getElementById('manual-'+kind+'-search').addEventListener('input',function () { renderManual(kind); });
    document.getElementById('manual-'+kind+'-refresh').addEventListener('click',function () { loadManual(kind); });
    document.getElementById('manual-'+kind+'-export').addEventListener('click',function () { exportManual(kind); });
    document.getElementById('manual-'+kind+'-list').addEventListener('submit',saveManual);
  });
  document.getElementById('manual-plan-create').addEventListener('submit',saveManual);
  document.getElementById('manual-member-create').addEventListener('submit',saveManual);

  /* ---------------- newsletter subscribers ---------------- */
  function loadSubscribers() {
    var status = document.getElementById('subscriber-filter') ? document.getElementById('subscriber-filter').value : '';
    var url = '/api/subscribers' + (status ? '?status=' + encodeURIComponent(status) : '');
    api(url).then(function (j) {
      state.subscribers = j.subscribers || [];
      renderSubscribers();
    }).catch(function (e) {
      var el = document.getElementById('subscriber-list');
      if (el) el.innerHTML = '<p class="admin-empty">讀取失敗：' + esc(String(e.message || e)) + '</p>';
    });
  }
  function renderSubscribers() {
    var el = document.getElementById('subscriber-list');
    if (!el) return;
    var rows = state.subscribers || [];
    el.innerHTML = '<div class="records-scroll"><table class="records-table"><caption class="sr-only">訂閱名單</caption>'
      + '<thead><tr><th scope="col">Email</th><th scope="col">來源頁面</th><th scope="col">紐西蘭時間</th><th scope="col">狀態</th></tr></thead><tbody>'
      + rows.map(function (s) {
        var when = s.createdAt ? new Date(s.createdAt).toLocaleString('zh-TW', { timeZone: 'Pacific/Auckland' }) : '—';
        return '<tr>'
          + '<td ><a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a></td>'
          + '<td >' + esc(s.page || '-') + '</td>'
          + '<td >' + esc(when) + '</td>'
          + '<td ><select data-sub-status data-id="' + esc(s.id) + '">'
          + '<option value="subscribed"' + (s.status === 'subscribed' ? ' selected' : '') + '>已訂閱</option>'
          + '<option value="unsubscribed"' + (s.status === 'unsubscribed' ? ' selected' : '') + '>已退訂</option>'
          + '</select></td></tr>';
      }).join('') + (rows.length ? '' : '<tr><td colspan="4"><div class="records-empty"><strong>尚無符合的訂閱紀錄</strong><p>網站頁尾送出的訂閱資料會顯示在此，可篩選與匯出 CSV。</p></div></td></tr>') + '</tbody></table></div>';
    el.querySelectorAll('[data-sub-status]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        api('/api/subscribers', { method: 'PATCH', body: { id: sel.getAttribute('data-id'), status: sel.value } })
          .then(function () { loadSubscribers(); })
          .catch(function (e) { alert(e.message); });
      });
    });
  }
  /* RFC 4180-ish: quote every field, escape embedded quotes. Prevents a comma
     or newline in an email/page from breaking column alignment in Excel. */
  function csvCell(v) { var s = String(v == null ? '' : v); if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
  function exportSubscribers() {
    var rows = state.subscribers || [];
    if (!rows.length) { alert('沒有可匯出的訂閱資料'); return; }
    var out = [['email', 'status', 'page', 'createdAt'].map(csvCell).join(',')]
      .concat(rows.map(function (s) { return [s.email, s.status, s.page, s.createdAt].map(csvCell).join(','); }))
      .join('\r\n');
    // BOM so Excel opens Chinese page paths as UTF-8 instead of mojibake.
    var blob = new Blob(['\ufeff' + out], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'excel-travel-subscribers-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }
  boot();
})();
