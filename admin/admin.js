/* Excel Travel Admin Portal — client-side operations console */
/* NOTE: demo persistence is localStorage. Production needs a real API
   (auth, uploads, shared DB). The UI/workflow mirrors the production shape. */
(function () {
  'use strict';

  var LS = {
    users: 'etadmin_users',
    session: 'etadmin_session',
    deals: 'etadmin_deals',
    published: 'etadmin_published',
    tourprices: 'etadmin_tourprices',
    audit: 'etadmin_audit'
  };

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('儲存空間不足（圖片太大）', true); } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function now() { return new Date().toISOString(); }
  function fmtTime(iso) { try { return new Date(iso).toLocaleString('zh-TW', { hour12: false }); } catch (e) { return iso; } }

  function toast(msg, isErr) {
    var el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.toggle('err', !!isErr); el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function audit(user, action, detail) {
    var a = lsGet(LS.audit, []);
    a.unshift({ at: now(), user: user, action: action, detail: detail || '' });
    if (a.length > 500) a.length = 500;
    lsSet(LS.audit, a);
  }

  /* ---------------- crypto helpers ---------------- */
  function bufToBase64(u) { var s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function base64ToBuf(b64) { var bin = atob(b64); var u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function randomBytes(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
  function randomToken() { return Array.from(randomBytes(24)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join(''); }

  function pbkdf2(password, saltB64, iter) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
      .then(function (k) { return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: base64ToBuf(saltB64), iterations: iter || 120000, hash: 'SHA-256' }, k, 256); })
      .then(function (b) { return bufToBase64(new Uint8Array(b)); });
  }
  function makeSalt() { return bufToBase64(randomBytes(16)); }
  function hashPassword(password, salt) { return pbkdf2(password, salt || makeSalt(), 120000); }
  function verifyPassword(password, salt, hash) { return pbkdf2(password, salt, 120000).then(function (h) { return h === hash; }); }

  /* ---------------- state ---------------- */
  var state = { user: null, deals: lsGet(LS.deals, []), editingId: null, imageData: null, pending: null };

  /* ---------------- auth ---------------- */
  function getUsers() { return lsGet(LS.users, []); }
  function saveUsers(u) { lsSet(LS.users, u); }

  function currentUser() {
    if (state.user) return state.user;
    var s = lsGet(LS.session, null);
    if (!s || !s.userId || !s.exp || s.exp < Date.now()) return null;
    var u = getUsers().filter(function (x) { return x.id === s.userId; })[0];
    if (!u) return null;
    state.user = u; return u;
  }

  function setSession(user) {
    lsSet(LS.session, { userId: user.id, token: randomToken(), exp: Date.now() + 12 * 3600 * 1000 });
    state.user = user;
  }
  function clearSession() { localStorage.removeItem(LS.session); state.user = null; }

  function showAuth() { document.getElementById('auth-screen').hidden = false; document.getElementById('app-screen').hidden = true; }
  function showApp() { document.getElementById('auth-screen').hidden = true; document.getElementById('app-screen').hidden = false; renderAll(); }

  /* ---------------- boot / onboarding ---------------- */
  function boot() {
    var hasUsers = getUsers().length > 0;
    if (currentUser()) { showApp(); return; }
    showAuth();
    document.getElementById('setup-panel').hidden = hasUsers;
    document.getElementById('login-panel').hidden = !hasUsers;
    document.getElementById('totp-setup-panel').hidden = true;
    if (!hasUsers) {
      document.getElementById('setup-form').addEventListener('submit', onSetup);
    } else {
      document.getElementById('login-form').addEventListener('submit', onLogin);
      document.getElementById('totp-field').style.display = 'none';
    }
  }

  function onSetup(e) {
    e.preventDefault();
    var f = e.target, email = f.email.value.trim().toLowerCase(), pw = f.password.value;
    if (pw.length < 12) { toast('密碼至少 12 字元', true); return; }
    var users = getUsers();
    if (users.some(function (u) { return u.email === email; })) { toast('此 email 已存在', true); return; }
    state.pending = { email: email, password: pw, secret: window.ETTOTP.generateSecret() };
    document.getElementById('setup-panel').hidden = true;
    document.getElementById('login-panel').hidden = true;
    var tp = document.getElementById('totp-setup-panel');
    tp.hidden = false;
    var secretEl = document.getElementById('totp-secret');
    secretEl.textContent = state.pending.secret;
    var uri = window.ETTOTP.otpauthURI(email, state.pending.secret);
    var live = document.getElementById('totp-live');
    if (!live) { live = document.createElement('p'); live.id = 'totp-live'; live.className = 'admin-muted'; secretEl.parentNode.insertBefore(live, secretEl.nextSibling); }
    var tick = function () {
      window.ETTOTP.currentCode(state.pending.secret).then(function (c) {
        live.textContent = '即時驗證碼（demo 便利）：' + c + ' ｜或貼上 otpauth URI：' + uri;
      });
    };
    tick(); clearInterval(tp._t); tp._t = setInterval(tick, 1000);
    document.getElementById('setup-totp').focus();
  }

  function confirmTOTPSetup() {
    var p = state.pending;
    if (!p) return;
    var code = document.getElementById('setup-totp').value.trim();
    if (!/^\d{6}$/.test(code)) { toast('請輸入 6 位數驗證碼', true); return; }
    window.ETTOTP.verify(p.secret, code).then(function (ok) {
      if (!ok) { document.getElementById('setup-error').textContent = '驗證碼不正確'; return; }
      var users = getUsers();
      var salt = makeSalt();
      var user = { id: uid(), email: p.email, salt: salt, hash: '', role: 'admin', totpSecret: p.secret, totpEnabled: true, createdAt: now() };
      hashPassword(p.password, salt).then(function (h) {
        user.hash = h;
        users.push(user); saveUsers(users);
        setSession(user);
        audit(user.email, 'setup', '建立管理員帳號並啟用 2FA');
        document.getElementById('totp-setup-panel').hidden = true;
        clearInterval(document.getElementById('totp-setup-panel')._t);
        state.pending = null;
        toast('帳號建立完成，已登入');
        showApp();
      });
    });
  }

  function onLogin(e) {
    e.preventDefault();
    var f = e.target, email = f.email.value.trim().toLowerCase(), pw = f.password.value, code = f.totp.value.trim();
    var u = getUsers().filter(function (x) { return x.email === email; })[0];
    if (!u) { document.getElementById('auth-error').textContent = '帳號或密碼錯誤'; return; }
    verifyPassword(pw, u.salt, u.hash).then(function (ok) {
      if (!ok) { document.getElementById('auth-error').textContent = '帳號或密碼錯誤'; return; }
      if (!u.totpEnabled) { setSession(u); audit(u.email, 'login', '登入（未啟用 2FA）'); showApp(); return; }
      if (!code) { document.getElementById('totp-field').style.display = 'block'; document.getElementById('totp-field').querySelector('input').focus(); return; }
      window.ETTOTP.verify(u.totpSecret, code).then(function (ok2) {
        if (!ok2) { document.getElementById('auth-error').textContent = '2FA 驗證碼不正確'; return; }
        setSession(u);
        audit(u.email, 'login', '登入成功（2FA）');
        toast('歡迎回來，' + u.email);
        showApp();
      });
    });
  }

  /* ---------------- rendering ---------------- */
  function renderAll() {
    var u = currentUser();
    if (!u) return;
    document.getElementById('user-label').textContent = u.email + ' · ' + (u.role === 'admin' ? '管理員' : '編輯');
    var usersNav = document.querySelector('[data-view="users"]');
    usersNav.style.display = (u.role === 'admin') ? '' : 'none';
    renderDeals(); renderTours(); renderUsers(); renderAudit();
  }

  function switchView(name) {
    document.querySelectorAll('.side-link').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
    ['deals', 'tours', 'users', 'audit'].forEach(function (v) {
      document.getElementById('view-' + v).hidden = (v !== name);
    });
    if (name === 'tours') renderTours();
    if (name === 'users') renderUsers();
    if (name === 'audit') renderAudit();
  }
  document.querySelectorAll('.side-link').forEach(function (b) { b.addEventListener('click', function () { switchView(b.dataset.view); }); });

  /* ---------------- deals ---------------- */
  function saveDeals() { lsSet(LS.deals, state.deals); }

  function snapshotPublished() {
    var prev = lsGet(LS.published, null);
    var version = (prev && prev.version ? prev.version : 0) + 1;
    var deals = state.deals.filter(function (d) { return d.status === 'published' && d.image; });
    lsSet(LS.published, { version: version, at: now(), by: currentUser().email, deals: deals });
    return version;
  }

  function renderDeals() {
    var stats = document.getElementById('deal-stats');
    stats.innerHTML =
      '<div class="stat"><b>' + state.deals.length + '</b><span>全部 deals</span></div>' +
      '<div class="stat"><b>' + state.deals.filter(function (d) { return d.status === 'published'; }).length + '</b><span>已發布</span></div>' +
      '<div class="stat"><b>' + state.deals.filter(function (d) { return d.status === 'draft'; }).length + '</b><span>草稿</span></div>';
    var list = document.getElementById('deal-list');
    if (!state.deals.length) { list.innerHTML = '<div class="empty-state"><b>還沒有 promotion deal</b>點「新增 deal」開始建立第一張促銷卡片。</div>'; return; }
    list.innerHTML = state.deals.map(function (d) {
      return '<div class="deal-row">' +
        (d.image ? '<img class="deal-thumb" src="' + esc(d.image) + '" alt="">' : '<div class="deal-thumb" style="display:grid;place-items:center;color:var(--a-muted)">無圖</div>') +
        '<div><div class="deal-title">' + esc(d.title) + '</div><div class="deal-sub">' + esc(d.category || '') + ' · ' + esc(d.description || '').slice(0, 60) + '</div></div>' +
        '<div class="deal-price"><b>NZ$' + esc(d.salePrice) + '</b>' + (d.originalPrice ? '<span class="old">NZ$' + esc(d.originalPrice) + '</span>' : '') + '</div>' +
        '<span class="pill ' + esc(d.status) + '">' + (d.status === 'published' ? '已發布' : '草稿') + '</span>' +
        '<div class="row-actions">' +
          '<button class="text-button" data-act="edit" data-id="' + d.id + '">編輯</button>' +
          '<button class="text-button" data-act="preview" data-id="' + d.id + '">預覽</button>' +
          (d.status === 'published'
            ? '<button class="text-button" data-act="unpublish" data-id="' + d.id + '">下架</button>'
            : '<button class="text-button" data-act="publish" data-id="' + d.id + '">發布</button>') +
          '<button class="text-button" data-act="delete" data-id="' + d.id + '">刪除</button>' +
        '</div></div>';
    }).join('');
    list.querySelectorAll('button[data-act]').forEach(function (b) {
      b.addEventListener('click', function () { dealAction(b.dataset.act, b.dataset.id); });
    });
  }

  function findDeal(id) { return state.deals.filter(function (d) { return d.id === id; })[0]; }

  function dealAction(act, id) {
    var d = findDeal(id);
    if (!d) return;
    if (act === 'edit') { openDealDialog(d); }
    else if (act === 'preview') { openPreview(d); }
    else if (act === 'publish') {
      d.status = 'published'; d.publishedAt = now(); d.updatedAt = now();
      saveDeals(); var v = snapshotPublished();
      audit(currentUser().email, 'publish', '發布 deal「' + d.title + '」（v' + v + '）');
      toast('已發布（快照 v' + v + '）'); renderDeals();
    }
    else if (act === 'unpublish') {
      d.status = 'draft'; d.updatedAt = now();
      saveDeals(); var v = snapshotPublished();
      audit(currentUser().email, 'unpublish', '下架 deal「' + d.title + '」（v' + v + '）');
      toast('已下架'); renderDeals();
    }
    else if (act === 'delete') {
      if (!confirm('確定刪除「' + d.title + '」？')) return;
      state.deals = state.deals.filter(function (x) { return x.id !== id; });
      saveDeals(); snapshotPublished();
      audit(currentUser().email, 'delete', '刪除 deal「' + d.title + '」');
      renderDeals();
    }
  }

  function openDealDialog(d) {
    state.editingId = d ? d.id : null;
    state.imageData = d ? d.image : null;
    var form = document.getElementById('deal-form');
    form.reset();
    document.getElementById('dialog-title').textContent = d ? '編輯 deal' : '新增 promotion deal';
    form.id.value = d ? d.id : '';
    form.title.value = d ? d.title : '';
    form.category.value = d ? d.category : '南島團游';
    form.originalPrice.value = d ? d.originalPrice : '';
    form.salePrice.value = d ? d.salePrice : '';
    form.description.value = d ? d.description : '';
    form.featured.checked = d ? !!d.featured : true;
    updateImagePreview();
    document.getElementById('deal-dialog').showModal();
  }

  function updateImagePreview() {
    var box = document.getElementById('image-preview');
    if (state.imageData) {
      box.hidden = false;
      box.querySelector('img').src = state.imageData;
    } else { box.hidden = true; }
  }

  function onImagePicked(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast('僅支援 JPEG / PNG / WebP', true); return; }
    toast('自動裁切 16:10 …');
    autoCrop(file).then(function (dataUrl) {
      state.imageData = dataUrl;
      updateImagePreview();
      toast('圖片已自動裁切');
    }, function () { toast('圖片處理失敗', true); });
  }

  /* 自動裁切：cover 裁到 16:10，寬度上限 1200px */
  function autoCrop(file, maxW) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var ratio = 16 / 10, iw = img.naturalWidth, ih = img.naturalHeight;
        var sw, sh, sx, sy;
        if (iw / ih > ratio) { sh = ih; sw = ih * ratio; sx = (iw - sw) / 2; sy = 0; }
        else { sw = iw; sh = iw / ratio; sx = 0; sy = (ih - sh) / 2; }
        var w = Math.min(maxW || 1200, Math.floor(sw));
        var h = Math.round(w / ratio);
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
      img.src = url;
    });
  }

  function onDealSubmit(e) {
    e.preventDefault();
    var form = e.target;
    var title = form.title.value.trim();
    var sale = Number(form.salePrice.value);
    if (!title || !(sale >= 0)) { toast('請填寫標題與促銷價', true); return; }
    var nowIso = now();
    var existing = state.editingId ? findDeal(state.editingId) : null;
    var d = existing || { id: uid(), createdAt: nowIso, status: 'draft', publishedAt: null };
    d.title = title;
    d.category = form.category.value;
    d.originalPrice = Number(form.originalPrice.value) || 0;
    d.salePrice = sale;
    d.description = form.description.value.trim();
    d.image = state.imageData;
    d.featured = form.featured.checked;
    d.updatedAt = nowIso;
    if (!existing) state.deals.unshift(d);
    saveDeals();
    if (existing && existing.status === 'published') snapshotPublished();
    audit(currentUser().email, existing ? 'update' : 'create', '儲存 deal「' + d.title + '」' + (existing ? '' : '（草稿）'));
    document.getElementById('deal-dialog').close();
    toast(existing ? '已儲存' : '已建立草稿');
    renderDeals();
  }

  /* ---------------- preview / publish ---------------- */
  function dealCardHTML(d) {
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
      '<span class="go">查看详情 <span>→</span></span></div>' +
      '</div></a>';
  }

  function openPreview(d) {
    document.getElementById('deal-preview').innerHTML = dealCardHTML(d);
    document.getElementById('publish-deal').dataset.id = d.id;
    document.getElementById('preview-dialog').showModal();
  }
  document.getElementById('preview-deal').addEventListener('click', function () {
    var form = document.getElementById('deal-form');
    var title = form.title.value.trim(), sale = Number(form.salePrice.value);
    if (!title || !(sale >= 0)) { toast('請先填寫標題與促銷價', true); return; }
    var previewDeal = {
      title: title, category: form.category.value, originalPrice: Number(form.originalPrice.value) || 0,
      salePrice: sale, description: form.description.value.trim(), image: state.imageData
    };
    openPreview(previewDeal);
  });
  document.getElementById('publish-deal').addEventListener('click', function () {
    var id = this.dataset.id;
    document.getElementById('preview-dialog').close();
    if (!id || !findDeal(id)) { toast('請先儲存草稿再發布', true); return; }
    dealAction('publish', id);
  });

  /* ---------------- tours price adjust ---------------- */
  var tourCache = null;
  function renderTours() {
    var box = document.getElementById('tour-summary');
    if (!tourCache) {
      fetch('../tours.json').then(function (r) { return r.json(); }).then(function (data) {
        tourCache = data; renderTourRows(box);
      }).catch(function () { box.innerHTML = '<div class="empty-state">無法載入 tours.json</div>'; });
      return;
    }
    renderTourRows(box);
  }
  function renderTourRows(box) {
    var overrides = lsGet(LS.tourprices, {});
    box.innerHTML = '<div class="stats-row"><div class="stat"><b>' + tourCache.length + '</b><span>行程總數</span></div>' +
      '<div class="stat"><b>' + Object.keys(overrides).length + '</b><span>已調整價格</span></div></div>' +
      tourCache.map(function (t) {
        return '<div class="tour-row">' +
          '<div class="deal-title">' + esc(t.title) + '</div>' +
          '<label style="font-size:12px;color:var(--a-muted)">促銷價 NZD<input data-slug="' + esc(t.slug) + '" type="number" min="0" step="1" value="' + esc(overrides[t.slug] != null ? overrides[t.slug] : t.price.replace(/[^0-9]/g, '')) + '"></label>' +
          '<button class="admin-button save-tour" data-slug="' + esc(t.slug) + '">儲存</button>' +
          '</div>';
      }).join('');
    box.querySelectorAll('.save-tour').forEach(function (b) {
      b.addEventListener('click', function () {
        var slug = b.dataset.slug;
        var val = box.querySelector('input[data-slug="' + CSS.escape(slug) + '"]').value;
        var overrides = lsGet(LS.tourprices, {});
        if (val === '') { delete overrides[slug]; } else { overrides[slug] = val; }
        lsSet(LS.tourprices, overrides);
        audit(currentUser().email, 'price', '調整行程價格「' + slug + '」→ ' + (val || '恢復原價'));
        toast('已儲存，公開網站會套用');
        renderTours();
      });
    });
  }

  /* ---------------- users ---------------- */
  function renderUsers() {
    var u = currentUser();
    if (u.role !== 'admin') return;
    var list = document.getElementById('user-list');
    var users = getUsers();
    if (!users.length) { list.innerHTML = '<div class="empty-state">尚無帳號</div>'; return; }
    list.innerHTML = users.map(function (x) {
      return '<div class="user-row"><div class="user-meta"><b>' + esc(x.email) + '</b>' +
        '<span>' + (x.totpEnabled ? '2FA 已啟用' : '2FA 未啟用') + ' · 建立於 ' + fmtTime(x.createdAt) + '</span></div>' +
        '<span class="role-chip ' + esc(x.role) + '">' + (x.role === 'admin' ? '管理員' : '編輯') + '</span>' +
        '<div class="row-actions">' +
        '<button class="text-button" data-act="reset2fa" data-id="' + x.id + '">重設 2FA</button>' +
        '<button class="text-button" data-act="role" data-id="' + x.id + '">切換角色</button>' +
        (x.id === u.id ? '' : '<button class="text-button" data-act="deluser" data-id="' + x.id + '">刪除</button>') +
        '</div></div>';
    }).join('');
    list.querySelectorAll('button[data-act]').forEach(function (b) {
      b.addEventListener('click', function () { userAction(b.dataset.act, b.dataset.id); });
    });
  }

  function userAction(act, id) {
    var users = getUsers();
    var u = users.filter(function (x) { return x.id === id; })[0];
    if (!u) return;
    if (act === 'deluser') {
      if (!confirm('確定刪除帳號 ' + u.email + '？')) return;
      var admins = users.filter(function (x) { return x.role === 'admin' && x.id !== id; });
      if (!admins.length) { toast('至少需保留一位管理員', true); return; }
      saveUsers(users.filter(function (x) { return x.id !== id; }));
      audit(currentUser().email, 'user', '刪除帳號「' + u.email + '」');
      toast('帳號已刪除'); renderUsers();
    } else if (act === 'role') {
      var me = currentUser();
      if (u.id === me.id && u.role === 'admin') { toast('管理員不能降自己角色', true); return; }
      u.role = (u.role === 'admin') ? 'editor' : 'admin';
      saveUsers(users);
      audit(currentUser().email, 'user', '切換「' + u.email + '」角色為 ' + u.role);
      renderUsers();
    } else if (act === 'reset2fa') {
      var secret = window.ETTOTP.generateSecret();
      u.totpSecret = secret; u.totpEnabled = true;
      saveUsers(users);
      var msg = '新 2FA secret：' + secret + '\notpauth URI：\n' + window.ETTOTP.otpauthURI(u.email, secret) + '\n\n把這組 secret 交給 ' + u.email + ' 加入 Authenticator。';
      prompt('重設 2FA — 請複製 secret 給該帳號', msg);
      audit(currentUser().email, 'user', '重設「' + u.email + '」的 2FA');
      renderUsers();
    }
  }

  document.getElementById('new-user').addEventListener('click', function () {
    var email = prompt('新帳號 email：');
    if (!email) return;
    email = email.trim().toLowerCase();
    var users = getUsers();
    if (users.some(function (x) { return x.email === email; })) { toast('此 email 已存在', true); return; }
    var pw = prompt('初始密碼（至少 12 字元）：');
    if (!pw || pw.length < 12) { toast('密碼至少 12 字元', true); return; }
    var secret = window.ETTOTP.generateSecret();
    var salt = makeSalt();
    hashPassword(pw, salt).then(function (h) {
      users.push({ id: uid(), email: email, salt: salt, hash: h, role: 'editor', totpSecret: secret, totpEnabled: true, createdAt: now() });
      saveUsers(users);
      prompt('帳號已建立。2FA secret（請交給 ' + email + '）：', secret);
      audit(currentUser().email, 'user', '新增帳號「' + email + '」（editor）');
      renderUsers();
    });
  });

  /* ---------------- audit ---------------- */
  function renderAudit() {
    var list = document.getElementById('audit-list');
    var a = lsGet(LS.audit, []);
    if (!a.length) { list.innerHTML = '<div class="empty-state">尚無操作紀錄</div>'; return; }
    list.innerHTML = a.map(function (x) {
      return '<div class="audit-row"><span class="audit-time">' + esc(fmtTime(x.at)) + '</span>' +
        '<span class="audit-user">' + esc(x.user) + '</span>' +
        '<span class="audit-action">' + esc(x.action) + (x.detail ? ' — ' + esc(x.detail) : '') + '</span></div>';
    }).join('');
  }

  /* ---------------- wire up ---------------- */
  document.getElementById('logout').addEventListener('click', function () {
    var u = currentUser();
    if (u) audit(u.email, 'logout', '登出');
    clearSession();
    location.reload();
  });
  document.getElementById('confirm-totp').addEventListener('click', confirmTOTPSetup);
  document.getElementById('deal-image').addEventListener('change', function () { onImagePicked(this.files && this.files[0]); });
  document.getElementById('remove-image').addEventListener('click', function () {
    state.imageData = null;
    document.getElementById('deal-image').value = '';
    updateImagePreview();
  });
  document.getElementById('new-deal').addEventListener('click', function () { openDealDialog(null); });
  document.getElementById('deal-form').addEventListener('submit', onDealSubmit);
  document.querySelectorAll('[data-close-dialog]').forEach(function (b) {
    b.addEventListener('click', function () { var dl = b.closest('dialog'); if (dl) dl.close(); });
  });
  document.getElementById('deal-dialog').addEventListener('click', function (e) { if (e.target === this) this.close(); });
  document.getElementById('preview-dialog').addEventListener('click', function (e) { if (e.target === this) this.close(); });

  boot();
})();
