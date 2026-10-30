# Nexus Board

Owner entry: the **Board** tab in the Nexus Phone app, or `/board.html` (needs the Nexus owner session). It is a general-purpose surface, not a single-purpose editor: put anything on it, make it look like anything, and wire workflows around it later.

## What goes on a board

| Item | What it is | Where the data lives |
| --- | --- | --- |
| Inline visual | HTML or SVG pasted in (for example a visual Claude drew in chat) | In the board, up to 40 KB each. Runs in a sealed frame: `sandbox="allow-scripts"` (no same-origin), CSP with `connect-src 'none'`, no storage, no access to the page |
| Picture, clip, sound | Anything in the shared Lab media library | Only the media id is stored on the board. Originals and provenance stay in the library |
| Note | Sticky note, five colors | In the board |
| Sketch | Hand drawing (colors, three brush sizes, undo) | Strokes in the board |

Limits: 150 items, 40 boards per owner, 110 KB per saved board, 6000 sketch points. The server validates every field (`lib/nexusLabBoards.js`); visual code is stored as inert text and never interpreted by the server.

## Tools

- **Cut out** (pictures): trace the subject with a finger. The Lab pixel refiner (`nexus-lab-segment.js`) turns the rough outline into a clean edge. Nothing is saved until you press **Save cutout**; the result is stored in the Lab library as a `cutout` derived from the original and placed beside it on the board. Pictures are refined at up to 1.2 megapixels, so the cutout is saved at that working size.
- **Draw**, **Look** (plain, grid, dots, paper, night, plus background colors), **Fit**, move, resize, front/back, duplicate, rename, delete.
- Pinch or scroll to zoom, drag empty space to pan.

## Saving

Boards autosave about a second after a change. Each save carries the revision it was opened at, so a stale tab cannot overwrite a newer save: it gets a "Changed somewhere else" prompt instead. API actions (owner session and same-origin rule, same as the rest of Lab): `board_list`, `board_read`, `board_save`, `board_delete` on `/api/nexus-lab`.

## Wiring workflows

`window.nexusBoard` is the plug-in point. A workflow adds a button to the selected-item bar:

```js
window.nexusBoard.registerAction({
  id: 'make-ad', label: 'Make an ad', kinds: ['image', 'visual'],
  run: (item, board) => board.toast(`Starting from ${item.id}`),
});
```

Also available: `board` (a copy of the current board), `selected`, `addItem`, `updateItem`, `removeItem`, `toast`, and `request` (the Lab API). Events: `nexus-board:select`, `nexus-board:change`.

## Not built yet

Keep/remove touch-up strokes in the cutter, an Ad Maker scene item, background-job items, sharing a board, and a link from the web workspace home (today: the phone Board tab and the direct URL).

## Cut out: outline and touch up

- Outline by tracing with a finger, or switch to **Tap points** and tap around the subject, then **Finish outline**. Tapping is steadier on small screens and works with tools that can only tap.
- After the cut, paint **Keep** (green) over parts that went missing and **Remove** (red) over leftovers, in S/M/L brush sizes. Each stroke re-fits the edge using the Lab refiner's hint map, so a little paint steers the whole edge. **Undo** removes the last stroke; **Start over** returns to the outline.
- Saving writes the clean cutout (no paint) to the library as a derived `cutout` linked to the original.

Touch-ups run on a smaller working copy (about 0.4 megapixels) so each refit takes seconds on a phone; the saved cutout is scaled back to the picture's working size. A refit also stays inside your outline plus a small margin, so a stroke cannot pull in stray bits from across the picture. A Keep stroke can reach outside the outline to recover a part you missed.
