# DESIGN.md: Liminal Campervan Bar POS

## 1. Design Read & Liveliness Dials

> Reading this as: Tablet Point-of-Sale & Bar Counter System for Liminal Campervan Bar baristas, in a Retro Street-Coffee & Vintage Print Menu visual language, dial `ENERGY 2 / RHYTHM 2 / MOTION 1`.

- **ENERGY 2 (Balanced Street-Poster Character)**: Inspired directly by the physical Liminal Campervan Bar menu poster (`COFFEE. CULTURE. STREET.`), combining warm vintage paper (`#F3EAD8`), deep street navy ink (`#143656`), and bold crimson red (`#B3281B`) with crisp ink rules.
- **RHYTHM 2 (Structured Variation)**: On the POS screen, the 3 flagship **Signature** drinks (`El Tugra`, `Dirty Latte`, `Sparkling Fiesta Bubblegum`) receive an elevated horizontal showcase with tasting notes and larger `96px` photography, while the everyday espresso, manual brew, non-coffee, and squash drinks use high-density barista menu tiles grouped by category.
- **MOTION 1 (Tactile Instant Feedback)**: Immediate `:hover` and `:active` press states (`translate(1px, 1px)`) for fast thumb operation on an Android tablet; no endless pulses or decorative animations.

## 2. Color System (3 Core Colors + 1 Deliberate Accent, R-29)

Derived directly from the uploaded Liminal Campervan Bar logo and menu poster:

1. **Core 1 (Vintage Paper Canvas & Slip Surface)**:
   - Canvas: `#F3EAD8` (Vintage Poster Sand)
   - Card / Order Slip Surface: `#FAF5EA` (Warm Unbleached Paper)
   - Subtle Inset / Hover Surface: `#EAE0C8` (Pressed Kraft)
2. **Core 2 (Street Navy Ink & Structure)**:
   - Primary Structural Ink: `#143656` (Liminal Street Navy, sampled from `CAMPERVAN`, Arabic `ليمينال`, and poster section headers)
   - Deep Body Ink: `#1A1917` (Espresso Charcoal for body copy)
3. **Core 3 (Muted Slate & Ink Rules)**:
   - Secondary Copy: `#425264` (Muted Navy Slate)
   - Hairline Divider: `#C8BBA2` (Warm Paper Rule)
4. **1 Deliberate Accent (`#B3281B` Liminal Crimson Red)**:
   - Sampled from the `LIMINAL` block title, `BAR`, and the poster's racing checkerboard border.
   - Reserved strictly for the primary focal CTA (`Bayar / ACC Pesanan`, `Order Selesai`), active navigation tab underline, and the `★ SIGNATURE` section mark.

### Verified WCAG Contrast Ratios (`contrast-check.py`, R-25)

- `#1A1917` on `#F3EAD8`: **14.70:1** (PASS AAA)
- `#143656` on `#FAF5EA`: **11.42:1** (PASS AAA)
- `#143656` on `#F3EAD8`: **10.39:1** (PASS AAA)
- `#425264` on `#FAF5EA`: **7.36:1** (PASS AAA)
- `#425264` on `#F3EAD8`: **6.70:1** (PASS AA)
- `#FAF5EA` on `#143656`: **11.42:1** (PASS AAA)
- `#FFFFFF` on `#B3281B`: **6.49:1** (PASS AA)
- `#B3281B` on `#FAF5EA`: **5.97:1** (PASS AA)

## 3. Typography (R-06)

- **Display & Category Headers (`--font-display`)**: `Barlow Condensed` (`700`, `800`) to match the condensed poster typography of `SIGNATURE`, `ESPRESSO-BASED`, `MANUAL BREW`, `NON-COFFEE`, and `REFRESHERS` on the physical Liminal menu.
- **UI & Body Copy (`--font-sans`)**: `Plus Jakarta Sans` (`400`, `500`, `600`, `700`) for clear Indonesian labels and descriptions without artificial wide letter-spacing.
- **Prices, Order Codes & Totals (`--font-mono`)**: `IBM Plex Mono` (`500`, `600`, `700`) with `font-variant-numeric: tabular-nums` so Rupiah columns, cash change, and order codes (`LC-2026...`) align like a real printed receipt.

## 4. Identity Motif & Written Design Reasons (R-31)

- **Why the top counter navigation instead of a left sidebar**: A 256px left sidebar is a generic SaaS dashboard default that wastes 25% of horizontal tablet space; a top campervan counter bar gives 100% width to the two-column Menu Board + Order Slip layout.
- **Why the crimson checkerboard & double navy border motif**: Directly echoes the red racing-checkerboard blocks and double navy frame on the physical Liminal Campervan Bar menu poster, giving the app an unmistakable identity that belongs only to Liminal.
- **Why Signature cards differ from regular menu cards (`R-14`)**: `El Tugra`, `Dirty Latte`, and `Sparkling Fiesta Bubblegum` have full tasting descriptions and are the bar's signature drinks, so they sit in a highlighted 3-column showcase above the compact category rows.
- **Why the Order Ticket uses a perforated dashed tear-line and navy header band**: Mirrors a physical barista drink slip at the campervan counter, separating the customer's ordered items from the payment calculation.
- **Why radii are tight (`4px` to `6px`) with crisp `1.5px` ink borders (`R-11`, `R-12`)**: Replaces generic floating SaaS cards (`rounded-xl shadow-lg`) with flat, tactile print-menu geometry where elevation (`3px 3px 0 #143656`) appears only on selected/active items.
