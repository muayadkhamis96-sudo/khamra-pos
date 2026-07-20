# خمرة · Khamra POS

A clean, premium point‑of‑sale for the **Khamra (خمرة) specialty‑tea booth**.
Bilingual (Arabic / English), works fully **offline**, and stores every sale
locally on the device — no internet, server, or install required.

![brand](assets/logo.png)

---

## How to run

**Easiest:** double‑click `index.html` — it opens in your browser and works offline.

**Recommended for the booth — iPad mini** (tuned for it specifically):

1. Put the `Tea POS` folder online or on a small local server, e.g.:
   ```bash
   cd "Tea POS"
   python3 -m http.server 4173
   ```
2. Open it in **Safari** on the iPad, then **Share → Add to Home Screen**.
3. Launch it from the Home Screen icon — it runs **full‑screen** like a native
   app (no Safari bars).

Optimised for iPad mini in **both orientations**:
- **Landscape** → products grid + a fixed order panel (classic till layout).
- **Portrait** → products fill the screen with a slide‑up order sheet that
  shows the running total and a big Charge button.

Touch‑tuned: large tap targets, no accidental zoom, no rubber‑band scrolling,
and the layout respects the home‑indicator / status‑bar safe areas. To keep it
on one orientation, lock rotation in iPad Control Center.

> The very first time you open it online, the premium fonts download and cache.
> After that everything runs offline.

---

## Login

A PIN gate protects the till.

- **Default PIN: `123456`** (6 digits)
- Change it any time in **Settings → Security**. (The app warns you while the
  default PIN is still in use.)

---

## What it does

| Screen | What you get |
| --- | --- |
| **Sale** (نقطة البيع) | Tap products (with **photos**) to build an order, adjust quantities, take **Cash or Card**, and record the sale. Sweets you're tracking show how many are **left**, and a sold‑out one can't be added to an order. |
| **Inventory** (المخزون) | Set a stock count for each sweet. It **counts down automatically with every sale**, shows *"3 left"* on the sale grid, and flips to a **SOLD OUT** overlay at zero. Leave a count blank for unlimited — drinks are never tracked. |
| **Reports** (التقارير) | Today vs. all‑time **revenue**, order count, items sold, average order, a **7‑day revenue chart** (tap any day to open that day's full report), the **top‑selling product**, a best‑sellers ranking, and recent orders. The top seller only appears once one product genuinely leads — while sales are tied it shows *"no clear top seller yet."* **Download Excel** saves the whole report — summary, 7‑day breakdown, best sellers, that period's **expenses and net profit**, and *every* order line by line — for whichever period is on screen. |
| **Expenses** (المصاريف) | Log what the booth spends — **salary, rent, goods, other**, plus any categories you add yourself — and pick a month to see **revenue − expenses = net profit** for it. **Download Excel** exports that month's expenses with the profit line. |
| **Settings** (الإعدادات) | Switch language, change the PIN, edit menu items & prices, **add a real photo to each product**, and **export sales to CSV / back up to JSON / import a backup / clear history**. |

### Product photos

Two ways to add real photos. Items without a photo fall back to a themed line
icon, and a missing file degrades gracefully (no broken images).

**1 · Drop files in a folder** (best for setting up all items at once)
Put JPGs in `assets/products/` named by item id — they appear automatically on
the next load:

| File | Item |
| --- | --- |
| `karak.jpg` | كرك خمرة · Khamra Karak |
| `red-tea.jpg` | شاي أحمر · Red Tea |
| `hibiscus-peach.jpg` | كركدية خوخ · Peach Hibiscus |
| `hibiscus.jpg` | كركدية · Hibiscus |
| `honeycomb.jpg` | خلية نحل · Honeycomb |
| `cinnabon.jpg` | سينابون · Cinnamon Roll |
| `croissant-butter.jpg` | كرواسون زبدة · Butter Croissant |
| `croissant-choc.jpg` | كرواسون تشوكلت · Chocolate Croissant |

(See `assets/products/README.txt` for the same list.)

**2 · Upload inside the app** (quick, per item)
**Settings → Menu** → tap the square next to an item to attach a photo from the
tablet/gallery. It's auto‑resized and saved on the device. Tap the **×** to remove.

Photos show on the sale buttons, the best‑sellers list, and the top‑seller card.

Currency is **Omani Rial (OMR)** shown to 3 decimals, with the **new OMR symbol**
displayed next to every price (cards, cart, totals, Charge button, reports). The
symbol lives at `assets/omr.svg` — replace that one file to update it everywhere.

---

## Menu (editable in Settings)

**المشروبات · Drinks** — كرك خمرة 0.500 · شاي أحمر 0.500 · كركدية خوخ 1.000 · كركدية 0.800
**السويتات · Sweets** — خلية نحل 1.000 · سينابون 1.000 · كرواسون زبدة 0.500 · كرواسون تشوكلت 0.600

---

## Where the data lives

Menu, settings, sales, expenses and stock counts all live in the browser's
**localStorage** on the device — private and offline.

### Backup & restore

**Settings → Backup (JSON)** saves everything — menu, settings, sales,
expenses and your custom expense categories. The PIN is deliberately left out
of the file.

**Settings → Import backup** loads one back in, and it **merges**: any record
already on the device is left exactly as it is, and only what's missing gets
added. So you can

- restore onto a fresh device (nothing is there yet, so everything lands), or
- pull a second device's sales and expenses into this one without creating
  duplicates.

Importing the same file twice is harmless — the second time adds nothing. It
never deletes, never overwrites an existing record, and never touches your PIN
or language. Afterwards you're told exactly what was added (*"Added: 12 orders,
3 expenses"*), and anything unreadable in the file is skipped and counted
rather than silently dropped.

> Order numbering is bumped past any imported order, so the next sale you ring
> up can't reuse a number that arrived in the file.

Still take backups regularly — clearing the browser's website data wipes
everything on the device.

## Powered by Futureline.ai

The signature appears on the **lock screen** and at the **middle‑bottom of the
main (Sale) page**. It uses your official artwork via two image files (shown
automatically when present, with a recreated lockup as a temporary fallback):

| File | Used on |
| --- | --- |
| `assets/futureline-sign.png` | Main page (light background) — original colours, transparent bg |
| `assets/futureline-sign-light.png` | Lock screen (dark background) — light version for contrast |

Drop the original signature image into the project and these get generated from
it (background removed; a light variant for the dark lock screen).

## Files

```
index.html        app shell + icons
css/styles.css    theme & layout (tea palette)
js/data.js        storage, menu, stock, expenses, currency, analytics, i18n
js/app.js         PIN gate, sale flow, inventory, reports, expenses, settings
sw.js             service worker — offline cache (bump CACHE to push updates)
assets/           brand logo (dark + light)
```
