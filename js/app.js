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
      else if (b.dataset.k != null) { if (pinBuffer.length < 4) pinBuffer += b.dataset.k; }
      renderDots();
      if (pinBuffer.length === 4) setTimeout(tryUnlock, 120);
    };
    // physical keyboard support
    document.addEventListener('keydown', function (e) {
      if (!$('#lock') || $('#lock').classList.contains('hidden')) return;
      if (/^[0-9]$/.test(e.key)) { if (pinBuffer.length < 4) pinBuffer += e.key; renderDots(); if (pinBuffer.length === 4) setTimeout(tryUnlock, 120); }
      else if (e.key === 'Backspace') { pinBuffer = pinBuffer.slice(0, -1); renderDots(); }
    });
  }
  function renderDots() {
    var dots = $('#pinDots'); dots.innerHTML = '';
    for (var i = 0; i < 4; i++) { var d = el('span', 'pin-dot' + (i < pinBuffer.length ? ' on' : '')); dots.appendChild(d); }
  }
  function tryUnlock() {
    if (D.verifyPin(pinBuffer)) { pinBuffer = ''; renderDots(); $('#lockErr').textContent = ''; unlock(); }
    else {
      var lock = $('#lock'); lock.classList.add('shake');
      $('#lockErr').textContent = t('wrongPin');
      setTimeout(function () { lock.classList.remove('shake'); pinBuffer = ''; renderDots(); }, 450);
    }
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
    var titles = { sale: 'navSale', reports: 'navReports', settings: 'navSettings' };
    $('#pageTitle').textContent = t(titles[route]);
    renderRoute();
  }
  function renderRoute() {
    if (state.route === 'sale') { renderCatTabs(); renderProducts(); $('#pageSub').textContent = D.t('tagline', state.lang); }
    else if (state.route === 'reports') renderReports();
    else if (state.route === 'settings') renderSettings();
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
  // Icon sits behind; the photo (if any) covers it. A missing/broken photo
  // removes itself on error, revealing the icon underneath.
  function thumbHTML(p) {
    var ic = '<span class="icn-fallback">' + icon(ICON_FOR[p.icon] || 'cup') + '</span>';
    var im = p.photo ? '<img class="ph" src="' + p.photo + '" alt="" onerror="this.remove()" />' : '';
    return ic + im;
  }
  function renderProducts() {
    var grid = $('#productGrid'); grid.innerHTML = '';
    var menu = D.getMenu().filter(function (p) { return state.cat === 'all' || p.category === state.cat; });
    menu.forEach(function (p) {
      var inCart = state.cart.get(p.id);
      var card = el('button', 'card-product ' + p.category + (inCart ? ' in-cart' : '') + (p.photo ? ' has-photo' : ''));
      card.innerHTML =
        '<span class="badge-qty">' + (inCart ? D.num(inCart.qty, state.lang) : '') + '</span>' +
        '<div class="thumb">' + thumbHTML(p) + '</div>' +
        '<div class="meta">' +
          '<div class="name-ar">' + p.ar + '</div>' +
          '<div class="price">' + D.money(p.price, state.lang) + cur() + '</div>' +
        '</div>';
      card.onclick = function () { addToCart(p); };
      grid.appendChild(card);
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

  function addToCart(p) {
    var e = state.cart.get(p.id);
    if (e) e.qty += 1; else state.cart.set(p.id, { p: p, qty: 1 });
    renderProducts(); renderCart();
    if (isCompact()) openSheet(true);   // reveal the order on small screens
  }
  function changeQty(id, delta) {
    var e = state.cart.get(id); if (!e) return;
    e.qty += delta;
    if (e.qty <= 0) state.cart.delete(id);
    renderProducts(); renderCart();
  }
  function clearCart() { state.cart.clear(); renderProducts(); renderCart(); openSheet(false); }

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
  // REPORTS
  // =====================================================================
  function renderReports() {
    var page = $('#page-reports');
    var s = state.scope === 'today' ? D.statsForDay() : D.allTime();
    $('#pageSub').textContent = state.scope === 'today' ? todayLabel() : t('allTime');

    var html = '';
    // scope toggle
    html += '<div class="lang-toggle" style="margin-bottom:22px">' +
      '<button data-scope="today" class="' + (state.scope === 'today' ? 'on' : '') + '">' + t('today') + '</button>' +
      '<button data-scope="all" class="' + (state.scope === 'all' ? 'on' : '') + '">' + t('allTime') + '</button>' +
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
    $$('.orow .del', page).forEach(function (b) {
      b.onclick = function () { D.deleteSale(b.dataset.id); renderReports(); toast(t('saved')); };
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
    var bars = days.map(function (d) {
      var h = Math.max(4, Math.round(d.revenue / max * 140));
      var isToday = d.key === todayKey;
      var label = d.date.toLocaleDateString(state.lang === 'ar' ? 'ar' : 'en-GB', { weekday: 'short' });
      var val = d.revenue > 0 ? '<span class="bv">' + D.money(d.revenue, state.lang) + '</span>' : '';
      return '<div class="bar-col ' + (isToday ? 'today' : '') + '">' +
        '<div class="bar-wrap"><div class="bar ' + (isToday ? 'today' : '') + '" style="height:' + h + 'px">' + val + '</div></div>' +
        '<div class="bd">' + label + '</div>' +
      '</div>';
    }).join('');
    return '<div class="panel"><h3>' + t('last7') + '<span class="tag">' + cur() + '</span></h3><div class="chart">' + bars + '</div></div>';
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
    var sales = D.getSales().slice().reverse().slice(0, 8);
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
        '<div class="field"><label>' + t('currentPin') + '</label><input id="curPin" type="password" inputmode="numeric" maxlength="4" /></div>' +
        '<div class="field"><label>' + t('newPin') + '</label><input id="newPin" type="password" inputmode="numeric" maxlength="4" /></div>' +
        '<div class="field"><label>' + t('confirmPin') + '</label><input id="confPin" type="password" inputmode="numeric" maxlength="4" /></div>' +
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
        '<input data-f="price" type="number" step="0.1" min="0" value="' + p.price + '" />' +
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
        '<button class="btn btn-danger" id="clearData">' + t('clearData') + '</button>' +
      '</div></div>';

    html += '</div>';
    page.innerHTML = html;

    // bindings
    $$('[data-setlang]', page).forEach(function (b) { b.onclick = function () { setLang(b.dataset.setlang); }; });
    $('#savePin').onclick = saveNewPin;
    $('#saveMenu').onclick = saveMenuEdits;
    $('#resetMenu').onclick = function () { if (confirm(t('resetMenuConfirm'))) { D.resetMenu(); renderSettings(); renderProducts(); toast(t('saved')); } };
    // add a new blank item
    $('#addItem').onclick = function () {
      var m = collectMenuEdits();
      m.push({ id: 'item' + Date.now().toString(36), ar: '', en: '', price: 0, category: 'drinks', icon: 'cup', photo: null });
      D.saveMenu(m); renderSettings(); renderProducts();
      var rows = $$('#menuEdit .medit-row'); var last = rows[rows.length - 1];
      if (last) { last.scrollIntoView({ block: 'center' }); var f = $('[data-f="ar"]', last); if (f) f.focus(); }
    };
    // delete an item
    $$('.medit-del', page).forEach(function (b) {
      b.onclick = function () {
        var m = collectMenuEdits(); var i = +b.dataset.del;
        var nm = (m[i] && (m[i].ar || m[i].en)) || '';
        if (!confirm(t('deleteItemConfirm') + (nm ? ' (' + nm + ')' : ''))) return;
        m.splice(i, 1); D.saveMenu(m); renderSettings(); renderProducts(); toast(t('saved'));
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
        D.saveMenu(m); renderSettings(); renderProducts(); toast(t('saved'));
      };
    });
    fileInput.onchange = function () {
      var f = fileInput.files && fileInput.files[0]; if (!f) return;
      var idx = +fileInput.dataset.idx;
      resizeImage(f, 560, function (dataUrl) {
        var m = collectMenuEdits(); m[idx].photo = dataUrl;
        if (!D.saveMenu(m)) { toast(state.lang === 'ar' ? 'الصورة كبيرة جداً' : 'Image too large'); return; }
        renderSettings(); renderProducts(); toast(t('saved'));
      });
    };
    $('#exportCsv').onclick = function () { download('khamra-sales-' + D.dayKey() + '.csv', D.salesToCSV(), 'text/csv'); };
    $('#backupJson').onclick = function () { download('khamra-backup-' + D.dayKey() + '.json', D.backupJSON(), 'application/json'); };
    $('#clearData').onclick = function () { if (confirm(t('clearConfirm'))) { D.clearSales(); toast(t('saved')); if (state.route === 'reports') renderReports(); } };
  }

  function saveNewPin() {
    var cur = $('#curPin').value, nw = $('#newPin').value, cf = $('#confPin').value;
    if (!D.verifyPin(cur)) { toast(t('wrongPin'), true); return; }
    if (!/^\d{4}$/.test(nw)) { toast(t('pinLen'), true); return; }
    if (nw !== cf) { toast(t('pinMismatch'), true); return; }
    D.setPin(nw); toast(t('pinChanged'));
    $('#curPin').value = $('#newPin').value = $('#confPin').value = '';
    renderSettings();
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
    D.saveMenu(collectMenuEdits()); toast(t('saved'));
    renderProducts();
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
    var blob = new Blob([content], { type: type + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
  }
  function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

  function updateClock() {
    var now = new Date();
    var ct = $('#clockT'), cd = $('#clockD');
    if (!ct) return;
    var loc = state.lang === 'ar' ? 'ar' : 'en-GB';
    ct.textContent = now.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
    cd.textContent = now.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' });
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
    // clock
    updateClock(); setInterval(updateClock, 30000);
    // start locked
    lockApp();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
