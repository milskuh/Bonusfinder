---
name: Bonusfinder
description: Cross-store Dutch supermarket deals, read like price cards on a clean weekly shelf.
colors:
  brand-green: "#147a50"
  brand-green-light: "#2fb574"
  ink: "#14201a"
  surface: "#f9f9f7"
  foreground: "oklch(0.145 0 0)"
  background: "oklch(1 0 0)"
  card: "oklch(1 0 0)"
  muted-foreground: "oklch(0.5 0 0)"
  border: "oklch(0.922 0 0)"
  discount-red: "#dc2626"
  deal-ink: "#171717"
  best-deal-amber: "#b45309"
  header-tint: "#f3faf6"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.021em"
  display-compact:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.021em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  meta:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
    fontFeature: "tnum"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  price:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.3
    fontFeature: "tnum"
  micro:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.2
    fontFeature: "tnum"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  panel: "16px"
  pill: "9999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.brand-green}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  chip-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
    height: "44px"
  chip-selected:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.background}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
    height: "44px"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.panel}"
    padding: "8px"
  input-search:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.panel}"
    padding: "20px"
---

# Design System: Bonusfinder

## Overview

**Creative North Star: "The Weekly Shelf"**

Bonusfinder makes ten supermarkets' weekly bonus deals feel like one calm, well-stocked shelf. The core metaphor is retail price signage rendered with software precision: every offer is a **price card** — a white tile floating over a faint, drifting backdrop of supermarket logos, marked with a shelf-label price (small €, oversized whole number, raised cents) exactly the way a physical shelf edge reads. The interface is an Operate surface: a Dutch household shopper, usually on a phone, is scanning to decide where and what to buy, so scanability, honesty about money, and speed outrank expression. Brand lives in precise details — the green accent bar, the live count pill, the shelf-label numerals — not in decoration.

The system is bright, neutral, and low-noise by default: near-white surfaces, a single restrained green, and one workhorse typeface (Inter) carrying everything through weight and size rather than a decorative display face. Color is reserved for meaning — a red discount flag, a store's own brand color on its filter chip, an amber "best deal" star — so the eye lands on the deal, never on the chrome. Confirmed anti-references: no decorative/quirky display font on operational headings, no gradient text, no glass-as-decoration, and never a fabricated saving.

**Key Characteristics:**
- Price cards floating on hairline-bordered white panels over an ambient logo backdrop.
- Shelf-label price typography with tabular figures.
- One restrained green accent; color otherwise means something specific.
- Single-family Inter type; hierarchy from weight/size/tracking.
- Calm, dense, phone-first; motion is a quiet reveal, never a performance.

## Colors

A near-monochrome neutral base with one green brand accent, plus a tightly-scoped set of semantic signal colors.

### Primary
- **Bonus Green** (`#147a50`): the single brand accent — sign-up CTA, header accent bar, live-count pill, focus rings, the Top-deals flame. Kept rare so it reads as "the brand," not "a color."
- **Bonus Green Light** (`#2fb574`): the dark-mode counterpart of the accent (header bar, pill text), lifted for contrast on near-black.

### Neutral
- **Ink** (`oklch(0.145 0 0)` light foreground / `#14201a` brand ink): primary text and the filled state of selected filter chips.
- **Paper** (`oklch(1 0 0)`): page and card/panel surface in light mode; the whole system floats on white.
- **Muted Ink** (`oklch(0.5 0 0)`): secondary text — price-per-unit, validity dates, placeholders. Tuned to clear WCAG AA (~6:1) at the 11px label size.
- **Hairline** (`oklch(0.922 0 0)`): 0.5–1px borders and dividers that define panels without weight.

### Signal (semantic, meaning-bearing)
- **Discount Red** (`#dc2626`): the `-NN%` markdown flag on a card. Only ever a real discount.
- **Deal Ink** (`#171717`): the dark pill for structured deal text ("1+1 gratis", "2e halve prijs") when there's no single sale price.
- **Best-Deal Amber** (`#b45309` text / `#f59e0b` fill): the star marking a top-few discount in its category. Scarce by construction.
- **Store brand colors**: each supermarket's own hex (from `supermarkets.ts`) fills its filter chip when active. These are real chains' colors and are never rebranded.

### Named Rules
**The Color-Means-Something Rule.** Chrome is neutral. A saturated color appears only to carry meaning — brand (green), discount (red), deal text (ink), best-deal (amber), or a store's identity. If a color isn't saying one of those things, it's a mistake.

**The Honest-Money Rule.** No color, badge, or strike-through ever implies a saving that isn't real. Absent a genuine sale price, the card leads with the deal text, not an invented discount.

## Typography

**Display / Body / Everything Font:** Inter (with `ui-sans-serif, system-ui, sans-serif` fallback), self-hosted via next/font.

**Character:** One professional, neutral workhorse. Inter's excellent tabular figures make prices and unit-costs line up column-clean; hierarchy comes from weight, size, and tight tracking rather than a second decorative face. The register is minimal and trustworthy, not expressive.

### Hierarchy
- **Display** (600, 25px, -0.021em): the surface banner ("Aanbiedingen") and page titles. Semibold and tightly tracked — confident but understated. Shrinks to the **Display-compact** step (600, 19px) on phones so the deal grid rises toward the fold.
- **Title** (600, 18px, -0.01em): module headings like "Top deals deze week".
- **Body** (400–500, 14–16px, 1.5): product names, controls, copy. 16px on mobile inputs to stop iOS auto-zoom.
- **Price** (800, ~24–30px, tabular): the shelf label — small € (semibold), oversized whole number (extrabold), raised small cents; a struck-through original in Muted Ink beside it when present.
- **Meta** (600, 13px, tabular): the live count pill.
- **Label** (500, 11px, tabular): metadata — price-per-unit, validity date, chip text.
- **Micro** (700, 10px, tabular): the on-card badges — discount flag, "Beste deal" star, deal-text pill — at their compact phone size.

### Named Rules
**The Tabular-Price Rule.** Every number a shopper compares — prices, unit costs, discounts, counts — uses tabular figures so digits align vertically across cards.

**The One-Family Rule.** Inter carries all roles. Don't introduce a second typeface for "character"; earn hierarchy from weight and size.

## Layout

Centered single column, `max-width: 72rem` (max-w-6xl), gutter 12px on phones / 24px+ on desktop. The page is composed of **floating panels** (`.panel`): header, an optional Top-deals hero strip, a left store-filter sidebar (desktop only, lg+), a sticky filter bar, and the results panel — each a white card separated by gutters through which the ambient logo backdrop shows.

The offer grid is a responsive ladder: **2 columns on mobile**, 3 at md/lg, 4 at xl, with tighter gaps on phones so two cards get full width. The filter bar is `position: sticky; top: 0` so sort/search/category controls stay reachable while the grid scrolls beneath. Category filters collapse into ~4 expandable **group** headers (Vers / Voorraadkast / Dranken / Non-food) to keep visible decision points within working-memory limits; the store filter is a desktop sidebar and a mobile "Winkels" disclosure. Spacing rhythm: tight within a group, generous between panels (16–24px gutters).

## Elevation & Depth

Hybrid, but restrained: surfaces are defined primarily by **hairline borders on white**, lifted by a soft two-layer shadow. Depth is ambient, not dramatic — panels read as cards resting just above the backdrop, and the only real elevation *change* is a card's hover lift.

### Shadow Vocabulary
- **Panel rest** (`box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 10px 26px rgba(0,0,0,0.05)`): the standing shadow under every panel and card. Two layers — a tight contact shadow plus a wide soft one.
- **Card hover** (`shadow-xl` + `translateY(-4px)`): an offer card lifts on hover as the one active depth response.

### Named Rules
**The Hairline-First Rule.** Structure comes from a 0.5–1px border on white first; shadow only softens the edge. Never a heavy drop shadow where a hairline reads.

## Shapes

Rounded and friendly, on a clear radius ladder: **panels and cards 16px**, inputs 10px, small controls 6–8px, and **chips fully pill-shaped** (9999px). Borders are hairline (0.5–1px) in the neutral Hairline color; the header panel adds a single 4px rounded green accent bar down its left edge, inset from the corners so it reads as a floating rule, not a border. Product photos sit in a rounded "lightbox" plate at the top of each card (light in both themes, dimmed in dark so it never glows).

## Components

### Buttons
- **Shape:** rounded (6–8px); the sign-up CTA is the one filled brand button.
- **Primary (Sign up):** Bonus Green background, white text, `padding: 8px 12px`.
- **Ghost (nav / login):** transparent, Muted Ink text, hover fills with a faint accent tint.
- **Hover / Focus:** 150–200ms color transition; focus-visible shows a 2px Bonus Green ring.

### Chips (filters)
- **Style:** fully pill, `min-height: 44px`, hairline border on white.
- **Default:** Muted Ink text on white card; hover darkens border/text.
- **Selected:** filled Ink background, white text — except **store chips**, which fill with the store's own brand color when active.
- **Group headers:** carry a count badge of selected categories inside them and a chevron that rotates when the group is open.

### Cards / Containers
- **Corner Style:** 16px (panel/card radius).
- **Background:** white (`card`); product image plate is a light neutral gradient.
- **Shadow Strategy:** Panel-rest shadow at rest; offer cards add the hover lift.
- **Border:** 0.5–1px Hairline.
- **Internal Padding:** 8px on phone cards, up to 20px on desktop panels.

### Inputs / Fields
- **Style:** white background, Hairline border, 10px radius; a leading search icon and a trailing clear (✕) button.
- **Focus:** border shifts to Ink plus a 2px Ink ring; 16px text on mobile to prevent iOS zoom.

### Navigation
- **Style:** top bar, opaque white over the logo backdrop, hairline bottom border. Ghost links in Muted Ink; the sign-up CTA is the one filled green button. Theme + language toggles as icon buttons; Clerk `UserButton` when signed in.

### Signature: The Offer Card
A single price card: a rounded photo plate (with favorite + basket overlay buttons and a corner store logo), a discount/deal flag bottom-left, then the product name (2-line clamp), the shelf-label **Price** (small € · big whole · raised cents · struck original), and a hairline-topped metadata row (price-per-unit left, validity date right). An optional amber "Beste deal" star marks a top-few discount in its category.

## Do's and Don'ts

### Do:
- **Do** render prices as the shelf label (small € 600 · oversized whole 800 · raised cents) with tabular figures.
- **Do** keep chrome neutral and reserve saturated color for meaning (brand / discount / deal / best-deal / store identity).
- **Do** define surfaces with a hairline border on white first, then the soft two-layer shadow.
- **Do** keep filter decision points within ~4 visible groups; disclose the fine-grained chips on demand.
- **Do** keep touch targets ≥44px and metadata text at AA contrast even at 11px.

### Don't:
- **Don't** introduce a second, decorative typeface for headings — Inter carries every role.
- **Don't** show a discount %, strike-through, or "best deal" that isn't genuinely true.
- **Don't** rebrand a supermarket's own chip color.
- **Don't** use heavy drop shadows, gradient text, or glass-as-decoration.
- **Don't** let the product-image plate glow bright white inside a dark-mode card.
