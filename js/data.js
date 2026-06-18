/* ============================================================
   Khamra POS — Data layer
   Storage helpers, default menu, i18n strings, currency format.
   Pure (no DOM). Loaded before app.js as a plain script.
   ============================================================ */
(function (global) {
  'use strict';

  // --- Storage keys -----------------------------------------------------
  var KEYS = {
    pin: 'khamra.pin',
    menu: 'khamra.menu',
    sales: 'khamra.sales',
    settings: 'khamra.settings',
    seq: 'khamra.orderSeq',
    pinV: 'khamra.pinVersion'
  };

  // --- Default menu (from the booth menu, bilingual) --------------------
  // Prices in OMR. category: 'drinks' | 'sweets'. icon maps to an SVG glyph.
  // `photo` points at a file you can drop into assets/products/ (named by id).
  // If the file is missing, the UI cleanly falls back to the themed `icon`.
  var DEFAULT_MENU = [
    { id: 'karak',           ar: 'كرك خمرة',        en: 'Khamra Karak',        price: 0.5, category: 'drinks', icon: 'cup',       photo: 'assets/products/karak.jpg'            },
    { id: 'red-tea',         ar: 'شاي أحمر',         en: 'Red Tea',             price: 0.5, category: 'drinks', icon: 'glass',     photo: 'assets/products/red-tea.jpg'          },
    { id: 'hibiscus-peach',  ar: 'كركدية خوخ',       en: 'Peach Hibiscus',      price: 1.0, category: 'drinks', icon: 'flower',    photo: 'assets/products/hibiscus-peach.jpg'   },
    { id: 'hibiscus',        ar: 'كركدية',           en: 'Hibiscus',            price: 0.8, category: 'drinks', icon: 'flower',    photo: 'assets/products/hibiscus.jpg'         },
    { id: 'honeycomb',       ar: 'خلية نحل',         en: 'Honeycomb',           price: 1.0, category: 'sweets', icon: 'honey',     photo: 'assets/products/honeycomb.jpg'        },
    { id: 'cinnabon',        ar: 'سينابون',          en: 'Cinnamon Roll',       price: 1.0, category: 'sweets', icon: 'roll',      photo: 'assets/products/cinnabon.jpg'         },
    { id: 'croissant-butter',ar: 'كرواسون زبدة',     en: 'Butter Croissant',    price: 0.5, category: 'sweets', icon: 'croissant', photo: 'assets/products/croissant-butter.jpg' },
    { id: 'croissant-choc',  ar: 'كرواسون تشوكلت',   en: 'Chocolate Croissant', price: 0.6, category: 'sweets', icon: 'croissant', photo: 'assets/products/croissant-choc.jpg'   }
  ];

  var DEFAULT_SETTINGS = {
    lang: 'ar',            // 'ar' | 'en'
    currency: 'OMR',
    decimals: 3,
    boothName: 'Khamra'
  };

  var DEFAULT_PIN = '123456';
  var PIN_VERSION = '6'; // bump if the PIN scheme changes (forces a one-time reset)

  // --- Low level read/write --------------------------------------------
  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  // --- PIN (lightly obfuscated; this is booth-level security) ----------
  // Not cryptographic — deters casual access, keeps the PIN out of plain sight.
  function hashPin(pin) {
    var h = 5381, i = pin.length;
    while (i) { h = (h * 33) ^ pin.charCodeAt(--i); }
    return (h >>> 0).toString(36);
  }
  function getPinHash() {
    var h = read(KEYS.pin, null);
    if (h == null) { h = hashPin(DEFAULT_PIN); write(KEYS.pin, h); }
    return h;
  }
  function verifyPin(pin) { return hashPin(String(pin)) === getPinHash(); }
  function setPin(pin) { return write(KEYS.pin, hashPin(String(pin))); }
  function isDefaultPin() { return getPinHash() === hashPin(DEFAULT_PIN); }

  // --- Menu -------------------------------------------------------------
  function getMenu() {
    var m = read(KEYS.menu, null);
    if (!m || !m.length) { m = DEFAULT_MENU.slice(); write(KEYS.menu, m); return m; }
    // Backfill fields introduced in later versions (e.g. `photo`, `icon`) onto
    // menus that were saved earlier — so existing installs pick up the product
    // photos automatically without needing a manual reset. Only fills when the
    // field is missing; a photo the user explicitly removed (null) is kept null.
    var def = {}; DEFAULT_MENU.forEach(function (d) { def[d.id] = d; });
    var changed = false;
    m.forEach(function (it) {
      var d = def[it.id]; if (!d) return;
      if (!('photo' in it) && d.photo) { it.photo = d.photo; changed = true; }
      if (!it.icon && d.icon) { it.icon = d.icon; changed = true; }
    });
    if (changed) write(KEYS.menu, m);
    return m;
  }
  function saveMenu(menu) { return write(KEYS.menu, menu); }
  function resetMenu() { write(KEYS.menu, DEFAULT_MENU.slice()); return getMenu(); }

  // --- Settings ---------------------------------------------------------
  function getSettings() {
    var s = read(KEYS.settings, null) || {};
    var merged = {};
    for (var k in DEFAULT_SETTINGS) merged[k] = (k in s) ? s[k] : DEFAULT_SETTINGS[k];
    return merged;
  }
  function saveSettings(patch) {
    var s = getSettings();
    for (var k in patch) s[k] = patch[k];
    write(KEYS.settings, s);
    return s;
  }

  // --- Sales ------------------------------------------------------------
  function getSales() { return read(KEYS.sales, []); }

  function nextOrderNo() {
    var n = (read(KEYS.seq, 0) | 0) + 1;
    write(KEYS.seq, n);
    return n;
  }

  // sale: { items:[{id,ar,en,price,qty}], total, method, isoDate }
  function recordSale(sale) {
    var sales = getSales();
    var now = new Date();
    var rec = {
      id: 'S' + now.getTime() + '-' + Math.floor(Math.random() * 1000),
      no: nextOrderNo(),
      ts: now.getTime(),
      iso: now.toISOString(),
      day: dayKey(now),
      items: sale.items,
      total: sale.total,
      count: sale.items.reduce(function (a, i) { return a + i.qty; }, 0),
      method: sale.method || 'cash'
    };
    sales.push(rec);
    write(KEYS.sales, sales);
    return rec;
  }

  function deleteSale(id) {
    var sales = getSales().filter(function (s) { return s.id !== id; });
    write(KEYS.sales, sales);
    return sales;
  }

  function clearSales() { write(KEYS.sales, []); }

  // --- Date helpers (local-day based) ----------------------------------
  function dayKey(d) {
    d = d || new Date();
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  // --- Analytics --------------------------------------------------------
  // Returns aggregate stats for a given dayKey (default: today).
  function statsForDay(key) {
    key = key || dayKey();
    var sales = getSales().filter(function (s) { return s.day === key; });
    return aggregate(sales);
  }

  function aggregate(sales) {
    var revenue = 0, orders = sales.length, items = 0;
    var cash = 0, card = 0;
    var byProduct = {}; // id -> {ar,en,qty,revenue}
    sales.forEach(function (s) {
      revenue += s.total;
      items += s.count;
      if (s.method === 'card') card += s.total; else cash += s.total;
      s.items.forEach(function (it) {
        var p = byProduct[it.id] || (byProduct[it.id] = { id: it.id, ar: it.ar, en: it.en, qty: 0, revenue: 0 });
        p.qty += it.qty;
        p.revenue += it.price * it.qty;
      });
    });
    var products = Object.keys(byProduct).map(function (k) { return byProduct[k]; })
      .sort(function (a, b) { return b.qty - a.qty || b.revenue - a.revenue; });
    // A "top seller" only counts when it genuinely stands out — i.e. it sold
    // strictly more units than the runner-up. If the leaders are tied, there
    // is no standout yet (tie = true).
    var top = null, tie = false;
    if (products.length === 1) top = products[0];
    else if (products.length > 1) {
      if (products[0].qty > products[1].qty) top = products[0];
      else tie = true;
    }
    return {
      revenue: revenue, orders: orders, items: items,
      cash: cash, card: card,
      avg: orders ? revenue / orders : 0,
      products: products,
      top: top,
      tie: tie
    };
  }

  // Last n days (including today), oldest first: [{key,label,revenue,orders}]
  function lastDays(n) {
    var sales = getSales();
    var map = {};
    sales.forEach(function (s) {
      var m = map[s.day] || (map[s.day] = { revenue: 0, orders: 0 });
      m.revenue += s.total; m.orders += 1;
    });
    var out = [];
    var base = new Date();
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
      var k = dayKey(d);
      var m = map[k] || { revenue: 0, orders: 0 };
      out.push({ key: k, date: d, revenue: m.revenue, orders: m.orders });
    }
    return out;
  }

  function allTime() { return aggregate(getSales()); }

  // --- i18n -------------------------------------------------------------
  var STRINGS = {
    appName:        { ar: 'خمرة', en: 'Khamra' },
    tagline:        { ar: 'شاي مختص', en: 'Specialty Tea' },
    // PIN
    enterPin:       { ar: 'أدخل الرمز السري', en: 'Enter your PIN' },
    wrongPin:       { ar: 'رمز غير صحيح', en: 'Incorrect PIN' },
    clear:          { ar: 'مسح', en: 'Clear' },
    welcome:        { ar: 'مرحباً بك', en: 'Welcome back' },
    // Nav
    navSale:        { ar: 'نقطة البيع', en: 'Sale' },
    navReports:     { ar: 'التقارير', en: 'Reports' },
    navSettings:    { ar: 'الإعدادات', en: 'Settings' },
    lock:           { ar: 'قفل', en: 'Lock' },
    // Categories
    drinks:         { ar: 'المشروبات', en: 'Drinks' },
    sweets:         { ar: 'السويتات', en: 'Sweets' },
    all:            { ar: 'الكل', en: 'All' },
    // Cart
    currentOrder:   { ar: 'الطلب الحالي', en: 'Current Order' },
    emptyOrder:     { ar: 'اختر منتجاً للبدء', en: 'Tap a product to start' },
    subtotal:       { ar: 'المجموع', en: 'Subtotal' },
    total:          { ar: 'الإجمالي', en: 'Total' },
    items:          { ar: 'صنف', en: 'items' },
    charge:         { ar: 'تحصيل', en: 'Charge' },
    clearOrder:     { ar: 'إلغاء الطلب', en: 'Clear order' },
    payCash:        { ar: 'نقداً', en: 'Cash' },
    payCard:        { ar: 'بطاقة', en: 'Card' },
    choosePayment:  { ar: 'طريقة الدفع', en: 'Payment method' },
    saleDone:       { ar: 'تم الدفع بنجاح', en: 'Payment complete' },
    orderNo:        { ar: 'طلب رقم', en: 'Order' },
    newOrder:       { ar: 'طلب جديد', en: 'New order' },
    cancel:         { ar: 'رجوع', en: 'Back' },
    // Reports
    today:          { ar: 'اليوم', en: 'Today' },
    revenue:        { ar: 'الإيرادات', en: 'Revenue' },
    orders:         { ar: 'الطلبات', en: 'Orders' },
    itemsSold:      { ar: 'الأصناف المباعة', en: 'Items sold' },
    avgOrder:       { ar: 'متوسط الطلب', en: 'Avg. order' },
    topProduct:     { ar: 'الأكثر مبيعاً', en: 'Top seller' },
    noStandout:     { ar: 'لا يوجد منتج متصدّر بعد', en: 'No clear top seller yet' },
    tiedSales:      { ar: 'المبيعات متقاربة بين المنتجات', en: 'Sales are evenly matched so far' },
    last7:          { ar: 'آخر ٧ أيام', en: 'Last 7 days' },
    bestSellers:    { ar: 'المنتجات الأكثر مبيعاً', en: 'Best sellers' },
    recentOrders:   { ar: 'أحدث الطلبات', en: 'Recent orders' },
    noSales:        { ar: 'لا توجد مبيعات بعد', en: 'No sales yet' },
    sold:           { ar: 'مباع', en: 'sold' },
    cash:           { ar: 'نقدي', en: 'Cash' },
    card:           { ar: 'بطاقة', en: 'Card' },
    allTime:        { ar: 'الإجمالي الكلي', en: 'All time' },
    qty:            { ar: 'الكمية', en: 'Qty' },
    // Settings
    language:       { ar: 'اللغة', en: 'Language' },
    arabic:         { ar: 'العربية', en: 'Arabic' },
    english:        { ar: 'English', en: 'English' },
    security:       { ar: 'الأمان', en: 'Security' },
    changePin:      { ar: 'تغيير الرمز السري', en: 'Change PIN' },
    currentPin:     { ar: 'الرمز الحالي', en: 'Current PIN' },
    newPin:         { ar: 'الرمز الجديد', en: 'New PIN' },
    confirmPin:     { ar: 'تأكيد الرمز', en: 'Confirm PIN' },
    save:           { ar: 'حفظ', en: 'Save' },
    pinChanged:     { ar: 'تم تغيير الرمز', en: 'PIN updated' },
    pinMismatch:    { ar: 'الرمزان غير متطابقين', en: 'PINs do not match' },
    pinLen:         { ar: 'الرمز ٦ أرقام', en: 'PIN must be 6 digits' },
    menuMgmt:       { ar: 'إدارة المنيو', en: 'Menu' },
    addItem:        { ar: 'إضافة صنف', en: 'Add item' },
    deleteItem:     { ar: 'حذف الصنف', en: 'Delete item' },
    deleteItemConfirm: { ar: 'حذف هذا الصنف؟', en: 'Delete this item?' },
    fillAll:        { ar: 'يرجى تعبئة الاسم والسعر لكل صنف', en: 'Please fill in the name and price for every item' },
    resetMenuConfirm:  { ar: 'استعادة المنيو الأصلي وحذف أي أصناف مضافة؟', en: 'Reset to the original menu and remove any added items?' },
    photo:          { ar: 'صورة', en: 'Photo' },
    addPhoto:       { ar: 'إضافة صورة', en: 'Add photo' },
    changePhoto:    { ar: 'تغيير الصورة', en: 'Change photo' },
    removePhoto:    { ar: 'حذف الصورة', en: 'Remove photo' },
    photoHint:      { ar: 'اضغط على المربّع لإضافة صورة حقيقية للمنتج', en: 'Tap the tile to add a real photo of the product' },
    name:           { ar: 'الاسم', en: 'Name' },
    price:          { ar: 'السعر', en: 'Price' },
    category:       { ar: 'الفئة', en: 'Category' },
    data:          { ar: 'البيانات', en: 'Data' },
    exportData:     { ar: 'تصدير المبيعات (CSV)', en: 'Export sales (CSV)' },
    backup:         { ar: 'نسخة احتياطية (JSON)', en: 'Backup (JSON)' },
    clearData:      { ar: 'مسح كل المبيعات', en: 'Clear all sales' },
    clearConfirm:   { ar: 'سيتم حذف كل سجل المبيعات نهائياً. متابعة؟', en: 'This will permanently delete all sales history. Continue?' },
    defaultPinWarn: { ar: 'أنت تستخدم الرمز الافتراضي 123456 — يُنصح بتغييره.', en: 'You are using the default PIN 123456 — please change it.' },
    saved:          { ar: 'تم الحفظ', en: 'Saved' },
    deleteSale:     { ar: 'حذف', en: 'Delete' }
  };

  function t(key, lang) {
    var s = STRINGS[key];
    if (!s) return key;
    return s[lang] || s.en || key;
  }

  // --- Currency / number format ----------------------------------------
  var AR_DIGITS = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  function toArabicDigits(str) {
    return String(str).replace(/[0-9]/g, function (d) { return AR_DIGITS[+d]; });
  }
  // Format an amount with the configured decimals. lang controls digit script.
  function money(amount, lang, withCode) {
    var s = getSettings();
    var n = Number(amount || 0).toFixed(s.decimals);
    if (lang === 'ar') {
      n = toArabicDigits(n).replace('.', '٫');
      return withCode ? (n + ' ر.ع') : n;
    }
    return withCode ? (s.currency + ' ' + n) : n;
  }
  function num(n, lang) {
    return lang === 'ar' ? toArabicDigits(n) : String(n);
  }

  // --- Export -----------------------------------------------------------
  function salesToCSV() {
    var rows = [['order_no', 'datetime', 'item_ar', 'item_en', 'qty', 'unit_price', 'line_total', 'method', 'order_total']];
    getSales().forEach(function (s) {
      var dt = new Date(s.ts).toLocaleString('en-GB');
      s.items.forEach(function (it) {
        rows.push([s.no, dt, it.ar, it.en, it.qty, it.price.toFixed(3), (it.price * it.qty).toFixed(3), s.method, s.total.toFixed(3)]);
      });
    });
    return rows.map(function (r) {
      return r.map(function (c) {
        c = String(c);
        return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(',');
    }).join('\n');
  }

  function backupJSON() {
    return JSON.stringify({
      exported: new Date().toISOString(),
      menu: getMenu(),
      settings: getSettings(),
      sales: getSales()
    }, null, 2);
  }

  // --- Migration --------------------------------------------------------
  // When the PIN scheme changes (e.g. 4-digit → 6-digit), reset the stored PIN
  // to the new default once, so an old incompatible PIN can't lock anyone out.
  (function () {
    if (read(KEYS.pinV, null) !== PIN_VERSION) {
      write(KEYS.pin, hashPin(DEFAULT_PIN));
      write(KEYS.pinV, PIN_VERSION);
    }
  })();

  // --- Public API -------------------------------------------------------
  global.Data = {
    KEYS: KEYS,
    DEFAULT_PIN: DEFAULT_PIN,
    // pin
    verifyPin: verifyPin, setPin: setPin, isDefaultPin: isDefaultPin,
    // menu
    getMenu: getMenu, saveMenu: saveMenu, resetMenu: resetMenu,
    // settings
    getSettings: getSettings, saveSettings: saveSettings,
    // sales
    getSales: getSales, recordSale: recordSale, deleteSale: deleteSale, clearSales: clearSales,
    // analytics
    statsForDay: statsForDay, lastDays: lastDays, allTime: allTime, dayKey: dayKey,
    // i18n + format
    t: t, money: money, num: num, toArabicDigits: toArabicDigits,
    // export
    salesToCSV: salesToCSV, backupJSON: backupJSON
  };

})(window);
