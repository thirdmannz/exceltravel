(function () {
  'use strict';
  var panel = document.getElementById('customer-cart');
  if (!panel) return;
  var busy = false;
  var authenticated = window.etAccountUser && window.etAccountUser.role === 'customer';
  var couponCode = '';
  var boundaryTimer;
  function call(method, body, path) {
    return fetch(path || '/api/cart', { method: method, cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': '1' }, body: body ? JSON.stringify(body) : undefined }).then(function (res) {
      return res.json().then(function (data) { if (!res.ok) throw new Error(data.error || 'Cart unavailable'); return data; });
    });
  }
  function load() {
    if (busy || !authenticated) return;
    busy = true;
    call('GET').then(function (data) {
      clearTimeout(boundaryTimer);
      if (data.nextCheckAt) boundaryTimer = setTimeout(load, Math.min(2147483647, Math.max(1, data.nextCheckAt - Date.now() + 10)));
      panel.replaceChildren();
      var title = document.createElement('h2'); title.textContent = 'Cart / 購物車'; panel.appendChild(title);
      data.removed.forEach(function (item) { var note = document.createElement('p'); note.textContent = item.slug + ': ' + item.reason; panel.appendChild(note); });
      if (!data.items.length) { var empty = document.createElement('p'); empty.textContent = 'Cart is empty / 購物車沒有行程'; panel.appendChild(empty); }
      data.items.forEach(function (item) {
        var row = document.createElement('div'); var text = document.createElement('p');
        text.textContent = item.title + ' · ' + item.quantity + ' · ' + (item.departureDate || '') + ' · NZ$ ' + (item.quote ? (item.quote.unitCents / 100).toFixed(2) : item.price == null ? 'Quote required' : item.price);
        var remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove / 移除';
        remove.addEventListener('click', function () { remove.disabled = true; call('DELETE', { slug: item.slug, departureDate: item.departureDate }).then(load).catch(function (e) { panel.textContent = e.message; }); });
        row.append(text, remove); panel.appendChild(row);
      });
      if (data.items.length) {
        var form = document.createElement('form'), label = document.createElement('label'), input = document.createElement('input'), preview = document.createElement('button'), result = document.createElement('div');
        label.textContent = 'Coupon / 優惠碼 '; input.name = 'couponCode'; input.value = couponCode; label.appendChild(input);
        preview.type = 'submit'; preview.textContent = 'Review quote / 查看報價'; form.append(label, preview); panel.append(form, result);
        form.addEventListener('submit', function (event) {
          event.preventDefault(); couponCode = input.value.trim().toUpperCase(); preview.disabled = true;
          call('POST', { couponCode: couponCode }, '/api/cart/quote').then(function (quote) {
            result.replaceChildren(); var text = document.createElement('p');
            text.textContent = 'Total / 總額 NZ$ ' + (quote.totalCents / 100).toFixed(2) + ' · Due now / 本次應付 NZ$ ' + (quote.dueNowCents / 100).toFixed(2) + ' · Balance / 餘額 NZ$ ' + (quote.balanceCents / 100).toFixed(2);
            var save = document.createElement('button'); save.type = 'button'; save.textContent = 'Save unpaid order / 儲存未付款預訂';
            var key = crypto.randomUUID();
            save.addEventListener('click', function () {
              save.disabled = true;
              call('POST', { couponCode: couponCode, quoteHash: quote.quoteHash, idempotencyKey: key }, '/api/orders').then(function (data) { result.textContent = data.order.id + ' · Payment disabled / 未啟用付款'; }).catch(function (error) { result.textContent = error.message; }).finally(function () { save.disabled = false; });
            });
            result.append(text, save);
          }).catch(function (error) { result.textContent = error.message; }).finally(function () { preview.disabled = false; });
        });
      }
      var history = document.createElement('div'); panel.appendChild(history);
      call('GET', undefined, '/api/orders').then(function (data) { data.orders.forEach(function (order) { var row = document.createElement('p'); row.textContent = order.id + ' · NZ$ ' + (order.totalCents / 100).toFixed(2) + ' · Payment disabled / 未啟用付款'; history.appendChild(row); }); }).catch(function () {});
      var notice = document.createElement('p'); notice.textContent = 'Online payment is not enabled. Please contact staff. / 線上付款未啟用，請聯絡客服。'; panel.appendChild(notice);
    }).catch(function (e) { panel.textContent = e.message; }).finally(function () { busy = false; });
  }
  var form = document.getElementById('cart-add-form');
  if (form) form.addEventListener('submit', function (event) {
    event.preventDefault();
    var button = form.querySelector('button'); button.disabled = true;
    call('POST', { slug: form.elements.slug.value, departureDate: form.elements.departureDate.value, quantity: Number(form.elements.quantity.value) }).then(load).catch(function (e) { panel.textContent = e.message; }).finally(function () { button.disabled = false; });
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  window.addEventListener('focus', load);
  setInterval(function () { if (!document.hidden) load(); }, 30000);
  document.addEventListener('et-account-ready', function (event) { authenticated = event.detail && event.detail.role === 'customer'; if (authenticated) load(); });
  if (authenticated) load();
})();
