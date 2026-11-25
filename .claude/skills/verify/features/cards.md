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
- A browser tool: the Playwright MCP tools, or the browser pane.

- **Build and serve.** Run `$V cards`. It prints `cards http://127.0.0.1:<port>/index.html` and the evidence folder for the shots.
- **Open a variant.** Set the browser viewport to 480 x 900 for the 375 px cards, or 680 x 900 for the 560 px cards. Open `<url>?theme=light&width=375`, then the other three combinations of `theme=light|dark` and `width=560|375`.
- **Shoot each card in view.** For each card, scroll its iframe into view (`document.querySelectorAll('iframe')[i].scrollIntoView()`), wait 2 s, and take a viewport screenshot with a filename such as `$EVIDENCE/cards/<theme>-<width>-<i>.png`. Each iframe follows an H2-sized label naming its scenario, such as `Melt value, ambiguous unit (tool error)`.
- **Read the shots.** A melt card shows the metal, the value with its currency, every warning as a bullet, the rows, and the rate footnote. An error card shows "The tool could not answer" with the message and a code. At 375 px, no row value is cut off at the right edge. The last card, `Supported units and marks`, shows the unit table and the gold and silver marks.
- **Switch in place.** The `Switch theme` (`#theme`) and `Switch width` (`#width`) buttons change the open page without reloading.

## Gotchas

- Chromium does not paint a card iframe that is off screen. A full-page screenshot or a headless `--screenshot` shows blank or "Waiting for the result." frames below the fold. Shoot each card after you scroll it into view.
- A viewport exactly as wide as the card clips its right column, because the preview page has its own padding. Keep the viewport at least 105 px wider than the card.
- Frame heights can differ between browsers. In Playwright some frames come out taller than their card, with empty space below. That is the preview host's sizing, not the card. Judge the card's own box.
- The preview runs the real tools on the fake rates in `server/test/tools/fakes.ts`, not this run's Worker. It proves the drawing, not the live data.
- A change under `server/src/ui/view/` needs `npm run ui:build` before `cards`, or the preview shows the old bundle.
