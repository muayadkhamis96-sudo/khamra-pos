/* ============================================================
   Khamra POS — Application logic
   PIN gate · POS sale flow · reports · settings.
   Plain script (no modules) so it runs from file:// by double-click.
   ============================================================ */
(function () {
  'use strict';
  var D = window.Data;

  // ---- runtime state --------------------------------------------------
  var state = {
    lang: D.getSettings().lang || 'ar',
    route: 'sale',
    cat: 'all',
    cart: new Map(),       // id -> { p: product, qty }
    scope: 'today'         // reports scope: 'today' | 'all'
  };
  var pinBuffer = '';
  var PIN_LEN = 6;   // PIN length (digits)

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var el = function (tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  var t  = function (k) { return D.t(k, state.lang); };
  var icon = function (name) { return '<svg><use href="#i-' + name + '"/></svg>'; };
  var ICON_FOR = { cup:'cup', glass:'glass', flower:'flower', honey:'honey', roll:'roll', croissant:'croissant' };

  // "Powered by Futureline.ai" signature. Shows the official artwork:
  //   light bg (main page)  -> assets/futureline-sign.png
  //   dark bg (lock screen) -> assets/futureline-sign-light.png
  // Until those files exist, a recreated lockup is shown as a fallback.
  function flLockup() {
    return '<div class="fl-pb">POWERED BY</div>' +
      '<div class="fl-word">Futureline<span class="fl-ai">.ai</span></div>' +
      '<span class="fl-mark"><svg class="fl-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true">' +
        '<path d="M48 16C32 12 19 20 19 35c0 8 5 13 12 12" stroke="url(#flGrad)" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M24 32h20" stroke="url(#flGrad)" stroke-width="7.5" stroke-linecap="round"/>' +
      '</svg></span>';
  }
  function flSignatureHTML() {
    return '<img class="fl-img" src="assets/futureline-sign.png" alt="Powered by Futureline.ai" ' +
           'onerror="var s=this.closest(\'.fl-sign\'); if(s) s.classList.add(\'fl-fallback\'); this.remove();" />' +
           '<div class="fl-lockup">' + flLockup() + '</div>';
  }

  // =====================================================================
  // LANGUAGE / i18n
  // =====================================================================
  function applyLang() {
    var ar = state.lang === 'ar';
    document.documentElement.lang = state.lang;
    document.documentElement.dir = ar ? 'rtl' : 'ltr';
    document.body.lang = state.lang;
    // translate every [data-t]
    $$('[data-t]').forEach(function (n) { n.textContent = t(n.getAttribute('data-t')); });
    // lock screen — logo already carries the Arabic "شاي مختص", so the tagline
    // shows the English line (uppercase, letter-spaced) for a bilingual feel.
    $('#lockTagline').textContent = D.t('tagline', 'en');
    $('#lockTitle').textContent = t('enterPin');
    // lang toggle active
    $('#langAr').classList.toggle('on', ar);
    $('#langEn').classList.toggle('on', !ar);
    updateClock();
    renderRoute();      // re-render active page in new language
    renderCart();
  }

  function setLang(lang) {
    state.lang = lang;
    D.saveSettings({ lang: lang });
    applyLang();
  }

  // =====================================================================
  // PIN LOCK
  // =====================================================================
  function buildKeypad() {
    var pad = $('#keypad');
    var keys = ['1','2','3','4','5','6','7','8','9','spacer','0','back'];
    pad.innerHTML = '';
    keys.forEach(function (k) {
      if (k === 'spacer') { pad.appendChild(el('div')); return; }   // empty cell for alignment
      var b = el('button', 'key');
      if (k === 'back') { b.className = 'key back'; b.innerHTML = icon('back-del'); b.setAttribute('aria-label','delete'); }
      else { b.textContent = D.num(k, state.lang); b.dataset.k = k; }
      pad.appendChild(b);
    });
    pad.onclick = function (e) {
      var b = e.target.closest('.key'); if (!b) return;
      if (b.classList.contains('back')) { pinBuffer = pinBuffer.slice(0, -1); }
      else if (b.dataset.k != null) { if (pinBuffer.length < PIN_LEN) pinBuffer += b.dataset.k; }
      renderDots();
      if (pinBuffer.length === PIN_LEN) setTimeout(tryUnlock, 120);
    };
    // physical keyboard support
    document.addEventListener('keydown', function (e) {
      if (!$('#lock') || $('#lock').classList.contains('hidden')) return;
      if (/^[0-9]$/.test(e.key)) { if (pinBuffer.length < PIN_LEN) pinBuffer += e.key; renderDots(); if (pinBuffer.length === PIN_LEN) setTimeout(tryUnlock, 120); }
      else if (e.key === 'Backspace') { pinBuffer = pinBuffer.slice(0, -1); renderDots(); }
    });
  }
  function renderDots() {
    var dots = $('#pinDots'); dots.innerHTML = '';
    for (var i = 0; i < PIN_LEN; i++) { var d = el('span', 'pin-dot' + (i < pinBuffer.length ? ' on' : '')); dots.appendChild(d); }
  }
  var unlocking = false;
  function tryUnlock() {
    if (unlocking) return;
    unlocking = true;
    // The server verifies the PIN; with no connection the cached PIN still
    // opens the till (selling must survive an internet cut).
    D.login(pinBuffer, function (err, info) {
      unlocking = false;
      if (!err) {
        pinBuffer = ''; renderDots(); $('#lockErr').textContent = '';
        unlock();
        if (info && info.offline) toast(t('offlineMode'));
        return;
      }
      var lock = $('#lock'); lock.classList.add('shake');
      $('#lockErr').textContent = t(err === 'rateLimited' ? 'rateLimited' : 'wrongPin');
      setTimeout(function () { lock.classList.remove('shake'); pinBuffer = ''; renderDots(); }, 450);
    });
  }
  function lockApp() {
    $('#app').classList.remove('on');
    $('#lock').classList.remove('hidden');
    pinBuffer = ''; renderDots(); $('#lockErr').textContent = '';
  }
  function unlock() {
    $('#lock').classList.add('hidden');
    $('#app').classList.add('on');
    go(state.route);
  }

  // =====================================================================
  // ROUTER
  // =====================================================================
  function go(route) {
    state.route = route;
    $$('.nav-btn[data-route]').forEach(function (b) { b.classList.toggle('active', b.dataset.route === route); });
    $$('.page').forEach(function (p) { p.classList.add('hidden'); });
    $('#page-' + route).classList.remove('hidden');
    var titles = { sale: 'navSale', inventory: 'navInventory', reports: 'navReports', expenses: 'navExpenses', settings: 'navSettings' };
    $('#pageTitle').textContent = t(titles[route]);
    renderRoute();
  }
  function renderRoute() {
    if (state.route === 'sale') { renderCatTabs(); renderProducts(); $('#pageSub').textContent = D.t('tagline', state.lang); }
    else if (state.route === 'inventory') renderInventory();
    else if (state.route === 'reports') renderReports();
    else if (state.route === 'expenses') renderExpenses();
    else if (state.route === 'settings') renderSettings();
    updateSyncChip();
  }

  // =====================================================================
  // POS — SALE
  // =====================================================================
  function renderCatTabs() {
    var tabs = $('#catTabs'); tabs.innerHTML = '';
    [['all','all'], ['drinks','drinks'], ['sweets','sweets']].forEach(function (c) {
      var b = el('button', 'cat-tab' + (state.cat === c[0] ? ' on' : ''), t(c[1]));
      b.onclick = function () { state.cat = c[0]; renderCatTabs(); renderProducts(); };
      tabs.appendChild(b);
    });
  }
  function renderProducts() {
    var grid = $('#productGrid'); grid.innerHTML = '';
    var menu = D.getMenu().filter(function (p) {
      var complete = p.ar && String(p.ar).trim() && p.price > 0;   // hide half-added items
      return complete && (state.cat === 'all' || p.category === state.cat);
    });
    menu.forEach(function (p) {
      var inCart = state.cart.get(p.id);
      var tracked = (p.category === 'sweets' && typeof p.stock === 'number');
      var soldOut = tracked && p.stock <= 0;
      // Must be a <div>, not a <button>: iOS 12 Safari won't render the
      // absolutely-positioned photo inside a <button>. role/tabindex keep it
      // accessible and tappable.
      var card = el('div', 'card-product ' + p.category + (inCart ? ' in-cart' : '') + (p.photo ? ' has-photo' : '') + (soldOut ? ' sold-out' : ''));
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', soldOut ? '-1' : '0');
      // photo / icon
      var inner = p.photo
        ? '<img class="ph" src="' + p.photo + '" alt="" />'
        : '<span class="icn-fallback">' + icon(ICON_FOR[p.icon] || 'cup') + '</span>';
      // stock indicator (tracked sweets only)
      if (tracked && !soldOut) inner += '<span class="stock-tag">' + stockLeftLabel(p.stock) + '</span>';
      if (soldOut) inner += '<div class="soldout-ov"><span>' + t('soldOut') + '</span></div>';
      card.innerHTML =
        '<span class="badge-qty">' + (inCart ? D.num(inCart.qty, state.lang) : '') + '</span>' +
        '<div class="thumb' + (p.photo ? ' photo' : '') + '">' + inner + '</div>' +
        '<div class="meta">' +
          '<div class="name-ar">' + p.ar + '</div>' +
          '<div class="price">' + D.money(p.price, state.lang) + cur() + '</div>' +
        '</div>';
      card.dataset.id = p.id;
      if (!soldOut) {
        card.onclick = function () { addToCart(p); };
        card.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addToCart(p); } };
      }
      grid.appendChild(card);
    });
  }
  // "متبقي ٥" / "5 left" — label order follows the language.
  function stockLeftLabel(n) {
    return state.lang === 'ar'
      ? (t('stockLeft') + ' ' + D.num(n, state.lang))
      : (D.num(n, state.lang) + ' ' + t('stockLeft'));
  }
  // Lightweight in-place update of the cart badges — avoids rebuilding the whole
  // product grid (and re-loading all photos) on every tap, which lags old iPads.
  function updateCardBadges() {
    $$('#productGrid .card-product').forEach(function (card) {
      var e = state.cart.get(card.dataset.id);
      card.classList.toggle('in-cart', !!e);
      var b = card.querySelector('.badge-qty');
      if (b) b.textContent = e ? D.num(e.qty, state.lang) : '';
    });
  }
  function curLabel() { return state.lang === 'ar' ? 'ر.ع' : 'OMR'; }
  // New Omani Rial symbol shown next to prices. Inlined (works on file://) and
  // tinted to the adjacent price colour via fill:currentColor.
  function cur() {
    return '<svg class="omr" viewBox="0 0 1024 576" fill="currentColor" fill-rule="evenodd" role="img" aria-label="OMR">' +
      '<path d="M95 415 L215 300 L1015 300 L895 415 Z"/>' +
      '<path d="M30 565 L150 450 L950 450 L830 565 Z"/>' +
      '<path d="M384 300 C368 188 396 52 474 24 C522 4 596 14 622 64 C652 116 640 184 604 222 C578 258 598 280 616 300 Z M470 292 C452 196 486 100 532 96 C578 92 596 150 574 206 C554 254 512 290 470 292 Z"/>' +
      '</svg>';
  }

  function isCompact() { return window.matchMedia('(max-width: 860px)').matches; }
  function openSheet(open) { var o = $('.order'); if (o) o.classList.toggle('open', open !== false); }

  // For a tracked sweet, you can't add more than the remaining stock.
  function stockCap(id) {
    var m = menuItem(id);
    return (m && m.category === 'sweets' && typeof m.stock === 'number') ? m.stock : Infinity;
  }
  function addToCart(p) {
    var e = state.cart.get(p.id);
    var cap = stockCap(p.id);
    if (cap <= 0) { toast(t('outOfStockToast')); return; }
    if ((e ? e.qty : 0) >= cap) { toast(t('noMoreStock')); return; }
    if (e) e.qty += 1; else state.cart.set(p.id, { p: p, qty: 1 });
    updateCardBadges(); renderCart();
    if (isCompact()) openSheet(true);   // reveal the order on small screens
  }
  function changeQty(id, delta) {
    var e = state.cart.get(id); if (!e) return;
    if (delta > 0 && e.qty >= stockCap(id)) { toast(t('noMoreStock')); return; }
    e.qty += delta;
    if (e.qty <= 0) state.cart.delete(id);
    updateCardBadges(); renderCart();
  }
  function clearCart() { state.cart.clear(); updateCardBadges(); renderCart(); openSheet(false); }

  function cartTotal() {
    var sum = 0; state.cart.forEach(function (e) { sum += e.p.price * e.qty; }); return sum;
  }
  function renderCart() {
    var wrap = $('#orderItems'); if (!wrap) return;
    wrap.innerHTML = '';
    if (state.cart.size === 0) {
      var empty = el('div', 'order-empty');
      empty.innerHTML = '<svg><use href="#i-empty"/></svg><div>' + t('emptyOrder') + '</div>';
      wrap.appendChild(empty);
    } else {
      state.cart.forEach(function (e) {
        var row = el('div', 'line');
        row.innerHTML =
          '<div class="l-name"><div class="a">' + e.p.ar + '</div><div class="b">' + e.p.en + '</div></div>' +
          '<div class="l-price">' + D.money(e.p.price * e.qty, state.lang) + cur() + '</div>' +
          '<div class="stepper"><button data-d="-1">−</button><span class="q">' + D.num(e.qty, state.lang) + '</span><button data-d="1">+</button></div>';
        row.querySelector('[data-d="-1"]').onclick = function () { changeQty(e.p.id, -1); };
        row.querySelector('[data-d="1"]').onclick  = function () { changeQty(e.p.id, 1); };
        wrap.appendChild(row);
      });
    }
    var total = cartTotal();
    var totalHTML = D.money(total, state.lang) + cur();
    $('#grandTotal').innerHTML = totalHTML;
    var ht = $('#headTotal'); if (ht) ht.innerHTML = state.cart.size ? totalHTML : '';
    $('#chargeAmt').innerHTML = D.money(total, state.lang) + cur();
    $('#chargeBtn').disabled = state.cart.size === 0;
    $('#clearOrderBtn').classList.toggle('hidden', state.cart.size === 0);
  }

  // ----- payment modal -----
  function openPayment() {
    if (state.cart.size === 0) return;
    var total = cartTotal();
    openModal(
      '<div class="m-sub">' + t('choosePayment') + '</div>' +
      '<div class="m-total">' + D.money(total, state.lang) + cur() + '</div>' +
      '<div class="pay-opts">' +
        '<button class="pay-opt" data-m="cash">' + icon('cash') + '<span>' + t('payCash') + '</span></button>' +
        '<button class="pay-opt" data-m="card">' + icon('card') + '<span>' + t('payCard') + '</span></button>' +
      '</div>' +
      '<button class="btn btn-ghost" id="payCancel" style="width:100%">' + t('cancel') + '</button>'
    );
    $$('.pay-opt', $('#modal')).forEach(function (b) { b.onclick = function () { completeSale(b.dataset.m); }; });
    $('#payCancel').onclick = closeModal;
  }
  function completeSale(method) {
    var items = [];
    state.cart.forEach(function (e) { items.push({ id: e.p.id, ar: e.p.ar, en: e.p.en, price: e.p.price, qty: e.qty }); });
    var rec = D.recordSale({ items: items, total: cartTotal(), method: method });
    showSuccess(rec);
    clearCart();
    renderProducts();   // reflect decremented sweet stock / sold-out
  }
  function showSuccess(rec) {
    openModal(
      '<div class="success-mark draw"><svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><circle cx="28" cy="28" r="25.5"/><path d="M16 29l8 8 16-18"/></svg></div>' +
      '<h2>' + t('saleDone') + '</h2>' +
      '<div class="m-sub">' + t('orderNo') + ' #' + D.num(rec.no, state.lang) + ' · ' + D.money(rec.total, state.lang) + cur() + '</div>' +
      '<button class="btn btn-primary" id="newOrderBtn" style="width:100%">' + t('newOrder') + '</button>'
    );
    $('#newOrderBtn').onclick = closeModal;
    setTimeout(function () { if ($('#modalBg').classList.contains('on')) closeModal(); }, 2600);
  }

  // =====================================================================
  // INVENTORY (sweets only)
  // =====================================================================
  function renderInventory() {
    var page = $('#page-inventory');
    $('#pageSub').textContent = t('sweets');
    var sweets = D.getMenu().filter(function (p) {
      return p.category === 'sweets' && p.ar && String(p.ar).trim() && p.price > 0;
    });
    var html = '<div class="settings-wrap">';
    html += '<div class="inv-note">' + icon('box') + '<span>' + t('inventoryHint') + '</span></div>';
    html += '<div class="inv-list">';
    sweets.forEach(function (p) {
      var tracked = typeof p.stock === 'number';
      var status = !tracked
        ? '<span class="inv-status unl">' + t('unlimited') + '</span>'
        : (p.stock <= 0
            ? '<span class="inv-status out">' + t('soldOut') + '</span>'
            : '<span class="inv-status ok">' + t('inStock') + ': ' + D.num(p.stock, state.lang) + '</span>');
      var thumb = p.photo
        ? '<span class="inv-thumb"><img src="' + p.photo + '" alt="" /></span>'
        : '<span class="inv-thumb fallback">' + icon(ICON_FOR[p.icon] || 'cup') + '</span>';
      html += '<div class="inv-row" data-id="' + p.id + '">' +
        thumb +
        '<div class="inv-info"><div class="a">' + p.ar + '</div><div class="b">' + p.en + '</div>' + status + '</div>' +
        '<div class="inv-ctrl">' +
          '<button class="inv-btn" data-d="-1" aria-label="minus">−</button>' +
          '<input class="inv-num" type="number" inputmode="numeric" min="0" step="1" value="' + (tracked ? p.stock : '') + '" placeholder="∞" />' +
          '<button class="inv-btn" data-d="1" aria-label="plus">+</button>' +
          '<button class="inv-unl btn btn-ghost">' + t('setUnlimited') + '</button>' +
        '</div>' +
      '</div>';
    });
    if (!sweets.length) html += '<div class="empty-state"><svg><use href="#i-box"/></svg><div>' + t('noSales') + '</div></div>';
    html += '</div></div>';
    page.innerHTML = html;

    $$('.inv-row', page).forEach(function (row) {
      var id = row.dataset.id;
      var input = $('.inv-num', row);
      // Stock counts live on the server (they're shared across devices);
      // a failed call re-renders from the cache so the UI never lies.
      var pushStock = function (val) {
        D.setStockRemote(id, val, function (err) {
          if (err) toast(t('needsConnection'), true);
          afterStockChange();
        });
      };
      input.onchange = function () {
        var v = input.value.trim();
        pushStock(v === '' ? null : parseInt(v, 10));
      };
      $$('.inv-btn', row).forEach(function (b) {
        b.onclick = function () {
          var m = menuItem(id);
          var curv = (m && typeof m.stock === 'number') ? m.stock : 0;
          pushStock(Math.max(0, curv + (+b.dataset.d)));
        };
      });
      $('.inv-unl', row).onclick = function () { pushStock(null); };
    });
  }
  // Re-render inventory + the sale grid so stock changes reflect immediately on the POS.
  function afterStockChange() { renderInventory(); renderProducts(); }

  // =====================================================================
  // REPORTS
  // =====================================================================
  // scope: 'today' | 'all' | a dayKey (YYYY-MM-DD) selected from the chart
  function scopeKey() {
    if (state.scope === 'all') return null;
    return state.scope === 'today' ? D.dayKey() : state.scope;
  }
  function renderReports(fromSync) {
    var page = $('#page-reports');
    var key = scopeKey();
    // Paint instantly from the cache, then pull the server's truth (other
    // devices may have sold) and repaint only if something actually changed.
    if (!fromSync) D.refreshSales(function (err, changed) {
      if (!err && changed && state.route === 'reports') renderReports(true);
    });
    var s = key ? D.statsForDay(key) : D.allTime();
    $('#pageSub').textContent = scopeLabel();

    var html = '';
    // scope toggle + export (the file covers whatever scope is on screen)
    html += '<div class="rep-head">' +
      '<div class="lang-toggle">' +
        '<button data-scope="today" class="' + (state.scope === 'today' ? 'on' : '') + '">' + t('today') + '</button>' +
        '<button data-scope="all" class="' + (state.scope === 'all' ? 'on' : '') + '">' + t('allTime') + '</button>' +
      '</div>' +
      '<button class="btn btn-ghost" id="dlReport">' + t('downloadExcel') + '</button>' +
    '</div>';

    // stat cards
    html += '<div class="stat-grid">' +
      statCard('hero', 'coins', t('revenue'), D.money(s.revenue, state.lang), cur()) +
      statCard('', 'receipt', t('orders'), D.num(s.orders, state.lang), '') +
      statCard('', 'stack', t('itemsSold'), D.num(s.items, state.lang), '') +
      statCard('', 'avg', t('avgOrder'), D.money(s.avg, state.lang), cur()) +
    '</div>';

    html += '<div class="panels">';
    // left: chart + best sellers
    html += '<div style="display:flex;flex-direction:column;gap:18px">';
    html += chartPanel();
    html += sellersPanel(s);
    html += '</div>';
    // right: top product + recent
    html += '<div style="display:flex;flex-direction:column;gap:18px">';
    html += topPanel(s);
    html += recentPanel();
    html += '</div>';
    html += '</div>';

    page.innerHTML = html;
    $$('[data-scope]', page).forEach(function (b) { b.onclick = function () { state.scope = b.dataset.scope; renderReports(); }; });
    $('#dlReport').onclick = downloadWorkbook;
    // tap a day in the chart to view that day's full report
    $$('.bar-col[data-day]', page).forEach(function (b) {
      var pick = function () { var k = b.dataset.day; state.scope = (k === D.dayKey()) ? 'today' : k; renderReports(); };
      b.onclick = pick;
      b.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    });
    $$('.orow .del', page).forEach(function (b) {
      b.onclick = function () {
        D.deleteSaleRemote(b.dataset.id, function (err) {
          if (err) { toast(t('needsConnection'), true); return; }
          renderReports(true); toast(t('saved'));
        });
      };
    });
  }
  function statCard(mod, ic, k, v, cur) {
    return '<div class="stat ' + mod + '">' +
      '<div class="ico">' + icon(ic) + '</div>' +
      '<div class="k">' + k + '</div>' +
      '<div class="v">' + v + (cur ? ' ' + cur : '') + '</div>' +
    '</div>';
  }
  function chartPanel() {
    var days = D.lastDays(7);
    var max = Math.max.apply(null, days.map(function (d) { return d.revenue; }).concat([0.001]));
    var todayKey = D.dayKey();
    var selKey = scopeKey();   // null when scope = all
    var bars = days.map(function (d) {
      var h = Math.max(4, Math.round(d.revenue / max * 140));
      var isToday = d.key === todayKey;
      var isSel = d.key === selKey;
      var label = d.date.toLocaleDateString(state.lang === 'ar' ? 'ar' : 'en-GB', { weekday: 'short' });
      var val = d.revenue > 0 ? '<span class="bv">' + D.money(d.revenue, state.lang) + '</span>' : '';
      return '<div class="bar-col' + (isToday ? ' today' : '') + (isSel ? ' selected' : '') + '" data-day="' + d.key + '" role="button" tabindex="0">' +
        '<div class="bar-wrap"><div class="bar' + (isToday ? ' today' : '') + (isSel ? ' selected' : '') + '" style="height:' + h + 'px">' + val + '</div></div>' +
        '<div class="bd">' + label + '</div>' +
      '</div>';
    }).join('');
    return '<div class="panel"><h3>' + t('last7') + '<span class="tag">' + t('tapDayHint') + '</span></h3><div class="chart">' + bars + '</div></div>';
  }
  function sellersPanel(s) {
    if (!s.products.length) return panelEmpty(t('bestSellers'));
    var max = s.products[0].qty || 1;
    var rows = s.products.slice(0, 6).map(function (p, i) {
      var m = menuItem(p.id);
      var rIco = icon(m ? (ICON_FOR[m.icon] || 'cup') : 'cup');
      var rImg = (m && m.photo) ? '<img src="' + m.photo + '" alt="" onerror="this.remove()" />' : '';
      var th = '<span class="rank-th">' + rIco + rImg + '</span>';
      return '<div class="rank">' +
        '<div class="pos">' + D.num(i + 1, state.lang) + '</div>' +
        th +
        '<div class="info"><div class="a">' + p.ar + '</div><div class="b">' + p.en + '</div></div>' +
        '<div class="meter"><i style="width:' + Math.round(p.qty / max * 100) + '%"></i></div>' +
        '<div class="qty">' + D.num(p.qty, state.lang) + ' <small>' + t('sold') + '</small></div>' +
      '</div>';
    }).join('');
    return '<div class="panel"><h3>' + t('bestSellers') + '</h3>' + rows + '</div>';
  }
  function topPanel(s) {
    // No standout while sales are tied — show a neutral state instead of
    // arbitrarily crowning one product.
    if (!s.top) {
      if (s.tie) {
        return '<div class="panel"><h3>' + t('topProduct') + '<span class="tag">' + icon('avg') + '</span></h3>' +
          '<div class="empty-state"><svg><use href="#i-avg"/></svg>' +
          '<div style="font-weight:700;color:var(--ink-soft)">' + t('noStandout') + '</div>' +
          '<div style="font-size:13px;margin-top:4px">' + t('tiedSales') + '</div></div></div>';
      }
      return panelEmpty(t('topProduct'));
    }
    var p = s.top;
    var m = menuItem(p.id);
    var medalImg = (m && m.photo) ? '<img src="' + m.photo + '" alt="" onerror="this.remove()" />' : '';
    var medal = '<div class="top-photo"><span class="tp-ico">' + icon(starIconFor(p.id)) + '</span>' + medalImg + '</div>';
    return '<div class="panel" style="background:linear-gradient(150deg,#fbf4e8,#f7ead4)">' +
      '<h3>' + t('topProduct') + '<span class="tag">' + icon('star') + '</span></h3>' +
      '<div style="display:flex;align-items:center;gap:16px">' +
        medal +
        '<div><div style="font-family:var(--font-ar);font-weight:800;font-size:24px;color:var(--brown)">' + p.ar + '</div>' +
        '<div style="color:var(--muted);font-size:13px">' + p.en + '</div></div>' +
      '</div>' +
      '<div style="display:flex;gap:24px;margin-top:18px">' +
        '<div><div style="color:var(--muted);font-size:12px;font-weight:700">' + t('sold') + '</div><div style="font-family:var(--font-display);font-weight:600;font-size:30px;color:var(--ink)">' + D.num(p.qty, state.lang) + '</div></div>' +
        '<div><div style="color:var(--muted);font-size:12px;font-weight:700">' + t('revenue') + '</div><div style="font-family:var(--font-display);font-weight:600;font-size:30px;color:var(--ink)">' + D.money(p.revenue, state.lang) + ' ' + cur() + '</div></div>' +
      '</div>' +
    '</div>';
  }
  function menuItem(id) { return D.getMenu().filter(function (x) { return x.id === id; })[0] || null; }
  function starIconFor(id) {
    var m = menuItem(id);
    return m ? (ICON_FOR[m.icon] || 'cup') : 'cup';
  }
  function recentPanel() {
    var key = scopeKey();   // null when scope = all
    var all = D.getSales().slice().reverse();
    var sales = (key ? all.filter(function (s) { return s.day === key; }) : all).slice(0, 12);
    if (!sales.length) return panelEmpty(t('recentOrders'));
    var rows = sales.map(function (s) {
      var desc = s.items.map(function (i) { return (state.lang === 'ar' ? i.ar : i.en) + (i.qty > 1 ? '×' + D.num(i.qty, state.lang) : ''); }).join('، ');
      var when = new Date(s.ts).toLocaleTimeString(state.lang === 'ar' ? 'ar' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
      return '<div class="orow">' +
        '<div class="no">#' + D.num(s.no, state.lang) + '</div>' +
        '<div class="desc">' + desc + '</div>' +
        '<span class="meth ' + s.method + '">' + t(s.method) + '</span>' +
        '<div class="when">' + when + '</div>' +
        '<div class="amt">' + D.money(s.total, state.lang) + cur() + '</div>' +
        '<button class="del" data-id="' + s.id + '">' + icon('trash') + '</button>' +
      '</div>';
    }).join('');
    return '<div class="panel"><h3>' + t('recentOrders') + '</h3><div class="orders-list">' + rows + '</div></div>';
  }
  function panelEmpty(title) {
    return '<div class="panel"><h3>' + title + '</h3><div class="empty-state"><svg><use href="#i-empty"/></svg><div>' + t('noSales') + '</div></div></div>';
  }
  function todayLabel() {
    return new Date().toLocaleDateString(state.lang === 'ar' ? 'ar' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function dayLabel(key) {
    var p = String(key).split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.toLocaleDateString(state.lang === 'ar' ? 'ar' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function scopeLabel() {
    return state.scope === 'all' ? t('allTime')
      : (state.scope === 'today' ? todayLabel() : dayLabel(scopeKey()));
  }

  // Full sales report as an Excel-openable file (HTML table saved as .xls).
  // Covers whatever scope the screen is showing: key = a dayKey, or null = all
  // time. Unlike the on-screen "recent orders" panel this lists every order.
  // Amounts are written as plain numbers (English digits) so Excel can sum them.
  // =====================================================================
  // EXCEL EXPORT — one workbook, three sheets, always the FULL history
  // Overview · Revenue (detailed) · Expenses (detailed). Both download
  // buttons produce this same book, so nothing is ever scoped away: the old
  // export followed the on-screen period and only ever listed 7 days.
  // =====================================================================

  // Roll every sale up per day and per month in a single pass.
  function salesRollup(sales) {
    var days = {}, months = {}, dayList = [], monthList = [];
    sales.forEach(function (s) {
      var d = days[s.day];
      if (!d) { d = days[s.day] = { key: s.day, orders: 0, items: 0, cash: 0, card: 0, revenue: 0 }; dayList.push(d); }
      d.orders++; d.items += s.count || 0; d.revenue += s.total;
      if (s.method === 'card') d.card += s.total; else d.cash += s.total;

      var mk = D.monthOf(s.day), m = months[mk];
      if (!m) { m = months[mk] = { key: mk, orders: 0, revenue: 0, expenses: 0 }; monthList.push(m); }
      m.orders++; m.revenue += s.total;
    });
    dayList.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    monthList.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    return { days: dayList, months: months, monthList: monthList };
  }

  function weekdayOf(dayKey) {
    var p = String(dayKey).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2])
      .toLocaleDateString(state.lang === 'ar' ? 'ar' : 'en-GB', { weekday: 'long' });
  }
  function sectionRow(title, span) {
    var row = [cTxt(title, ST.sect)];
    for (var i = 1; i < (span || 1); i++) row.push(cTxt('', ST.sect));   // paint the whole band
    return row;
  }
  function headRow(labels) {
    return labels.map(function (l) { return cTxt(l, ST.head); });
  }

  function buildWorkbook() {
    var sales = D.getSales().slice().sort(function (a, b) { return a.ts - b.ts; });
    var exps = D.getExpenses().slice().sort(function (a, b) { return a.ts - b.ts; });
    var all = D.allTime();
    var roll = salesRollup(sales);
    var expTotal = exps.reduce(function (a, e) { return a + (e.amount || 0); }, 0);
    var stamp = new Date().toLocaleString(state.lang === 'ar' ? 'ar' : 'en-GB');
    var OMR = ' (OMR)';

    // expenses per month + per category, and fold the month totals into the rollup
    var byCat = {}, catList = [];
    exps.forEach(function (e) {
      var mk = D.monthOf(e.day), m = roll.months[mk];
      if (!m) { m = roll.months[mk] = { key: mk, orders: 0, revenue: 0, expenses: 0 }; roll.monthList.push(m); }
      m.expenses += e.amount || 0;
      var c = byCat[e.category];
      if (!c) { c = byCat[e.category] = { key: e.category, count: 0, total: 0 }; catList.push(c); }
      c.count++; c.total += e.amount || 0;
    });
    roll.monthList.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    catList.sort(function (a, b) { return b.total - a.total; });

    // ---- Sheet 1: Overview ---------------------------------------------
    var ov = [];
    ov.push([cTxt('Khamra — ' + t('navReports'), ST.title)]);
    ov.push([cTxt(t('generatedOn')), cTxt(stamp)]);
    ov.push([cTxt(t('period')), cTxt(sales.length ? (roll.days[0].key + '  →  ' + roll.days[roll.days.length - 1].key) : t('noSales'))]);
    ov.push([]);
    ov.push(sectionRow(t('summary'), 5));
    [[t('revenue') + OMR, cMny(all.revenue, true)],
     [t('orders'), cNum(all.orders)],
     [t('itemsSold'), cNum(all.items)],
     [t('avgOrder') + OMR, cMny(all.avg)],
     [t('cash') + OMR, cMny(all.cash)],
     [t('card') + OMR, cMny(all.card)],
     [t('totalExpenses') + OMR, cMny(expTotal)]
    ].forEach(function (r) { ov.push([cTxt(r[0]), r[1]]); });
    ov.push([cTxt(t('netProfit') + OMR, ST.bold), cMny(all.revenue - expTotal, true)]);
    ov.push([]);

    ov.push(sectionRow(t('byMonth'), 5));
    ov.push(headRow([t('monthLabel'), t('orders'), t('revenue') + OMR, t('totalExpenses') + OMR, t('netProfit') + OMR]));
    roll.monthList.forEach(function (m) {
      ov.push([cTxt(m.key), cNum(m.orders), cMny(m.revenue), cMny(m.expenses), cMny(m.revenue - m.expenses)]);
    });
    if (!roll.monthList.length) ov.push([cTxt(t('noSales'))]);
    ov.push([]);

    ov.push(sectionRow(t('bestSellers'), 5));
    ov.push(headRow([t('rank'), t('product') + ' (AR)', t('product') + ' (EN)', t('qty'), t('revenue') + OMR]));
    all.products.forEach(function (p, i) {
      ov.push([cNum(i + 1), cTxt(p.ar), cTxt(p.en), cNum(p.qty), cMny(p.revenue)]);
    });
    if (!all.products.length) ov.push([cTxt(t('noSales'))]);

    // ---- Sheet 2: Revenue (detailed) -----------------------------------
    var rv = [];
    rv.push([cTxt('Khamra — ' + t('sheetRevenue'), ST.title)]);
    rv.push([cTxt(t('generatedOn')), cTxt(stamp)]);
    rv.push([]);
    rv.push(sectionRow(t('dailyTotals'), 7));
    rv.push(headRow([t('expDate'), t('weekday'), t('orders'), t('itemsSold'), t('cash') + OMR, t('card') + OMR, t('revenue') + OMR]));
    roll.days.forEach(function (d) {
      rv.push([cTxt(d.key), cTxt(weekdayOf(d.key)), cNum(d.orders), cNum(d.items), cMny(d.cash), cMny(d.card), cMny(d.revenue)]);
    });
    if (!roll.days.length) rv.push([cTxt(t('noSales'))]);
    else rv.push([cTxt(t('grandTotal'), ST.bold), null, cNum(all.orders), cNum(all.items),
                  cMny(all.cash, true), cMny(all.card, true), cMny(all.revenue, true)]);
    rv.push([]);

    rv.push(sectionRow(t('allOrders'), 10));
    rv.push(headRow([t('orderNo'), t('expDate'), t('time'), t('paymentMethod'), t('product') + ' (AR)',
                     t('product') + ' (EN)', t('qty'), t('unitPrice') + OMR, t('lineTotal') + OMR, t('orderTotal') + OMR]));
    sales.forEach(function (sale) {
      var time = new Date(sale.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      sale.items.forEach(function (it, i) {
        // Order total only on the first line, so summing the column stays correct.
        rv.push([cNum(sale.no), cTxt(sale.day), cTxt(time), cTxt(t(sale.method)),
                 cTxt(it.ar), cTxt(it.en), cNum(it.qty), cMny(it.price), cMny(it.price * it.qty),
                 i === 0 ? cMny(sale.total) : null]);
      });
    });
    if (!sales.length) rv.push([cTxt(t('noSales'))]);
    else rv.push([cTxt(t('grandTotal'), ST.bold), null, null, null, null, null, null, null, null, cMny(all.revenue, true)]);

    // ---- Sheet 3: Expenses (detailed) ----------------------------------
    var ex = [];
    ex.push([cTxt('Khamra — ' + t('navExpenses'), ST.title)]);
    ex.push([cTxt(t('generatedOn')), cTxt(stamp)]);
    ex.push([]);
    ex.push(sectionRow(t('summary'), 4));
    ex.push([cTxt(t('revenue') + OMR), cMny(all.revenue)]);
    ex.push([cTxt(t('totalExpenses') + OMR), cMny(expTotal)]);
    ex.push([cTxt(t('netProfit') + OMR, ST.bold), cMny(all.revenue - expTotal, true)]);
    ex.push([]);

    ex.push(sectionRow(t('byCategory'), 4));
    ex.push(headRow([t('category'), t('count'), t('amount') + OMR]));
    catList.forEach(function (c) { ex.push([cTxt(catLabel(c.key)), cNum(c.count), cMny(c.total)]); });
    if (!catList.length) ex.push([cTxt(t('noExpenses'))]);
    ex.push([]);

    ex.push(sectionRow(t('byMonth'), 4));
    ex.push(headRow([t('monthLabel'), t('totalExpenses') + OMR]));
    roll.monthList.forEach(function (m) { if (m.expenses) ex.push([cTxt(m.key), cMny(m.expenses)]); });
    ex.push([]);

    ex.push(sectionRow(t('allExpenses'), 4));
    ex.push(headRow([t('expDate'), t('category'), t('expDesc'), t('amount') + OMR]));
    exps.forEach(function (e) {
      ex.push([cTxt(e.day), cTxt(catLabel(e.category)), cTxt(e.desc), cMny(e.amount || 0)]);
    });
    if (!exps.length) ex.push([cTxt(t('noExpenses'))]);
    else ex.push([cTxt(t('grandTotal'), ST.bold), null, null, cMny(expTotal, true)]);

    return buildXlsx([
      { name: t('sheetOverview'), rows: ov, widths: [26, 22, 22, 18, 18] },
      { name: t('sheetRevenue'),  rows: rv, widths: [10, 13, 9, 13, 22, 22, 8, 13, 13, 13] },
      { name: t('navExpenses'),   rows: ex, widths: [16, 18, 34, 16] }
    ]);
  }

  // Pull the server's copy first so the workbook covers every device, then
  // download. A dead connection must not leave the booth staring at nothing,
  // so the refresh gets a short leash and we fall back to the local cache —
  // which holds the same data the screen is showing anyway.
  function downloadWorkbook() {
    toast(t('preparingFile'));
    var done = false;
    var emit = function () {
      if (done) return;
      done = true;
      download('khamra-report-' + D.dayKey() + '.xlsx', buildWorkbook(),
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    };
    setTimeout(emit, 6000);
    D.refreshSales(function () { D.refreshExpenses(emit); });
  }

  // =====================================================================
  // EXPENSES
  // =====================================================================
  function currentMonth() { return D.monthOf(D.dayKey()); }
  function monthLabelText(mk) {
    if (mk === 'all') return t('allTime');
    var p = String(mk).split('-'); var d = new Date(+p[0], +p[1] - 1, 1);
    return d.toLocaleDateString(state.lang === 'ar' ? 'ar' : 'en-GB', { month: 'long', year: 'numeric' });
  }
  function catLabel(cat) {
    return (cat === 'salary' || cat === 'rent' || cat === 'goods' || cat === 'other') ? t('cat_' + cat) : String(cat);
  }
  function catOptions(sel) {
    var defs = ['salary', 'rent', 'goods', 'other'];
    var out = defs.map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + t('cat_' + k) + '</option>'; });
    D.getExpenseCats().forEach(function (c) { out.push('<option value="' + escapeAttr(c) + '"' + (c === sel ? ' selected' : '') + '>' + escapeAttr(c) + '</option>'); });
    if (sel && defs.indexOf(sel) === -1 && D.getExpenseCats().indexOf(sel) === -1) out.push('<option value="' + escapeAttr(sel) + '" selected>' + escapeAttr(sel) + '</option>');
    return out.join('');
  }

  function renderExpenses(fromSync) {
    var page = $('#page-expenses');
    if (!state.expMonth) state.expMonth = currentMonth();
    // Cache paints first; the server's copy follows if it differs.
    if (!fromSync) D.refreshExpenses(function (err, changed) {
      if (!err && changed && state.route === 'expenses') renderExpenses(true);
    });
    var mk = state.expMonth === 'all' ? null : state.expMonth;
    var fin = D.finance(mk);
    $('#pageSub').textContent = state.expMonth === 'all' ? t('allTime') : monthLabelText(state.expMonth);

    var months = D.expenseMonths();
    var html = '<div class="settings-wrap">';

    // month selector
    html += '<div class="field" style="max-width:300px;margin-bottom:18px"><label>' + t('monthLabel') + '</label><select id="expMonthSel">' +
      months.map(function (m) { return '<option value="' + m + '"' + (m === state.expMonth ? ' selected' : '') + '>' + monthLabelText(m) + '</option>'; }).join('') +
      '<option value="all"' + (state.expMonth === 'all' ? ' selected' : '') + '>' + t('allTime') + '</option>' +
    '</select></div>';

    // revenue / expenses / net profit
    html += '<div class="stat-grid fin-grid">' +
      statCard('', 'coins', t('revenue'), D.money(fin.revenue, state.lang), cur()) +
      statCard('', 'wallet', t('totalExpenses'), D.money(fin.expenses, state.lang), cur()) +
      '<div class="stat hero"><div class="ico">' + icon('coins') + '</div><div class="k">' + t('netProfit') + '</div>' +
        '<div class="v" style="color:' + (fin.profit >= 0 ? '#c7ecc9' : '#f3b3a4') + '">' + D.money(fin.profit, state.lang) + ' ' + cur() + '</div></div>' +
    '</div>';

    // expenses list for the selected scope
    var exps = D.getExpenses().filter(function (e) { return !mk || D.monthOf(e.day) === mk; }).sort(function (a, b) { return b.ts - a.ts; });
    html += '<div class="set-card"><h3>' + t('navExpenses') + '</h3><p class="hint">' + t('expensesHint') + '</p>' +
      '<div class="exp-head exp-row"><span>' + t('expDate') + '</span><span>' + t('category') + '</span><span>' + t('expDesc') + '</span><span>' + t('amount') + '</span><span></span></div>' +
      '<div class="exp-list" id="expList">';
    if (!exps.length) html += '<div class="empty-state" style="padding:26px 0"><div>' + t('noExpenses') + '</div></div>';
    else exps.forEach(function (e) {
      html += '<div class="exp-row" data-id="' + e.id + '">' +
        '<input type="date" data-f="day" value="' + e.day + '" />' +
        '<select data-f="category">' + catOptions(e.category) + '</select>' +
        '<input data-f="desc" value="' + escapeAttr(e.desc) + '" placeholder="' + t('expDesc') + '" />' +
        '<input type="text" data-f="amount" inputmode="decimal" value="' + e.amount + '" />' +
        '<button class="exp-del" data-del="' + e.id + '" title="' + t('deleteItem') + '">' + icon('trash') + '</button>' +
      '</div>';
    });
    html += '</div>';
    // manage (delete) custom categories
    var customs = D.getExpenseCats();
    if (customs.length) {
      html += '<div class="cat-manage"><span class="cat-manage-lbl">' + t('myCategories') + ':</span> ' +
        customs.map(function (c) { return '<span class="cat-chip">' + escapeAttr(c) + '<button class="cat-chip-del" data-cat="' + escapeAttr(c) + '" aria-label="delete">×</button></span>'; }).join('') +
      '</div>';
    }
    html += '<div class="btn-row" style="margin-top:16px">' +
        '<button class="btn btn-primary" id="addExpense">＋ ' + t('addExpenseBtn') + '</button>' +
        '<button class="btn btn-ghost" id="addExpCat">＋ ' + t('addCategoryBtn') + '</button>' +
        '<button class="btn btn-ghost" id="dlExcel">' + t('downloadExcel') + '</button>' +
      '</div></div>';

    html += '</div>';
    page.innerHTML = html;

    // bindings — expense edits live on the server (back-office work needs a
    // connection; only the till itself is offline-safe)
    var offlineToast = function () { toast(t('needsConnection'), true); };
    $('#expMonthSel').onchange = function () { state.expMonth = this.value; renderExpenses(); };
    $('#addExpense').onclick = function () {
      var day = (state.expMonth === 'all' || state.expMonth === currentMonth()) ? D.dayKey() : state.expMonth + '-01';
      D.addExpenseRemote({ day: day, category: 'salary', desc: '', amount: 0 }, function (err) {
        if (err) { offlineToast(); return; }
        renderExpenses(true);
        var first = $('#expList .exp-row'); if (first) { first.scrollIntoView({ block: 'center' }); var a = $('[data-f="amount"]', first); if (a) a.focus(); }
      });
    };
    $('#addExpCat').onclick = function () {
      var name = prompt(t('newCatPrompt'));
      if (name && name.trim()) D.addExpenseCatRemote(name.trim(), function (err) {
        if (err) { offlineToast(); return; }
        renderExpenses(true); toast(t('saved'));
      });
    };
    $$('.cat-chip-del', page).forEach(function (b) {
      b.onclick = function () {
        if (!confirm(t('deleteCatConfirm'))) return;
        D.deleteExpenseCatRemote(b.dataset.cat, function (err) {
          if (err) { offlineToast(); return; }
          renderExpenses(true); toast(t('saved'));
        });
      };
    });
    $('#dlExcel').onclick = downloadWorkbook;
    $$('#expList .exp-row').forEach(function (row) {
      var id = row.dataset.id;
      $$('[data-f]', row).forEach(function (inp) {
        inp.onchange = function () {
          var patch = {}; patch[inp.dataset.f] = inp.value;
          D.updateExpenseRemote(id, patch, function (err) {
            if (err) { offlineToast(); renderExpenses(true); return; }   // revert to server truth
            if (inp.dataset.f === 'amount' || inp.dataset.f === 'day') renderExpenses(true);
          });
        };
      });
    });
    $$('.exp-del', page).forEach(function (b) {
      b.onclick = function () {
        if (!confirm(t('deleteExpenseConfirm'))) return;
        D.deleteExpenseRemote(b.dataset.del, function (err) {
          if (err) { offlineToast(); return; }
          renderExpenses(true); toast(t('saved'));
        });
      };
    });
  }

  // =====================================================================
  // SETTINGS
  // =====================================================================
  function renderSettings() {
    var page = $('#page-settings');
    $('#pageSub').textContent = '';
    var menu = D.getMenu();
    var html = '<div class="settings-wrap">';

    if (D.isDefaultPin()) {
      html += '<div class="warn">' + icon('warn') + '<span>' + t('defaultPinWarn') + '</span></div>';
    }

    // Language
    html += '<div class="set-card"><h3>' + t('language') + '</h3><p class="hint">العربية / English</p>' +
      '<div class="lang-toggle" style="box-shadow:none">' +
        '<button data-setlang="ar" class="' + (state.lang === 'ar' ? 'on' : '') + '" style="padding:10px 24px">' + t('arabic') + '</button>' +
        '<button data-setlang="en" class="' + (state.lang === 'en' ? 'on' : '') + '" style="padding:10px 24px">' + t('english') + '</button>' +
      '</div></div>';

    // Security / PIN
    html += '<div class="set-card"><h3>' + t('security') + '</h3><p class="hint">' + t('changePin') + '</p>' +
      '<div class="row3">' +
        '<div class="field"><label>' + t('currentPin') + '</label><input id="curPin" type="password" inputmode="numeric" maxlength="6" /></div>' +
        '<div class="field"><label>' + t('newPin') + '</label><input id="newPin" type="password" inputmode="numeric" maxlength="6" /></div>' +
        '<div class="field"><label>' + t('confirmPin') + '</label><input id="confPin" type="password" inputmode="numeric" maxlength="6" /></div>' +
      '</div>' +
      '<button class="btn btn-primary" id="savePin">' + t('save') + '</button></div>';

    // Menu management
    html += '<div class="set-card"><h3>' + t('menuMgmt') + '</h3><p class="hint">' + t('photoHint') + ' · ' + t('price') + ' (' + curLabel() + ')</p>' +
      '<div class="medit-head medit-row"><span>' + t('photo') + '</span><span>' + t('name') + ' (ع)</span><span>' + t('name') + ' (EN)</span><span>' + t('price') + '</span><span>' + t('category') + '</span></div>' +
      '<div class="menu-edit" id="menuEdit">';
    menu.forEach(function (p, idx) {
      var tile = '<span class="mi-icon">' + icon(ICON_FOR[p.icon] || 'cup') + '</span>' +
                 '<span class="mi-add">' + icon('camera') + '</span>';
      if (p.photo) {
        tile += '<img src="' + p.photo + '" alt="" onerror="this.closest(\'.medit-photo\').classList.remove(\'has-photo\'); this.remove()" />' +
                '<button class="photo-rm" data-rm="' + idx + '" title="' + t('removePhoto') + '">×</button>';
      }
      html += '<div class="medit-row" data-idx="' + idx + '">' +
        '<div class="medit-photo' + (p.photo ? ' has-photo' : '') + '" data-photo="' + idx + '" title="' + (p.photo ? t('changePhoto') : t('addPhoto')) + '">' + tile + '</div>' +
        '<input data-f="ar" value="' + escapeAttr(p.ar) + '" placeholder="' + t('name') + ' (ع)" />' +
        '<input data-f="en" value="' + escapeAttr(p.en) + '" placeholder="' + t('name') + ' (EN)" />' +
        '<input data-f="price" type="text" inputmode="decimal" value="' + p.price + '" />' +
        '<select data-f="category"><option value="drinks"' + (p.category === 'drinks' ? ' selected' : '') + '>' + t('drinks') + '</option><option value="sweets"' + (p.category === 'sweets' ? ' selected' : '') + '>' + t('sweets') + '</option></select>' +
        '<button class="medit-del" data-del="' + idx + '" title="' + t('deleteItem') + '">' + icon('trash') + '</button>' +
      '</div>';
    });
    html += '</div>' +
      '<div class="btn-row" style="margin-top:16px">' +
        '<button class="btn btn-primary" id="saveMenu">' + t('save') + '</button>' +
        '<button class="btn btn-ghost" id="addItem">＋ ' + t('addItem') + '</button>' +
        '<button class="btn btn-ghost" id="resetMenu">' + (state.lang === 'ar' ? 'استعادة المنيو الأصلي' : 'Reset to original menu') + '</button>' +
      '</div></div>';

    // Data
    html += '<div class="set-card"><h3>' + t('data') + '</h3><p class="hint">' + (state.lang === 'ar' ? 'كل البيانات محفوظة على هذا الجهاز فقط' : 'All data is stored on this device only') + '</p>' +
      '<div class="btn-row">' +
        '<button class="btn btn-ghost" id="exportCsv">' + t('exportData') + '</button>' +
        '<button class="btn btn-ghost" id="backupJson">' + t('backup') + '</button>' +
        '<button class="btn btn-ghost" id="importJson">' + t('importBackup') + '</button>' +
        '<button class="btn btn-danger" id="clearData">' + t('clearData') + '</button>' +
      '</div>' +
      '<p class="hint" style="margin-top:12px">' + t('importHint') + '</p></div>';

    html += '</div>';
    page.innerHTML = html;

    // bindings
    $$('[data-setlang]', page).forEach(function (b) { b.onclick = function () { setLang(b.dataset.setlang); }; });
    $('#savePin').onclick = saveNewPin;
    $('#saveMenu').onclick = saveMenuEdits;
    $('#resetMenu').onclick = function () {
      if (!confirm(t('resetMenuConfirm'))) return;
      D.resetMenu();
      pushMenu(D.getMenu());
    };
    // add a new blank item
    $('#addItem').onclick = function () {
      var m = collectMenuEdits();
      m.push({ id: 'item' + Date.now().toString(36), ar: '', en: '', price: 0, category: 'drinks', icon: 'cup', photo: null });
      pushMenu(m, function () {
        var rows = $$('#menuEdit .medit-row'); var last = rows[rows.length - 1];
        if (last) { last.scrollIntoView({ block: 'center' }); var f = $('[data-f="ar"]', last); if (f) f.focus(); }
      });
    };
    // delete an item
    $$('.medit-del', page).forEach(function (b) {
      b.onclick = function () {
        var m = collectMenuEdits(); var i = +b.dataset.del;
        var nm = (m[i] && (m[i].ar || m[i].en)) || '';
        if (!confirm(t('deleteItemConfirm') + (nm ? ' (' + nm + ')' : ''))) return;
        m.splice(i, 1); pushMenu(m);
      };
    });

    // ----- product photo upload / remove -----
    var fileInput = $('#photoFile');
    if (!fileInput) {
      fileInput = el('input'); fileInput.type = 'file'; fileInput.accept = 'image/*';
      fileInput.id = 'photoFile'; fileInput.style.display = 'none'; document.body.appendChild(fileInput);
    }
    $$('.medit-photo', page).forEach(function (cell) {
      cell.onclick = function (e) {
        if (e.target.closest('.photo-rm')) return;
        fileInput.dataset.idx = cell.dataset.photo; fileInput.value = ''; fileInput.click();
      };
    });
    $$('.photo-rm', page).forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var m = collectMenuEdits(); m[+b.dataset.rm].photo = null;
        pushMenu(m);
      };
    });
    fileInput.onchange = function () {
      var f = fileInput.files && fileInput.files[0]; if (!f) return;
      var idx = +fileInput.dataset.idx;
      resizeImage(f, 560, function (dataUrl) {
        var m = collectMenuEdits(); m[idx].photo = dataUrl;
        // local write first — it doubles as the device-quota check
        if (!D.saveMenu(m)) { toast(state.lang === 'ar' ? 'الصورة كبيرة جداً' : 'Image too large'); return; }
        pushMenu(m);
      });
    };
    // Exports pull the server's copy first so the file reflects every device,
    // and fall back to the cache when offline.
    $('#exportCsv').onclick = function () {
      D.refreshSales(function () { download('khamra-sales-' + D.dayKey() + '.csv', D.salesToCSV(), 'text/csv'); });
    };
    $('#backupJson').onclick = function () {
      D.refreshSales(function () { D.refreshExpenses(function () {
        download('khamra-backup-' + D.dayKey() + '.json', D.backupJSON(), 'application/json');
      }); });
    };
    $('#importJson').onclick = pickBackupFile;
    $('#clearData').onclick = function () {
      if (!confirm(t('clearConfirm'))) return;
      D.clearSalesRemote(function (err) {
        if (err) { toast(t('needsConnection'), true); return; }
        toast(t('saved'));
        if (state.route === 'reports') renderReports(true);
      });
    };
  }

  // ----- Import a backup file (merge) -----
  function pickBackupFile() {
    var inp = $('#backupFile');
    if (!inp) {
      inp = el('input'); inp.type = 'file';
      inp.accept = 'application/json,.json';
      inp.id = 'backupFile'; inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.onchange = function () {
        var f = inp.files && inp.files[0];
        if (f) readBackupFile(f);
        inp.value = '';   // so picking the same file twice still fires onchange
      };
    }
    inp.click();
  }
  function readBackupFile(file) {
    var r = new FileReader();
    r.onerror = function () { toast(t('importBadFile'), true); };
    r.onload = function () {
      // The merge happens in the central DB now; the callback has already
      // pulled the merged truth back into the local cache.
      D.importBackupRemote(String(r.result), function (err, res) {
        if (err === 'network') { toast(t('needsConnection'), true); return; }
        if (err) { toast(t('importBadFile'), true); return; }
        var a = res.added;
        var total = a.menu + a.sales + a.expenses + a.cats;
        if (!total) { toast(t('importNothing')); return; }
        // Say what actually landed — a silent "done" hides a half-read file.
        var parts = [];
        if (a.sales) parts.push(D.num(a.sales, state.lang) + ' ' + t('orders'));
        if (a.expenses) parts.push(D.num(a.expenses, state.lang) + ' ' + t('navExpenses'));
        if (a.menu) parts.push(D.num(a.menu, state.lang) + ' ' + t('items'));
        if (a.cats) parts.push(D.num(a.cats, state.lang) + ' ' + t('category'));
        var msg = t('importAdded') + ': ' + parts.join('، ');
        if (res.skipped) msg += ' (' + D.num(res.skipped, state.lang) + ' ' + t('importSkipped') + ')';
        toast(msg);
        // Everything downstream of the merge needs redrawing.
        renderSettings(); renderProducts();
        if (state.route === 'reports') renderReports(true);
        if (state.route === 'expenses') renderExpenses(true);
        if (state.route === 'inventory') renderInventory();
      });
    };
    r.readAsText(file);
  }

  function saveNewPin() {
    var cur = $('#curPin').value, nw = $('#newPin').value, cf = $('#confPin').value;
    if (!/^\d{6}$/.test(nw)) { toast(t('pinLen'), true); return; }
    if (nw !== cf) { toast(t('pinMismatch'), true); return; }
    // The server is the judge of the current PIN now.
    D.setPinRemote(cur, nw, function (err) {
      if (err === 'wrongPin') { toast(t('wrongPin'), true); return; }
      if (err) { toast(t('needsConnection'), true); return; }
      toast(t('pinChanged'));
      $('#curPin').value = $('#newPin').value = $('#confPin').value = '';
      renderSettings();
    });
  }
  // Reads the current values from the editor inputs into the menu array
  // (without saving) so photo changes never discard pending text edits.
  function collectMenuEdits() {
    var menu = D.getMenu();
    $$('#menuEdit .medit-row').forEach(function (row) {
      var i = +row.dataset.idx;
      menu[i].ar = $('[data-f="ar"]', row).value.trim() || menu[i].ar;
      menu[i].en = $('[data-f="en"]', row).value.trim() || menu[i].en;
      menu[i].price = parseFloat($('[data-f="price"]', row).value) || 0;
      menu[i].category = $('[data-f="category"]', row).value;
    });
    return menu;
  }
  function saveMenuEdits() {
    // Every item must have a name and a price > 0 before it can be saved.
    var bad = 0;
    $$('#menuEdit .medit-row').forEach(function (row) {
      var ar = $('[data-f="ar"]', row), pr = $('[data-f="price"]', row);
      ar.classList.remove('invalid'); pr.classList.remove('invalid');
      if (!ar.value.trim()) { ar.classList.add('invalid'); bad++; }
      if (!(parseFloat(pr.value) > 0)) { pr.classList.add('invalid'); bad++; }
    });
    if (bad) { toast(t('fillAll')); return; }
    pushMenu(collectMenuEdits());
  }
  // Menu edits live on the server (shared across devices). On failure the
  // re-render falls back to the cached server truth, so the UI never lies.
  function pushMenu(m, after) {
    D.saveMenuRemote(m, function (err) {
      if (err) toast(t('needsConnection'), true); else toast(t('saved'));
      renderSettings(); renderProducts();
      if (!err && after) after();
    });
  }

  // Downscale + JPEG-compress an uploaded image so it fits comfortably in
  // localStorage (covers the whole tile, keeps storage small).
  function resizeImage(file, maxSize, cb) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
        var w = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
        var canvas = el('canvas'); canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { toast(state.lang === 'ar' ? 'تعذّر قراءة الصورة' : 'Could not read image'); };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  // =====================================================================
  // MODAL / TOAST / UTIL
  // =====================================================================
  function openModal(html) { $('#modal').innerHTML = html; $('#modalBg').classList.add('on'); }
  function closeModal() { $('#modalBg').classList.remove('on'); }
  var toastTimer;
  function toast(msg) {
    $('#toastMsg').textContent = msg;
    var el = $('#toast'); el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2200);
  }
  function download(name, content, type) {
    // .xlsx arrives as raw bytes — tagging those with a charset would be a lie
    // and can make Excel refuse the file.
    var binary = typeof content !== 'string';
    var blob = new Blob([content], { type: binary ? type : type + ';charset=utf-8' });

    // Safari before iOS 13 (the booth iPad — iPad mini 3 / iOS 12) ignores the
    // `download` attribute and won't save a blob from a synthetic click, so every
    // export button silently did nothing there. Route that browser through a path
    // it can actually save from.
    if (needsLegacySave()) { legacySave(name, content, blob, type); return; }

    var url = URL.createObjectURL(blob);
    var a = el('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  // True on old iOS Safari (and any ancient browser without the download attr).
  // iOS 13+ iPad reports itself as "Macintosh", so it won't match here and keeps
  // the normal download path — which works from iOS 13 on.
  function needsLegacySave() {
    var ua = navigator.userAgent || '';
    var iOS = /iP(ad|hone|od)/.test(ua);
    var m = ua.match(/OS (\d+)[_.]/);
    var ver = m ? parseInt(m[1], 10) : 0;   // 0 = couldn't read it → treat as old
    return (iOS && ver < 13) || !('download' in el('a'));
  }

  // Open the file in a new view so the user can save it with the iOS Share sheet
  // (Share → “Save to Files”, or open straight into Numbers/Excel). For text
  // formats we also offer an in-app Copy, so there's always a way out.
  function legacySave(name, content, blob, type) {
    var url = URL.createObjectURL(blob);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);   // long enough to open/share
    var canCopy = /^text\//.test(type) || type === 'application/json';
    openModal(
      '<div class="ico-badge">' + icon('receipt') + '</div>' +
      '<h2>' + t('exportReady') + '</h2>' +
      '<div class="m-sub"><span class="fname">' + escapeHtml(name) + '</span>' + t('exportIosHint') + '</div>' +
      '<a class="btn btn-primary export-open" href="' + url + '" target="_blank" rel="noopener">' + t('openFile') + '</a>' +
      (canCopy ? '<button class="btn btn-ghost export-open" id="expCopy">' + t('copyText') + '</button>' : '') +
      '<button class="btn btn-ghost export-open" id="expClose">' + t('cancel') + '</button>'
    );
    $('#expClose').onclick = closeModal;
    if (canCopy) $('#expCopy').onclick = function () {
      var ok = copyText(content);
      toast(t(ok ? 'copied' : 'copyFailed'), !ok);
    };
  }

  // Clipboard copy that works on iOS 12 (no navigator.clipboard there).
  function copyText(text) {
    var ta = el('textarea'); ta.value = text;
    ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.readOnly = false; ta.contentEditable = 'true';
    document.body.appendChild(ta);
    var ok = false;
    try {
      var range = document.createRange(); range.selectNodeContents(ta);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // =====================================================================
  // XLSX WRITER — a real multi-sheet workbook, no libraries
  // An .xlsx is a ZIP of XML parts. Parts are stored uncompressed (ZIP
  // "store"), which keeps the whole writer small enough to ship inline and
  // running on the booth iPad's iOS 12 Safari. Excel, Numbers and Sheets all
  // open the result; numbers stay numbers, so the client can sum and filter.
  // =====================================================================
  var XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  // Style ids, in the order they are declared in xlsxStyles().
  var ST = { norm: 0, bold: 1, title: 2, sect: 3, head: 4, money: 5, moneyBold: 6 };

  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')   // control chars are illegal in XML
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function colName(i) {                 // 0 -> A, 25 -> Z, 26 -> AA
    var s = '', n = i + 1;
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
    return s;
  }
  // Cell helpers. A row is an array of these (or null for a blank cell).
  function cTxt(v, style) { return { t: String(v == null ? '' : v), s: style || 0 }; }
  function cNum(v, style) { return { n: Number(v) || 0, s: style || 0 }; }
  function cMny(v, bold)  { return { n: Math.round((Number(v) || 0) * 1000) / 1000, s: bold ? ST.moneyBold : ST.money }; }

  function sheetXml(rows, widths) {
    var cols = '';
    if (widths && widths.length) {
      cols = '<cols>' + widths.map(function (w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join('') + '</cols>';
    }
    var body = rows.map(function (cells, r) {
      var rn = r + 1;
      var out = cells.map(function (c, i) {
        if (c == null) return '';
        var ref = colName(i) + rn, st = c.s ? ' s="' + c.s + '"' : '';
        if ('n' in c) return '<c r="' + ref + '"' + st + '><v>' + c.n + '</v></c>';
        return '<c r="' + ref + '" t="inlineStr"' + st + '><is><t xml:space="preserve">' + xmlEsc(c.t) + '</t></is></c>';
      }).join('');
      return '<row r="' + rn + '">' + out + '</row>';
    }).join('');
    return XMLH + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      cols + '<sheetData>' + body + '</sheetData></worksheet>';
  }

  function xlsxStyles() {
    return XMLH + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.000"/></numFmts>' +
      '<fonts count="4">' +
        '<font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="15"/><color rgb="FF5A3114"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '</fonts>' +
      '<fills count="4">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF5A3114"/><bgColor indexed="64"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFBF5EC"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="7">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
        '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
      '</cellXfs></styleSheet>';
  }

  // sheets: [{ name, rows, widths }] -> Uint8Array of a .xlsx file
  function buildXlsx(sheets) {
    var REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    var files = [];

    files.push({ name: '[Content_Types].xml', text: XMLH +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(function (s, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>' });

    files.push({ name: '_rels/.rels', text: XMLH +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' });

    files.push({ name: 'xl/workbook.xml', text: XMLH +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + REL + '"><sheets>' +
      sheets.map(function (s, i) {
        // Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars.
        var nm = String(s.name).replace(/[:\\\/?*\[\]]/g, ' ').slice(0, 31);
        return '<sheet name="' + xmlEsc(nm) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') + '</sheets></workbook>' });

    files.push({ name: 'xl/_rels/workbook.xml.rels', text: XMLH +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="' + REL + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="' + REL + '/styles" Target="styles.xml"/>' +
      '</Relationships>' });

    files.push({ name: 'xl/styles.xml', text: xlsxStyles() });
    sheets.forEach(function (s, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: sheetXml(s.rows, s.widths) });
    });

    return zipStore(files.map(function (f) { return { name: f.name, bytes: utf8Bytes(f.text) }; }));
  }

  function utf8Bytes(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      else if (c >= 0xD800 && c <= 0xDBFF) {          // surrogate pair -> 4 bytes
        c = 0x10000 + ((c & 0x3FF) << 10) + (str.charCodeAt(++i) & 0x3FF);
        out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
    return new Uint8Array(out);
  }

  var CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Int32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c;
      }
    }
    var crc = -1;
    for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ -1) >>> 0;
  }

  // ZIP with the "store" (no compression) method — enough for an .xlsx.
  function zipStore(files) {
    var chunks = [], central = [], offset = 0, DOS_1980 = 0x21;
    files.forEach(function (f) {
      var name = utf8Bytes(f.name), data = f.bytes, crc = crc32(data);
      var local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);      // names are UTF-8
      lv.setUint16(8, 0, true);           // stored
      lv.setUint16(10, 0, true);
      lv.setUint16(12, DOS_1980, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);
      chunks.push(local, data);

      var cd = new Uint8Array(46 + name.length), cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true); cv.setUint16(12, 0, true);
      cv.setUint16(14, DOS_1980, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      cd.set(name, 46);
      central.push(cd);
      offset += local.length + data.length;
    });

    var cdSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    var all = chunks.concat(central, [end]);
    var total = all.reduce(function (a, c) { return a + c.length; }, 0);
    var out = new Uint8Array(total), at = 0;
    all.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  }

  function updateClock() {
    var now = new Date();
    var ct = $('#clockT'), cd = $('#clockD');
    if (!ct) return;
    var loc = state.lang === 'ar' ? 'ar' : 'en-GB';
    ct.textContent = now.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
    cd.textContent = now.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  // Topbar chip: hidden when everything is synced; "N to sync" while the
  // outbox drains; "Offline · N" when the server can't be reached.
  function updateSyncChip() {
    var chip = $('#syncChip'); if (!chip) return;
    var pending = D.pendingCount();
    if (!D.isOnline()) {
      chip.className = 'sync-chip on off';
      chip.textContent = t('offlineChip') + (pending ? ' · ' + D.num(pending, state.lang) : '');
    } else if (pending) {
      chip.className = 'sync-chip on pend';
      chip.textContent = D.num(pending, state.lang) + ' ' + t('toSync');
    } else chip.className = 'sync-chip';
  }

  // =====================================================================
  // INIT
  // =====================================================================
  function init() {
    buildKeypad(); renderDots();
    $('#lockSign').innerHTML = flSignatureHTML('dark');
    var ms = $('#mainSign'); if (ms) ms.innerHTML = flSignatureHTML('light');
    applyLang();
    // nav
    $$('.nav-btn[data-route]').forEach(function (b) { b.onclick = function () { go(b.dataset.route); }; });
    $('#lockBtn').onclick = lockApp;
    $('#langAr').onclick = function () { setLang('ar'); };
    $('#langEn').onclick = function () { setLang('en'); };
    // sale actions
    $('#chargeBtn').onclick = openPayment;
    $('#clearOrderBtn').onclick = clearCart;
    // tap the order header to expand/collapse the sheet on compact screens
    $('.order-head').addEventListener('click', function (e) {
      if (e.target.closest('.clear-link')) return;
      if (isCompact()) $('.order').classList.toggle('open');
    });
    // modal dismiss on backdrop
    $('#modalBg').onclick = function (e) { if (e.target === $('#modalBg')) closeModal(); };
    // server sync: status chip, background outbox flush, and a bounce back to
    // the lock screen if the server session expires mid-shift
    D.onSync(updateSyncChip);
    D.onAuthLost(function () { lockApp(); });
    D.startSync();
    updateSyncChip();
    // clock
    updateClock(); setInterval(updateClock, 30000);
    // start locked
    lockApp();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
