/* Excel Travel Admin Portal — server-backed operations console */
/* Auth + permissions enforced on the server (see server.js). This file only
   renders the UI and calls the API; it never decides who may do what. */
(function () {
  'use strict';

  var state = { user: null, tours: [], drafts: [], published: [], meta: null, editingId: null, dealImageUrl: '', users: [], rolePreset: 'media' };

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
    document.querySelectorAll('[data-audit-only]').forEach(function (b) { b.style.display = has('audit.view') ? '' : 'none'; });
    switchView('deals');
    loadMeta();
  }

  function switchView(name) {
    document.querySelectorAll('.side-link').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
    ['deals', 'tours', 'users', 'audit'].forEach(function (v) { document.getElementById('view-' + v).hidden = (v !== name); });
    if (name === 'deals') loadDeals();
    if (name === 'tours') loadTours();
    if (name === 'users') loadUsers();
    if (name === 'audit') loadAudit();
  }
  document.querySelectorAll('.side-link').forEach(function (b) { b.addEventListener('click', function () { switchView(b.dataset.view); }); });
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
  }

  function tourRow(t, i) {
    var canPrice = has('tours.edit.price'), canImage = has('tours.edit.image'), canText = has('tours.edit.text');
    var editable = canPrice || canImage || canText;
    var img = (t.images && t.images[0]) ? t.images[0] : '';
    return '<div class="tour-row" data-slug="' + esc(t.slug) + '">' +
      '<div class="deal-sub" style="min-width:0"><div class="deal-title">' + esc(t.title) + '</div>' +
      '<div class="deal-sub">' + esc(t.cat || '') + ' · <input data-f="featured" type="checkbox" ' + (t.featured ? 'checked' : '') + (canText ? '' : ' disabled') + '> 精選 · ' + (t.itin && t.itin.length ? t.itin.length + ' 天行程' : '') + '</div></div>' +
      '<label class="fld">價格 NZ$<input data-f="price" type="number" min="0" value="' + (t.price != null ? t.price : '') + '" placeholder="請諮詢" ' + (canPrice ? '' : ' disabled') + '></label>' +
      '<label class="fld">主圖 URL<input data-f="img0" type="text" value="' + esc(img) + '" placeholder="https://…" ' + (canImage ? '' : ' disabled') + '></label>' +
      '<div class="row-actions">' + (canText ? '<button class="text-button" data-act="detail">詳細編輯</button>' : '') + (editable ? '<button class="text-button" data-act="save">儲存</button>' : '<span class="pill">唯讀</span>') + '</div></div>';
  }

  function renderTours() {
    var box = document.getElementById('tour-summary');
    if (!state.tours.length) { box.innerHTML = '<div class="empty-state">載入中…</div>'; return; }
    box.innerHTML = state.tours.map(tourRow).join('');
  }

  function openTourDialog(t) {
    if (!has('tours.edit.text')) { toast('無權限', true); return; }
    var f = document.getElementById('tour-form');
    f.reset();
    document.getElementById('tour-dialog-title').textContent = '編輯行程：' + t.title;
    f.elements['title'].value = t.title || '';
    f.elements['cat'].value = t.cat || '';
    f.elements['price'].value = (t.price != null && t.price !== '') ? t.price : '';
    f.elements['img0'].value = (t.images && t.images[0]) ? t.images[0] : '';
    f.elements['short'].value = t.short || '';
    f.elements['desc'].value = t.desc || '';
    f.elements['highlights'].value = (t.highlights || []).join('\n');
    f.elements['priceTable'].value = (t.priceTable || []).map(function (r) { return r.label + '|' + r.price; }).join('\n');
    f.elements['departDates'].value = t.departDates || '';
    f.elements['itin'].value = (t.itin || []).map(function (d) { return d.day + '|' + d.title + '|' + d.desc; }).join('\n');
    f.elements['include'].value = (t.include || []).join('\n');
    f.elements['exclude'].value = (t.exclude || []).join('\n');
    f.elements['notes'].value = t.notes || '';
    f.elements['featured'].checked = !!t.featured;
    document.getElementById('tour-dialog').dataset.slug = t.slug;
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
      var priceTable = splitLines(f.elements['priceTable'].value).map(function (line) {
        var i = line.indexOf('|');
        return { label: (i >= 0 ? line.slice(0, i) : line).trim(), price: Number((i >= 0 ? line.slice(i + 1) : '').trim()) || 0 };
      });
      var itin = splitLines(f.elements['itin'].value).map(function (line) {
        var p = line.split('|');
        return { day: Number(p[0]) || 0, title: (p[1] || '').trim(), desc: (p.slice(2).join('|') || '').trim() };
      });
      var body = {
        title: f.elements['title'].value, cat: f.elements['cat'].value,
        price: f.elements['price'].value !== '' ? Number(f.elements['price'].value) : null,
        images: f.elements['img0'].value ? [f.elements['img0'].value] : [],
        short: f.elements['short'].value, desc: f.elements['desc'].value,
        highlights: splitLines(f.elements['highlights'].value),
        priceTable: priceTable, departDates: f.elements['departDates'].value,
        itin: itin, include: splitLines(f.elements['include'].value), exclude: splitLines(f.elements['exclude'].value),
        notes: f.elements['notes'].value, featured: f.elements['featured'].checked
      };
      api('/tours/' + encodeURIComponent(slug), { method: 'PUT', body: body }).then(function () {
        document.getElementById('tour-dialog').close();
        loadTours();
        toast('行程已儲存，公開網站立即生效');
      });
    });
  }

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
  bindUsers();
  boot();
})();
