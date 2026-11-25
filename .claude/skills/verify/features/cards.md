# Cards

A host that supports MCP Apps shows each tool result as a card in place of the text: the headline figure, every warning, the inputs, and where the rates came from. An error shows as a card that says the tool could not answer, with the error's message and code.

## Sub-features

- `card-resource` serves each tool's `ui://` card as a non-empty resource.
- `card-melt` draws a melt value with its warnings, rows, and rate footnotes.
- `card-error` draws a tool error with its message and code.
- `card-theme` draws in light and dark.
- `card-width` fits at 560 px and at 375 px.

## How to get to it (user POV)

- Claude or another MCP Apps host calls a tool and shows the card linked from the tool's `_meta`.

## Driving it with verify.sh

Preconditions:

- `$V doctor` passes. It already proves `card-resource` for all four tools.
- Root dependencies are installed (`npm ci` at the root), for `playwright-core`.

- **Build, serve, and shoot.** Run `$V cards`. It prints the preview URL, the browser it used, and `shot 44 cards`: 11 scenarios in 2 themes at 2 widths. It exits non-zero and names the card if one has not drawn within 10 s.
- **Read the shots.** `evidence/cards/cards.txt` maps each number to its scenario, such as `06 Melt value, ambiguous unit (tool error)`. Open `<theme>-<width>-NN.png` for the cards your change touches, in all four variants. A melt card shows the metal, the value with its currency, every warning as a bullet, the rows, and the rate footnote. An error card shows "The tool could not answer" with the message and a code. At 375 px, no row value is cut off at the right edge. Card 11 shows the unit table, the gold and silver marks, and the purity forms.
- **Interactive check.** Open the printed URL in a browser. `Switch theme` (`#theme`) and `Switch width` (`#width`) change the page without reloading.

## Gotchas

- Chromium does not paint a card iframe that is off screen. A full-page screenshot or a headless `--screenshot` shows blank or "Waiting for the result." frames below the fold. `shoot-cards.mjs` scrolls each card into view first, so take any manual shot the same way.
- A viewport exactly as wide as the card clips its right column, because the preview page has its own padding. The shooter uses a viewport 105 px wider than each card.
- Under Playwright some frames come out taller than their card. The shooter crops each shot to the card's own height.
- The preview runs the real tools on the fake rates in `server/test/tools/fakes.ts`, not this run's Worker. It proves the drawing, not the live data.
- A change under `server/src/ui/view/` needs `npm run ui:build` before `cards`, or the preview shows the old bundle.
