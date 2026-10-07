# Campus Store visual design

The October 2026 redesign follows the request for a more creative interface while preserving all existing kiosk functions.

## Visual direction

- Campus café identity: cream canvas, forest green controls, warm yellow feature banner, terracotta accents, and pastel product illustrations.
- Serif display headings paired with system sans-serif labels. No remote fonts, image services, or new runtime dependencies.
- Illustrated welcome banner, six large product cards, selected quantity badges, and a clearly separated order panel.
- Consistent progress indicator, checkout cards, payment screens, success confirmation, and digital receipt.
- Hover and press feedback, visible keyboard focus, reduced motion support, and accessible live notifications.

## Functional contract

The six product names and prices are read from the existing API. Product selection, quantity controls (1–999), removal, totals, order review, and back navigation retain their existing behavior.

Selecting a catalog product now opens a confirmation dialog showing its name, one-unit price, and existing quantity where applicable. Only **Add to Order** adds the item. **Cancel** and Escape dismiss it without changing the order. Repeated submits cannot add the same pending selection twice. The background is inert while the dialog is open, keyboard focus stays inside it, and closing restores focus and scroll position. The existing cart +/− controls continue to adjust quantities directly. A product already at quantity 999 shows the limit notice instead of another confirmation.

Cash keeps amount validation, quick amounts, change preview, and insufficient payment errors. QR and card remain explicit simulations. Processing and uncertain payment states prevent conflicting submissions, and retries retain the existing duplicate protection.

The confirmation and receipt use the committed transaction snapshot. The receipt includes the transaction reference, Philippine date and time, items, quantities, unit prices, subtotals, total, payment method, amount paid, and change. New Transaction clears the current order and preserves completed history.

## Responsive and accessibility requirements

- Catalog changes from three to two columns as space narrows; the order panel moves below the products on phones.
- Payment choices become stacked tiles on phones; tables retain all required values.
- Enabled buttons remain at least 48 × 48 pixels.
- No horizontal page overflow on tested viewport widths, including 320px.
- Long notifications wrap and never intercept taps. Errors remain visible near the payment controls.
- Decorative illustrations are hidden from assistive technology. Existing input labels, button names, live regions, and progress semantics are preserved.

## Rendering and scrolling

Cart mutations update the affected row, selected badge, item count, and total in place. They preserve the catalog, illustrations, other cart rows, and focus. Currency formatting reuses one formatter. Updating a toast does not read layout or restart an animation. Product cards use static hover feedback with no animated shadows, transforms, or SVG filters. The desktop sticky order panel is isolated for compositing; phone layouts do not keep that layer.

The order panel displays up to three distinct product rows at once. A fourth product makes only the product list vertically scrollable; the order total, review action, and footer remain outside the scrolling region. The list exposes a visible scrollbar and instruction, supports keyboard focus and touch panning, and contains overscroll so reaching its edge does not unexpectedly move the page.

The Review Order table displays up to five distinct product rows without scrolling. A sixth product makes only the table vertically scrollable while the table headings remain visible and the order total and navigation actions stay outside the scrolling region. It uses the same visible scrollbar, instruction, keyboard focus, touch panning, and overscroll containment as the order panel.

## Verification

Run `npm run build` and `npm test` for syntax, assets, calculations, API validation, and persistence. Run `npm run test:browser` for ordering, payment, receipt, recovery, and responsive flows. `node tests/design.cjs` covers narrow layouts, long toast messages, maximum quantities, and large cash amounts. Browser scripts use the same optional Playwright setup documented in README.md and isolated test data.

`npm run test:confirmation` covers confirmation, cancellation, keyboard/touch behavior, scroll stability, rendering stability, and quantity limits. `npm run test:performance -- current` records comparative cart and scroll diagnostics in `test-results/performance/current.json`; it does not impose hardware-dependent FPS assertions.
