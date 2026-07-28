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
    pinV: 'khamra.pinVersion',
    expenses: 'khamra.expenses',
    expenseCats: 'khamra.expenseCats',
    outbox: 'khamra.outbox',          // sales recorded offline, waiting to reach the server
    pinDefault: 'khamra.pinDefault'   // server's "still on the default PIN" flag, cached
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

  var BACKUP_VERSION = 2;   // 1 = menu/settings/sales only; 2 adds expenses
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
    // Inventory: decrement tracked sweets' stock by the quantity sold.
    var menu = getMenu(), changed = false;
    sale.items.forEach(function (it) {
      var m = menu.filter(function (x) { return x.id === it.id; })[0];
      if (m && m.category === 'sweets' && typeof m.stock === 'number') {
        m.stock = Math.max(0, m.stock - it.qty); changed = true;
      }
    });
    if (changed) saveMenu(menu);
    // Queue for the server. The sale is safe on-device either way; the sync
    // loop pushes it up and the server's idempotency (keyed on rec.id) makes
    // replays harmless.
    outboxPush(rec);
    syncSoon();
    return rec;
  }

  // --- Inventory (sweets only) -----------------------------------------
  // stock: a number = tracked remaining count; null/undefined = untracked (unlimited).
  function setStock(id, val) {
    var menu = getMenu();
    var m = menu.filter(function (x) { return x.id === id; })[0];
    if (!m) return getMenu();
    if (val === null || val === '' || (typeof val === 'number' && isNaN(val))) m.stock = null;
    else m.stock = Math.max(0, Math.floor(Number(val)) || 0);
    saveMenu(menu);
    return menu;
  }

  function deleteSale(id) {
    var sales = getSales().filter(function (s) { return s.id !== id; });
    write(KEYS.sales, sales);
    return sales;
  }

  function clearSales() { write(KEYS.sales, []); }

  // --- Expenses ---------------------------------------------------------
  function getExpenses() { return read(KEYS.expenses, []); }
  function saveExpenses(list) { return write(KEYS.expenses, list); }
  function addExpense(e) {
    var list = getExpenses(), now = new Date();
    var rec = {
      id: 'E' + now.getTime() + '-' + Math.floor(Math.random() * 1000),
      ts: now.getTime(),
      day: e.day || dayKey(now),
      category: e.category || 'other',
      desc: e.desc || '',
      amount: Math.max(0, Number(e.amount) || 0)
    };
    list.push(rec); saveExpenses(list); return rec;
  }
  function updateExpense(id, patch) {
    var list = getExpenses();
    var x = list.filter(function (e) { return e.id === id; })[0];
    if (!x) return;
    for (var k in patch) x[k] = patch[k];
    if ('amount' in patch) x.amount = Math.max(0, Number(patch.amount) || 0);
    saveExpenses(list);
  }
  function deleteExpense(id) { saveExpenses(getExpenses().filter(function (e) { return e.id !== id; })); }

  // custom expense categories (array of user-typed names)
  function getExpenseCats() { return read(KEYS.expenseCats, []); }
  function addExpenseCat(name) {
    name = String(name || '').trim(); if (!name) return getExpenseCats();
    var list = getExpenseCats();
    if (list.indexOf(name) === -1) { list.push(name); write(KEYS.expenseCats, list); }
    return list;
  }
  function deleteExpenseCat(name) {
    var list = getExpenseCats().filter(function (c) { return c !== name; });
    write(KEYS.expenseCats, list);
    return list;
  }

  function monthOf(day) { return String(day).slice(0, 7); }   // YYYY-MM

  // Revenue / expenses / profit for a month (YYYY-MM) or null = all time.
  function finance(monthKey) {
    var exp = getExpenses().filter(function (e) { return !monthKey || monthOf(e.day) === monthKey; });
    var sales = getSales().filter(function (s) { return !monthKey || monthOf(s.day) === monthKey; });
    var expenses = exp.reduce(function (a, e) { return a + (e.amount || 0); }, 0);
    var revenue = sales.reduce(function (a, s) { return a + s.total; }, 0);
    var byCat = {};
    exp.forEach(function (e) { byCat[e.category] = (byCat[e.category] || 0) + (e.amount || 0); });
    return { revenue: revenue, expenses: expenses, profit: revenue - expenses, byCat: byCat, count: exp.length };
  }

  // Months (YYYY-MM) that have any expense or sale, newest first (+ current).
  function expenseMonths() {
    var set = {};
    getExpenses().forEach(function (e) { set[monthOf(e.day)] = 1; });
    getSales().forEach(function (s) { set[monthOf(s.day)] = 1; });
    set[monthOf(dayKey())] = 1;
    return Object.keys(set).sort().reverse();
  }

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
    navInventory:   { ar: 'المخزون', en: 'Inventory' },
    navExpenses:    { ar: 'المصاريف', en: 'Expenses' },
    navSettings:    { ar: 'الإعدادات', en: 'Settings' },
    expensesHint:   { ar: 'سجّل مصاريف المحل. تُخصم من الإيرادات لحساب الربح.', en: 'Record the booth\'s expenses. They are subtracted from revenue to show profit.' },
    cat_salary:     { ar: 'رواتب', en: 'Salary' },
    cat_rent:       { ar: 'إيجار', en: 'Rent' },
    cat_goods:      { ar: 'بضاعة', en: 'Goods' },
    cat_other:      { ar: 'أخرى', en: 'Other' },
    expDesc:        { ar: 'البيان', en: 'Item / note' },
    amount:         { ar: 'المبلغ', en: 'Amount' },
    expDate:        { ar: 'التاريخ', en: 'Date' },
    netProfit:      { ar: 'صافي الربح', en: 'Net profit' },
    totalExpenses:  { ar: 'إجمالي المصاريف', en: 'Total expenses' },
    addExpenseBtn:  { ar: 'إضافة مصروف', en: 'Add expense' },
    addCategoryBtn: { ar: 'فئة جديدة', en: 'New category' },
    newCatPrompt:   { ar: 'اسم الفئة الجديدة', en: 'New category name' },
    downloadExcel:  { ar: 'تنزيل Excel', en: 'Download Excel' },
    noExpenses:     { ar: 'لا توجد مصاريف بعد', en: 'No expenses yet' },
    monthLabel:     { ar: 'الشهر', en: 'Month' },
    deleteExpenseConfirm: { ar: 'حذف هذا المصروف؟', en: 'Delete this expense?' },
    myCategories:   { ar: 'الفئات المضافة', en: 'Added categories' },
    deleteCatConfirm: { ar: 'حذف هذه الفئة؟ (المصاريف المسجّلة بها تبقى كما هي)', en: 'Delete this category? (Existing expenses keep it.)' },
    inventoryHint:  { ar: 'حدّد الكمية المتوفرة لكل صنف من السويتات. تنقص تلقائياً مع كل عملية بيع.', en: 'Set the available quantity for each sweet. It counts down automatically with each sale.' },
    stockLeft:      { ar: 'متبقي', en: 'left' },
    soldOut:        { ar: 'نفذت الكمية', en: 'Sold out' },
    unlimited:      { ar: 'غير محدود', en: 'Unlimited' },
    setUnlimited:   { ar: 'غير محدود', en: 'Unlimited' },
    inStock:        { ar: 'متوفر', en: 'In stock' },
    outOfStockToast:{ ar: 'نفذت كمية هذا الصنف', en: 'This item is sold out' },
    noMoreStock:    { ar: 'لا تتوفر كمية إضافية', en: 'No more stock available' },
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
    tapDayHint:     { ar: 'اضغط على يوم', en: 'Tap a day' },
    bestSellers:    { ar: 'المنتجات الأكثر مبيعاً', en: 'Best sellers' },
    recentOrders:   { ar: 'أحدث الطلبات', en: 'Recent orders' },
    noSales:        { ar: 'لا توجد مبيعات بعد', en: 'No sales yet' },
    sold:           { ar: 'مباع', en: 'sold' },
    cash:           { ar: 'نقدي', en: 'Cash' },
    card:           { ar: 'بطاقة', en: 'Card' },
    allTime:        { ar: 'الإجمالي الكلي', en: 'All time' },
    qty:            { ar: 'الكمية', en: 'Qty' },
    // Reports → Excel
    summary:        { ar: 'الملخّص', en: 'Summary' },
    allOrders:      { ar: 'كل الطلبات', en: 'All orders' },
    period:         { ar: 'الفترة', en: 'Period' },
    generatedOn:    { ar: 'تاريخ التصدير', en: 'Generated' },
    product:        { ar: 'المنتج', en: 'Product' },
    rank:           { ar: 'الترتيب', en: 'Rank' },
    time:           { ar: 'الوقت', en: 'Time' },
    paymentMethod:  { ar: 'طريقة الدفع', en: 'Payment' },
    unitPrice:      { ar: 'سعر الوحدة', en: 'Unit price' },
    lineTotal:      { ar: 'إجمالي السطر', en: 'Line total' },
    orderTotal:     { ar: 'إجمالي الطلب', en: 'Order total' },
    grandTotal:     { ar: 'الإجمالي', en: 'Grand total' },
    // Excel workbook: sheet names + section headings
    sheetOverview:  { ar: 'نظرة عامة', en: 'Overview' },
    sheetRevenue:   { ar: 'الإيرادات', en: 'Revenue' },
    dailyTotals:    { ar: 'الإجمالي اليومي', en: 'Daily totals' },
    byMonth:        { ar: 'حسب الشهر', en: 'By month' },
    byCategory:     { ar: 'حسب الفئة', en: 'By category' },
    allExpenses:    { ar: 'كل المصاريف', en: 'All expenses' },
    weekday:        { ar: 'اليوم', en: 'Day' },
    count:          { ar: 'العدد', en: 'Count' },
    preparingFile:  { ar: 'جارٍ تجهيز الملف…', en: 'Preparing the file…' },
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
    importBackup:   { ar: 'استيراد نسخة احتياطية', en: 'Import backup' },
    exportReady:    { ar: 'الملف جاهز', en: 'File ready' },
    exportIosHint:  { ar: 'افتح الملف، ثم استخدم زر المشاركة ← «حفظ في الملفات».', en: 'Open the file, then use Share → “Save to Files”.' },
    openFile:       { ar: 'فتح الملف', en: 'Open file' },
    copyText:       { ar: 'نسخ المحتوى', en: 'Copy contents' },
    copied:         { ar: 'تم النسخ', en: 'Copied' },
    copyFailed:     { ar: 'تعذّر النسخ', en: 'Couldn’t copy' },
    importHint:     { ar: 'يضيف ما ينقص من الملف فقط — لا يحذف أو يستبدل شيئاً موجوداً، ولا يغيّر الرمز السري.', en: 'Adds only what is missing from the file — nothing already here is deleted or replaced, and your PIN is never changed.' },
    importBadFile:  { ar: 'هذا الملف ليس نسخة احتياطية من خمرة', en: 'That file is not a Khamra backup' },
    importNothing:  { ar: 'لا يوجد جديد في هذا الملف', en: 'Nothing new in that file' },
    importAdded:    { ar: 'تمت الإضافة', en: 'Added' },
    importSkipped:  { ar: 'سجلات متجاهلة', en: 'skipped' },
    // Server sync
    offlineMode:    { ar: 'وضع عدم الاتصال — تُحفَظ المبيعات على هذا الجهاز وتُرفَع تلقائياً عند عودة الاتصال', en: 'Offline — sales are saved on this device and upload automatically when back online' },
    needsConnection:{ ar: 'يتطلب اتصالاً بالخادم — حاول عند عودة الإنترنت', en: 'Needs a server connection — try again when back online' },
    rateLimited:    { ar: 'محاولات كثيرة — انتظر ١٠ دقائق', en: 'Too many attempts — wait 10 minutes' },
    offlineChip:    { ar: 'غير متصل', en: 'Offline' },
    toSync:         { ar: 'بانتظار الرفع', en: 'to sync' },
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

  // A backup carries everything that lives on the device except the PIN, which
  // is stored separately and deliberately stays out of the file.
  function backupJSON() {
    return JSON.stringify({
      exported: new Date().toISOString(),
      version: BACKUP_VERSION,
      menu: getMenu(),
      settings: getSettings(),
      sales: getSales(),
      expenses: getExpenses(),
      expenseCats: getExpenseCats()
    }, null, 2);
  }

  // --- Import (merge) ---------------------------------------------------
  // Merges a backup file into what is already on the device: a record whose id
  // is already here is left untouched, anything new is added. Settings and the
  // PIN are never changed, so importing can't lock anyone out or silently
  // switch the language mid-shift.
  //
  // Returns { added: {menu,sales,expenses,cats}, skipped } or throws Error with
  // .code 'parse' (not JSON) / 'shape' (JSON, but not a Khamra backup).
  function importBackup(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw fail('parse'); }
    if (!data || typeof data !== 'object' || isArr(data)) throw fail('shape');
    // Must carry at least one collection we know how to merge, otherwise this
    // is some other JSON file that happens to be valid.
    if (!isArr(data.menu) && !isArr(data.sales) && !isArr(data.expenses) && !isArr(data.expenseCats)) throw fail('shape');

    var added = { menu: 0, sales: 0, expenses: 0, cats: 0 }, skipped = 0;

    if (isArr(data.menu)) {
      var menu = getMenu(), haveItem = index(menu);
      data.menu.forEach(function (it) {
        if (!it || !it.id) { skipped++; return; }
        if (haveItem[it.id]) return;              // keep the local copy, incl. its stock & photo
        haveItem[it.id] = 1; menu.push(it); added.menu++;
      });
      if (added.menu) saveMenu(menu);
    }

    if (isArr(data.sales)) {
      var sales = getSales(), haveSale = index(sales);
      data.sales.forEach(function (s) {
        if (!validSale(s)) { skipped++; return; }
        if (haveSale[s.id]) return;
        // `count` drives the "items sold" stat; backfill it rather than let a
        // file from an older build turn that number into NaN.
        if (!isFinite(s.count)) s.count = s.items.reduce(function (a, i) { return a + (i.qty | 0); }, 0);
        haveSale[s.id] = 1; sales.push(s); added.sales++;
      });
      if (added.sales) {
        // Analytics and the recent-orders list both read this array in order,
        // so imported history has to slot into place chronologically.
        sales.sort(function (a, b) { return a.ts - b.ts; });
        write(KEYS.sales, sales);
        // Keep numbering ahead of every order now on the device, so the next
        // sale can't reuse an imported order number.
        var maxNo = 0;
        sales.forEach(function (s) { if ((s.no | 0) > maxNo) maxNo = s.no | 0; });
        if (maxNo > (read(KEYS.seq, 0) | 0)) write(KEYS.seq, maxNo);
      }
    }

    if (isArr(data.expenses)) {
      var exps = getExpenses(), haveExp = index(exps);
      data.expenses.forEach(function (e) {
        if (!validExpense(e)) { skipped++; return; }
        if (haveExp[e.id]) return;
        haveExp[e.id] = 1; exps.push(e); added.expenses++;
      });
      if (added.expenses) { exps.sort(function (a, b) { return a.ts - b.ts; }); saveExpenses(exps); }
    }

    if (isArr(data.expenseCats)) {
      data.expenseCats.forEach(function (c) {
        if (typeof c !== 'string' || !c.trim()) { skipped++; return; }
        var before = getExpenseCats().length;
        addExpenseCat(c);
        if (getExpenseCats().length > before) added.cats++;
      });
    }

    return { added: added, skipped: skipped };
  }

  function fail(code) { var e = new Error(code); e.code = code; return e; }
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function index(list) {
    var map = {};
    list.forEach(function (x) { if (x && x.id) map[x.id] = 1; });
    return map;
  }
  function validSale(s) {
    return !!s && typeof s.id === 'string' && isArr(s.items) &&
      isFinite(s.ts) && isFinite(s.total) && typeof s.day === 'string';
  }
  function validExpense(e) {
    return !!e && typeof e.id === 'string' && typeof e.day === 'string' && isFinite(e.amount);
  }

  // =====================================================================
  // SERVER SYNC
  // The server (js served same-origin at /api) owns the data. localStorage
  // becomes the till's working cache: menu + settings so it can sell with no
  // connection, plus an outbox of sales waiting to upload. Everything here is
  // ES5 + XHR because the booth iPad is iOS 12 Safari.
  // =====================================================================
  var API = '/api';
  var online = true;                 // optimistic until a request says otherwise
  var syncSubs = [], authLostFn = null, syncing = false, syncTimerId = null;

  function isOnline() { return online; }
  function onSync(fn) { syncSubs.push(fn); }
  function onAuthLost(fn) { authLostFn = fn; }
  function notify() {
    for (var i = 0; i < syncSubs.length; i++) {
      try { syncSubs[i]({ online: online, pending: pendingCount() }); } catch (e) {}
    }
  }
  function setOnline(b) { if (online !== b) { online = b; notify(); } }

  // cb(err, data, httpStatus). err 'network' = couldn't reach the server at all.
  function req(method, path, body, cb, timeoutMs) {
    var x = new XMLHttpRequest();
    x.open(method, API + path, true);
    x.timeout = timeoutMs || 12000;
    x.setRequestHeader('Content-Type', 'application/json');
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (x.status === 0) { setOnline(false); cb('network', null, 0); return; }
      setOnline(true);
      var data = null;
      try { data = JSON.parse(x.responseText || 'null'); } catch (e) {}
      if (x.status >= 200 && x.status < 300) { cb(null, data, x.status); return; }
      // An expired session anywhere but the login call bounces the app to the lock screen.
      if (x.status === 401 && path !== '/login' && authLostFn) authLostFn();
      cb((data && data.error) || ('http' + x.status), data, x.status);
    };
    try { x.send(body != null ? JSON.stringify(body) : null); }
    catch (e) { setOnline(false); cb('network', null, 0); }
  }

  // --- Outbox (sales recorded while offline) ---------------------------
  function readOutbox() { return read(KEYS.outbox, []); }
  function outboxPush(rec) { var b = readOutbox(); b.push(rec); write(KEYS.outbox, b); notify(); }
  function outboxRemove(id) { write(KEYS.outbox, readOutbox().filter(function (r) { return r.id !== id; })); notify(); }
  function pendingCount() { return readOutbox().length; }

  function fixLocalSaleNo(id, no) {
    var sales = getSales();
    var s = sales.filter(function (x) { return x.id === id; })[0];
    if (s && s.no !== no) { s.no = no; write(KEYS.sales, sales); }
    if (no > (read(KEYS.seq, 0) | 0)) write(KEYS.seq, no);
  }

  // Push queued sales up, one at a time, oldest first. Stops (and retries
  // later) on connection/auth/server trouble; drops only records the server
  // definitively rejected as invalid, so nothing valid is ever lost.
  function syncNow(cb) {
    if (syncing) { if (cb) cb(null); return; }
    var box = readOutbox();
    if (!box.length) { notify(); if (cb) cb(null); return; }
    syncing = true;
    var i = 0;
    function step() {
      if (i >= box.length) { syncing = false; notify(); if (cb) cb(null); return; }
      var rec = box[i];
      req('POST', '/sales', { sale: rec }, function (err, data, status) {
        // Transient (offline, session expired, server trouble) — and 404/405,
        // which mean "no API at this host" (e.g. a static-hosted copy): keep
        // the sale queued and retry later. Never drop a sale for those.
        if (err && (status === 0 || status === 401 || status === 404 || status === 405 || status >= 500)) {
          syncing = false; notify(); if (cb) cb(err); return;
        }
        outboxRemove(rec.id);                                    // synced, or definitively invalid
        if (!err && data && data.sale && data.sale.no !== rec.no) fixLocalSaleNo(rec.id, data.sale.no);
        i++; step();
      });
    }
    step();
  }
  function syncSoon() { setTimeout(function () { syncNow(); }, 50); }
  function startSync() {
    if (syncTimerId) return;
    syncTimerId = setInterval(function () { if (pendingCount()) syncNow(); }, 20000);
    if (global.addEventListener) global.addEventListener('online', function () { syncNow(); });
  }

  // --- Login / bootstrap -----------------------------------------------
  // The PIN is verified by the server. If the server is unreachable, the
  // cached PIN opens the till anyway — an internet cut must never stop sales.
  function login(pin, cb) {
    req('POST', '/login', { pin: String(pin) }, function (err, data, status) {
      if (!err) {
        setPin(pin);                    // keep the offline fallback in step with the server PIN
        bootstrap(function () { syncSoon(); cb(null, { offline: false }); });
      } else if (err === 'wrongPin' || err === 'rateLimited') {
        cb(err);                        // a real server answered — believe it
      } else {
        // Unreachable, 404 (static host with no API), or a 5xx: fall back to
        // the cached PIN so a broken server can never lock the till.
        if (verifyPin(pin)) cb(null, { offline: true });
        else cb('wrongPin');
      }
    }, 5000);
  }

  function bootstrap(cb) {
    req('GET', '/bootstrap', null, function (err, data) {
      if (err) { if (cb) cb(err); return; }
      write(KEYS.pinDefault, data.pinIsDefault ? '1' : '0');
      var local = getMenu();
      if ((!data.menu || !data.menu.length) && local.length) {
        // Fresh server — seed it with this device's menu (defaults or migrated).
        req('PUT', '/menu', { menu: local }, function () { if (cb) cb(null); });
        return;
      }
      if (data.menu && data.menu.length) write(KEYS.menu, data.menu);
      if (cb) cb(null);
    });
  }

  function isDefaultPinCached() {
    var f = read(KEYS.pinDefault, null);
    if (f === '1') return true;
    if (f === '0') return false;
    return isDefaultPin();
  }

  // --- Pull server truth into the cache --------------------------------
  function refreshSales(cb) {
    req('GET', '/sales', null, function (err, data) {
      if (err) { if (cb) cb(err); return; }
      var server = (data && data.sales) || [];
      var have = {};
      server.forEach(function (s) { have[s.id] = 1; });
      var queued = readOutbox().filter(function (s) { return !have[s.id]; });
      var next = server.concat(queued);
      var changed = JSON.stringify(next) !== JSON.stringify(getSales());
      if (changed) {
        write(KEYS.sales, next);
        var maxNo = read(KEYS.seq, 0) | 0;
        next.forEach(function (s) { if ((s.no | 0) > maxNo) maxNo = s.no | 0; });
        write(KEYS.seq, maxNo);
      }
      if (cb) cb(null, changed);
    });
  }

  function refreshExpenses(cb) {
    req('GET', '/expenses', null, function (err, data) {
      if (err) { if (cb) cb(err); return; }
      var changed = JSON.stringify(data.expenses || []) !== JSON.stringify(getExpenses()) ||
                    JSON.stringify(data.cats || []) !== JSON.stringify(getExpenseCats());
      if (changed) { write(KEYS.expenses, data.expenses || []); write(KEYS.expenseCats, data.cats || []); }
      if (cb) cb(null, changed);
    });
  }

  // --- Online-only mutations (back-office; the till itself never blocks) --
  function saveMenuRemote(menu, cb) {
    req('PUT', '/menu', { menu: menu }, function (err) {
      if (!err) saveMenu(menu);
      if (cb) cb(err);
    });
  }
  function setStockRemote(id, val, cb) {
    var stock = (val === null || val === '' || (typeof val === 'number' && isNaN(val)))
      ? null : Math.max(0, Math.floor(Number(val)) || 0);
    req('PATCH', '/stock', { id: id, stock: stock }, function (err) {
      if (!err) setStock(id, stock);
      if (cb) cb(err);
    });
  }
  function addExpenseRemote(e, cb) {
    req('POST', '/expenses', { expense: e }, function (err, data) {
      if (!err && data && data.expense) {
        var list = getExpenses().filter(function (x) { return x.id !== data.expense.id; });
        list.push(data.expense);
        list.sort(function (a, b) { return a.ts - b.ts; });
        write(KEYS.expenses, list);
      }
      if (cb) cb(err, data && data.expense);
    });
  }
  function updateExpenseRemote(id, patch, cb) {
    req('PATCH', '/expenses/' + encodeURIComponent(id), patch, function (err, data) {
      if (!err && data && data.expense) {
        var list = getExpenses();
        for (var i = 0; i < list.length; i++) if (list[i].id === id) list[i] = data.expense;
        write(KEYS.expenses, list);
      }
      if (cb) cb(err);
    });
  }
  function deleteExpenseRemote(id, cb) {
    req('DELETE', '/expenses/' + encodeURIComponent(id), null, function (err) {
      if (!err) deleteExpense(id);
      if (cb) cb(err);
    });
  }
  function addExpenseCatRemote(name, cb) {
    req('POST', '/cats', { name: name }, function (err, data) {
      if (!err && data) write(KEYS.expenseCats, data.cats || []);
      if (cb) cb(err);
    });
  }
  function deleteExpenseCatRemote(name, cb) {
    req('DELETE', '/cats/' + encodeURIComponent(name), null, function (err, data) {
      if (!err && data) write(KEYS.expenseCats, data.cats || []);
      if (cb) cb(err);
    });
  }
  function deleteSaleRemote(id, cb) {
    req('DELETE', '/sales/' + encodeURIComponent(id), null, function (err) {
      if (!err) { deleteSale(id); outboxRemove(id); }
      if (cb) cb(err);
    });
  }
  function clearSalesRemote(cb) {
    req('DELETE', '/sales', null, function (err) {
      if (!err) { clearSales(); write(KEYS.outbox, []); notify(); }
      if (cb) cb(err);
    });
  }
  function setPinRemote(current, next, cb) {
    req('POST', '/pin', { current: current, next: next }, function (err) {
      if (!err) { setPin(next); write(KEYS.pinDefault, next === DEFAULT_PIN ? '1' : '0'); }
      if (cb) cb(err);
    });
  }
  function importBackupRemote(text, cb) {
    var data;
    try { data = JSON.parse(text); } catch (e) { cb('parse'); return; }
    if (!data || typeof data !== 'object') { cb('shape'); return; }
    req('POST', '/import', data, function (err, res) {
      if (err) { cb(err); return; }
      // pull the merged truth back down before reporting success
      bootstrap(function () { refreshSales(function () { refreshExpenses(function () { cb(null, res); }); }); });
    });
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
    // pin (isDefaultPin prefers the server's cached answer)
    verifyPin: verifyPin, setPin: setPin, isDefaultPin: isDefaultPinCached,
    // menu
    getMenu: getMenu, saveMenu: saveMenu, resetMenu: resetMenu,
    // inventory
    setStock: setStock,
    // settings
    getSettings: getSettings, saveSettings: saveSettings,
    // sales
    getSales: getSales, recordSale: recordSale, deleteSale: deleteSale, clearSales: clearSales,
    // analytics
    statsForDay: statsForDay, lastDays: lastDays, allTime: allTime, dayKey: dayKey,
    // i18n + format
    t: t, money: money, num: num, toArabicDigits: toArabicDigits,
    // expenses
    getExpenses: getExpenses, addExpense: addExpense, updateExpense: updateExpense, deleteExpense: deleteExpense,
    getExpenseCats: getExpenseCats, addExpenseCat: addExpenseCat, deleteExpenseCat: deleteExpenseCat, finance: finance, expenseMonths: expenseMonths, monthOf: monthOf,
    // export / import
    salesToCSV: salesToCSV, backupJSON: backupJSON, importBackup: importBackup,
    // server sync
    login: login, bootstrap: bootstrap, startSync: startSync, syncNow: syncNow,
    refreshSales: refreshSales, refreshExpenses: refreshExpenses,
    isOnline: isOnline, pendingCount: pendingCount, onSync: onSync, onAuthLost: onAuthLost,
    saveMenuRemote: saveMenuRemote, setStockRemote: setStockRemote,
    addExpenseRemote: addExpenseRemote, updateExpenseRemote: updateExpenseRemote,
    deleteExpenseRemote: deleteExpenseRemote,
    addExpenseCatRemote: addExpenseCatRemote, deleteExpenseCatRemote: deleteExpenseCatRemote,
    deleteSaleRemote: deleteSaleRemote, clearSalesRemote: clearSalesRemote,
    setPinRemote: setPinRemote, importBackupRemote: importBackupRemote
  };

})(window);
