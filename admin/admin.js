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
    return fetch('/api' + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' })
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
  function showSetup(secretData) {
    showAuthPanel('setup-panel');
    var secret = secretData.secret;
    document.getElementById('totp-secret').textContent = secret;
    document.getElementById('totp-live').textContent = '…';
    window.ETTOTP.currentCode(secret).then(function (c) { document.getElementById('totp-live').textContent = c; });
    setInterval(function () { window.ETTOTP.currentCode(secret).then(function (c) { document.getElementById('totp-live').textContent = c; }); }, 5000);
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
        document.getElementById('totp-secret').textContent = d.secret;
        document.getElementById('totp-live').textContent = '…';
        window.ETTOTP.currentCode(d.secret).then(function (c) { document.getElementById('totp-live').textContent = c; });
        setInterval(function () { window.ETTOTP.currentCode(d.secret).then(function (c) { document.getElementById('totp-live').textContent = c; }); }, 5000);
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
      var body = { email: f.email.value, password: f.password.value };
      if (f.totp.value) body.code = f.totp.value;
      api('/auth/login', { method: 'POST', body: body }).then(function (d) {
        if (d.needTotp) { document.getElementById('totp-field').hidden = false; document.getElementById('auth-error').hidden = true; f.totp.focus(); return; }
        state.user = d.user;
        enterApp();
      }).catch(function () {});
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
    document.querySelectorAll('[data-audit-only]').forEach(function (b) { b.style.display = has('audit.view') ? '' : 'none'; });
    switchView('deals');
    loadMeta();
  }

  function switchView(name) {
    document.querySelectorAll('.side-link').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
    ['deals', 'tours', 'users', 'audit', 'inquiries'].forEach(function (v) { document.getElementById('view-' + v).hidden = (v !== name); });
    if (name === 'deals') loadDeals();
    if (name === 'tours') loadTours();
    if (name === 'users') loadUsers();
    if (name === 'audit') loadAudit();
    if (name === 'inquiries') { loadChatSettings(); loadInquiries(); loadSubscribers(); }
  }
  document.querySelectorAll('.side-link').forEach(function (b) { b.addEventListener('click', function () { switchView(b.dataset.view); }); });
    var csf = document.getElementById('chat-settings-form'); if (csf) csf.addEventListener('submit', saveChatSettings);
    var inf = document.getElementById('inquiry-filter'); if (inf) inf.addEventListener('change', loadInquiries);
    var inr = document.getElementById('inquiry-refresh'); if (inr) inr.addEventListener('click', loadInquiries);
    var suf = document.getElementById('subscriber-filter'); if (suf) suf.addEventListener('change', loadSubscribers);
    var sur = document.getElementById('subscriber-refresh'); if (sur) sur.addEventListener('click', loadSubscribers);
    var sue = document.getElementById('subscriber-export'); if (sue) sue.addEventListener('click', exportSubscribers);
  document.querySelectorAll('[data-close-dialog]').forEach(function (b) { b.addEventListener('click', function () { var d = b.closest('dialog'); if (d) d.close(); }); });

  function loadMeta() {
    return api('/meta').then(function (d) { state.meta = d; }).catch(function () {});
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

  function tourRow(t, i) {
    var canPrice = has('tours.edit.price'), canImage = has('tours.edit.image'), canText = has('tours.edit.text');
    var editable = canPrice || canImage || canText;
    var img = (t.images && t.images[0]) ? t.images[0] : '';
    return '<div class="tour-row" data-slug="' + esc(t.slug) + '">' +
      '<div class="deal-sub" style="min-width:0"><div class="deal-title">' + esc(t.title) + '</div>' +
      '<div class="deal-sub">' + esc(t.cat || '') + ' · <input data-f="featured" type="checkbox" ' + (t.featured ? 'checked' : '') + (canText ? '' : ' disabled') + '> 精選 · ' + (t.itin && t.itin.length ? t.itin.length + ' 天行程' : '') + '</div></div>' +
      '<label class="fld">價格 NZ$<input data-f="price" type="number" min="0" value="' + (t.price != null ? t.price : '') + '" placeholder="請諮詢" ' + (canPrice ? '' : ' disabled') + '></label>' +
      '<label class="fld">主圖<input data-f="img0" type="text" value="' + esc(img) + '" placeholder="/assets/… 或貼 URL" ' + (canImage ? '' : ' disabled') + '>' +
      (canImage ? '<span class="img-line"><button type="button" class="admin-button" data-img-upload>上傳</button><button type="button" class="admin-button danger" data-img-delete>刪除</button><input type="file" accept="image/*" data-img-file hidden></span>' : '') +
      '<img class="img-preview" data-img-preview src="' + esc(img) + '" ' + (img ? '' : 'hidden') + ' alt=""></label>' +
      '<div class="row-actions">' + (canText ? '<button class="text-button" data-act="detail">詳細編輯</button>' : '') + (editable ? '<button class="text-button" data-act="save">儲存</button>' : '<span class="pill">唯讀</span>') + '</div></div>';
  }

  function renderTours() {
    var box = document.getElementById('tour-summary');
    if (!state.tours.length) { box.innerHTML = '<div class="empty-state">載入中…</div>'; return; }
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

  function openTourDialog(t) {
    if (!has('tours.edit.text')) { toast('無權限', true); return; }
    var f = document.getElementById('tour-form');
    f.reset();
    document.getElementById('tour-dialog').dataset.slug = t.slug;
    document.getElementById('tour-dialog-title').textContent = '編輯行程：' + (t.title || t.slug);
    f.elements['cat'].value = t.cat || '';
    f.elements['price'].value = (t.price != null && t.price !== '') ? t.price : '';
    f.elements['featured'].checked = !!t.featured;
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
      var body = {
        title: zh.title, cat: f.elements['cat'].value,
        price: f.elements['price'].value !== '' ? Number(f.elements['price'].value) : null,
        featured: !!f.elements['featured'].checked,
        images: f.elements['img0'].value ? [f.elements['img0'].value] : [],
        short: zh.short, desc: zh.desc,
        highlights: zh.highlights,
        priceTable: zh.priceTable, departDates: zh.departDates,
        itin: zh.itin, include: zh.include, exclude: zh.exclude,
        notes: zh.notes
      };
      var i18n = {};
      LANGUAGES.forEach(function (L) { if (L.code !== 'zh') i18n[L.code] = buildLang(L.code); });
      body.i18n = i18n;
      api('/tours/' + encodeURIComponent(slug), { method: 'PUT', body: body }).then(function () {
        document.getElementById('tour-dialog').close();
        loadTours();
        toast('行程已儲存，公開網站立即生效');
      });
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
      (has('users.manage') && !me ? '<button class="text-button" data-act="totp">重置 2FA</button>' : '') +
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
        f.elements['password'].value = 'unchanged-placeholder';
        document.getElementById('user-dialog').dataset.editing = u.id;
        renderPresets(u.role);
        // re-check actual perms
        (state.meta.perms || []).forEach(function (p) {
          var c = f.querySelector('input[name="perm"][value="' + p.id + '"]');
          if (c) c.checked = (u.perms || []).indexOf(p.id) !== -1;
        });
        document.getElementById('user-dialog').showModal();
      } else if (act === 'totp') {
        if (confirm('重置 ' + u.email + ' 的 2FA？將顯示一次新密鑰。')) {
          api('/users/' + id + '/reset-totp', { method: 'POST' }).then(function (d) {
            alert('新 2FA 密鑰（只顯示一次）：\n\n' + d.secret + '\n\n請立即加入 Authenticator。');
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
      req.then(function () {
        document.getElementById('user-dialog').close();
        f.elements['email'].disabled = false;
        f.elements['password'].disabled = false;
        loadUsers();
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

  /* ---------------- init ---------------- */
  bindAuth();
  bindDealForm();
  bindTours();
  bindTourImageActions();
  bindDialogImageActions();
  bindUsers();
  boot();
})();

  var inquiryFilter = '';
  function loadChatSettings() {
    api('/chat-settings').then(function (r) { return r.json(); }).then(function (j) {
      var s = j.settings || {}; var f = document.getElementById('chat-settings-form'); if (!f) return;
      ['title', 'status', 'welcome', 'wechat', 'kakaotalk'].forEach(function (key) { if (f.elements[key]) f.elements[key].value = s[key] || ''; });
    }).catch(function (e) { var el = document.getElementById('chat-settings-status'); if (el) el.textContent = '讀取失敗：' + e.message; });
  }
  function saveChatSettings(e) {
    e.preventDefault(); var f = e.currentTarget; var status = document.getElementById('chat-settings-status');
    var body = {}; ['title', 'status', 'welcome', 'wechat', 'kakaotalk'].forEach(function (key) { body[key] = f.elements[key].value; });
    var btn = f.querySelector('button[type="submit"]'); if (btn) btn.disabled = true; if (status) status.textContent = '保存中…';
    api('/chat-settings', { method: 'PUT', body: body }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || '保存失敗'); return j; }); }).then(function () { if (status) status.textContent = '已保存'; }).catch(function (e) { if (status) status.textContent = e.message; }).finally(function () { if (btn) btn.disabled = false; });
  }

  function loadInquiries() {
    var status = document.getElementById('inquiry-filter') ? document.getElementById('inquiry-filter').value : '';
    var url = '/api/inquiries' + (status ? '?status=' + encodeURIComponent(status) : '');
    api(url).then(function (r) { return r.json(); }).then(function (j) {
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
    if (!state.inquiries.length) { el.innerHTML = '<p class="admin-empty">尚無留言</p>'; return; }
    el.innerHTML = state.inquiries.map(function (q) {
      var when = q.createdAt ? new Date(q.createdAt).toLocaleString('zh-TW') : '';
      var tour = esc(q.tourTitle || q.tourId || '');
      return '<div class="admin-card" style="margin-bottom:10px">'
        + '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><div><strong>' + esc(q.name) + '</strong> <span style="color:var(--muted)">' + esc(q.email) + (q.phone ? ' · ' + esc(q.phone) : '') + '</span><div style="font-size:12px;color:var(--muted)">' + esc(when) + (q.page ? ' · ' + esc(q.page) : '') + (tour ? ' · ' + tour : '') + ' · <span style="text-transform:uppercase">' + esc(q.status) + '</span></div></div>'
        + '<div style="display:flex;gap:6px;align-items:center"><a href="mailto:' + esc(q.email) + '?subject=' + encodeURIComponent('Re: Excel Travel 詢問 - ' + (q.tourTitle || '')) + '&body=' + encodeURIComponent('Hi ' + q.name + ',\n\n') + '" class="admin-button">回覆 Email</a>'
        + '<select data-inq-status data-id="' + esc(q.id) + '"><option value="new"' + (q.status==='new'?' selected':'') + '>新留言</option><option value="read"' + (q.status==='read'?' selected':'') + '>已讀</option><option value="replied"' + (q.status==='replied'?' selected':'') + '>已回覆</option><option value="archived"' + (q.status==='archived'?' selected':'') + '>封存</option></select></div></div>'
        + '<div style="margin-top:8px;white-space:pre-wrap;word-break:break-word">' + esc(q.message) + '</div>'
        + '</div>';
    }).join('');
    el.querySelectorAll('[data-inq-status]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var id = sel.getAttribute('data-id'); var st = sel.value;
        api('/api/inquiries', { method: 'PATCH', body: { id: id, status: st } }).then(function(r){ if(!r.ok) throw new Error('更新失敗'); return r.json(); }).then(function(){ loadInquiries(); }).catch(function(e){ alert(e.message); });
      });
    });
  }

  /* ---------------- newsletter subscribers ---------------- */
  function loadSubscribers() {
    var status = document.getElementById('subscriber-filter') ? document.getElementById('subscriber-filter').value : '';
    var url = '/api/subscribers' + (status ? '?status=' + encodeURIComponent(status) : '');
    api(url).then(function (r) { return r.json(); }).then(function (j) {
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
    if (!rows.length) { el.innerHTML = '<p class="admin-empty">尚無訂閱</p>'; return; }
    el.innerHTML = '<div class="admin-card"><table style="width:100%;border-collapse:collapse;font-size:13px">'
      + '<tr style="text-align:left;color:var(--muted)"><th style="padding:6px">Email</th><th style="padding:6px">來源頁面</th><th style="padding:6px">時間</th><th style="padding:6px">狀態</th></tr>'
      + rows.map(function (s) {
        var when = s.createdAt ? new Date(s.createdAt).toLocaleString('zh-TW') : '';
        return '<tr style="border-top:1px solid var(--line,#2a2a2a)">'
          + '<td style="padding:6px"><a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a></td>'
          + '<td style="padding:6px;color:var(--muted)">' + esc(s.page || '-') + '</td>'
          + '<td style="padding:6px;color:var(--muted)">' + esc(when) + '</td>'
          + '<td style="padding:6px"><select data-sub-status data-id="' + esc(s.id) + '">'
          + '<option value="subscribed"' + (s.status === 'subscribed' ? ' selected' : '') + '>已訂閱</option>'
          + '<option value="unsubscribed"' + (s.status === 'unsubscribed' ? ' selected' : '') + '>已退訂</option>'
          + '</select></td></tr>';
      }).join('') + '</table></div>';
    el.querySelectorAll('[data-sub-status]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        api('/api/subscribers', { method: 'PATCH', body: { id: sel.getAttribute('data-id'), status: sel.value } })
          .then(function (r) { if (!r.ok) throw new Error('更新失敗'); return r.json(); })
          .then(function () { loadSubscribers(); })
          .catch(function (e) { alert(e.message); });
      });
    });
  }
  /* RFC 4180-ish: quote every field, escape embedded quotes. Prevents a comma
     or newline in an email/page from breaking column alignment in Excel. */
  function csvCell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
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
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
