# Path Tracer — Configurable Entities (Phase 2) — Design

**Date:** 2026-06-22
**Branch:** `worktree-configurable-entities`
**Status:** Approved design, ready for implementation planning
**Builds on:** [`2026-06-22-configurable-entities-design.md`](2026-06-22-configurable-entities-design.md) (Phase 1)

## Problem

Phase 1 made the runtime data-driven: `nodes/topology.js` is the single source of
truth for entities, route-key derivation, and validation, and `customPaths` gained an
optional `entities` block. But the Path Tracer (`energy-path-tracer.html`) — the tool
users open to draw flow geometry — was left in the Phase-1 state:

- It is **route-key-centric**, driven by two static objects: `routePathDefs` (keyed by
  `solarToInverter`, `inverterToHome1/2`, `inverterToGrid`, …) and `labelPathDefs`
  (keyed by `solar`, `home`, …).
- It has **no concept of an entity or a direction**.
- `initUI()` renders a fixed set of rows and addresses the DOM by hardcoded id
  (`path-${name}`); `inverterToHome` is special-cased by literal name.
- Export emits only `{ energyPaths, labels }`; the loader reads only those two keys.

So a user can add a Diesel Generator in the node's `customPaths` JSON by hand, but the
visual tool that exists precisely to author that geometry cannot add, rename, or delete
entities — it can only edit the five built-ins.

## Goals

- Let a user **add / rename / delete** entities in the tracer, each with a
  **direction** (`source` / `sink` / `both`).
- Default to **exactly today's** entity set and geometry on open
  (solar / home / grid / battery / car), so existing users see no change until they
  choose to.
- Emit the `entities` block alongside `energyPaths` and `labels`, in the **exact shape**
  Phase 1 defined, so a blob round-trips tracer → editor field → loader.
- Reuse the **same** derivation and validation rules as the runtime
  (`nodes/topology.js`) so the tracer can never emit a config the node rejects.

## Non-Goals

- Arbitrary entity-to-entity connections. The model stays **hub-and-spoke** (Phase 1
  decision); every entity connects only to the inverter.
- Making the central "inverter" hub configurable or relabelable.
- A test runner for the tracer itself. It is a standalone `file://` HTML page; the
  high-value logic it leans on (`deriveTopology`, `validateEntities`) is already unit
  tested. Tracer verification is manual (see Testing).
- Changing the drawing engine (M/L modes, shift-snap, point handling, image scaling).

## Decisions locked during brainstorming

1. **UI model: entity-centric cards.** One card per entity holding name, direction,
   geometry (multi-segment), and label fields. Add/rename/delete operate on cards.
   (Chosen over a dynamic two-section layout and a minimal free-rename approach.)
2. **Code sharing: share `nodes/topology.js`.** Add a browser-export footer to the
   module and load it with `<script src="nodes/topology.js">`. (Chosen over duplicating
   the rules inline in the tracer.)

## Architecture

### In-memory entity model (the backbone)

The tracer's two static objects are replaced by a single mutable array that rendering,
drawing, validation, and export all read from:

```js
let entities = [
  {
    id: 'e1',              // stable internal handle; survives rename / duplicate-name typos
    name: 'solar',         // user-editable; the entity/label/group key
    direction: 'source',   // 'source' | 'sink' | 'both'
    segments: ['M 427 295 L 484 332 L 484 533'],  // one or more path strings
    label: 'SOLAR',        // label text (falls back to name.toUpperCase())
    align: 'top',          // 'top' | 'bottom'
    dummyValue: '2.4 kW',  // preview-only; not exported
    dummySublabel: '12.5 kWh'  // preview-only; not exported
  },
  // …
]
```

- **`id`** is the addressing key for the DOM and for draw targets — *not* the entity
  name. Names can change or temporarily collide while typing; `id` is stable, so
  in-progress drawings and selection never break.
- **Route keys are never stored.** They are derived from `name` + `direction` via
  `Topology.deriveTopology` at render and export time.
- **`segments` is always an array.** This generalizes the current hardcoded
  `inverterToHome1` / `inverterToHome2` pair into "any entity, any number of segments,"
  removing the `inverterToHome` literal special-case.

### Shared module — `nodes/topology.js` browser footer

The single shipped-code edit. Keep `module.exports` for Node/Vite untouched; add a
browser global so the tracer can consume the identical functions:

```js
var api = {
  DEFAULT_ENTITIES: DEFAULT_ENTITIES,
  deriveTopology: deriveTopology,
  matchPulseGroups: matchPulseGroups,
  validateEntities: validateEntities,
  parseEntities: parseEntities,
  capitalize: capitalize,
  toInverterKey: toInverterKey,
  fromInverterKey: fromInverterKey
}
if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof window !== 'undefined') window.Topology = api
```

The tracer loads it in `<head>`:

```html
<script src="nodes/topology.js"></script>
```

This is consistent with how the tool is already opened: it references `house.png`
repo-relative, so it already assumes it runs from the repo root.

The functions the tracer actually needs:
- `deriveTopology(entities).pulseGroupKeys[name]` → the **forward path key** for an
  entity (the key under which geometry is stored).
- `deriveTopology(entities).routes` / `.bidirectional` → to display both key names for a
  `both` entity.
- `DEFAULT_ENTITIES` → seed entity identity + direction on open.
- `validateEntities(obj)` → live validation, identical to the editor and node.

### UI: one card per entity

`initUI()` iterates `entities[]` and builds a card per entry instead of iterating the
two static def objects. Card contents:

- **Name** — text input.
- **Direction** — `<select>`: source / sink / both.
- **Segments** — for each segment: a path text field + **Draw** button (targets
  `(entity.id, segmentIndex)`) + **remove-segment** button; plus a **+ segment** button.
- **Label** — text input (`label`) and **align** `<select>` (top / bottom). Live label
  preview as today.
- **Derived-key read-out** — small caption showing the key(s) `deriveTopology` produced
  (`source`/`sink` → one key; `both` → `inverterTo<E>` + `<e>ToInverter`).

Section-level controls:
- **+ Add entity** — appends a blank card (new `id`, default direction `source`, one
  empty segment).
- **× Delete** per card — removes the entity from the model and re-renders.

Rename is just editing the name field; keys re-derive and the read-out updates. No
geometry migration is needed because geometry lives on the entity by `id`, not by key.

The current split between "Route Paths" and "Label Paths" sections collapses: each
entity owns both its route geometry and its label in one card. (A single "Entities"
section.)

### Export → `{ entities, energyPaths, labels }`

Replaces the current builder (energy-path-tracer.html lines 1084–1139). Algorithm:

1. Build the `entities` object: `{ [name]: { direction } }` for every card.
2. `const { pulseGroupKeys } = Topology.deriveTopology(entitiesObj)`.
3. For each entity, `forwardKey = pulseGroupKeys[name]`; collect its non-empty
   `segments`. Write `energyPaths[forwardKey]` = the single string if one segment, or the
   array if ≥ 2. Skip entities with no geometry (a warning, not an error — matches the
   runtime's tolerance for partial configs).
4. `labels[name] = { position: <label path>, align, text }` for every card with a label
   path.

`both` entities emit geometry under the **forward key only** (`inverterTo<E>`); the
runtime renders the reverse direction by reversing that same path. This matches today's
default data exactly (only `inverterToGrid` / `inverterToBattery` / `inverterToCar`
carry geometry; there is no `gridToInverter` path string).

Output shape:

```json
{
  "entities":   { "solar": { "direction": "source" }, "...": {} },
  "energyPaths": { "solarToInverter": "M ...", "inverterToHome": ["M ...", "M ..."] },
  "labels":     { "solar": { "position": "M ...", "align": "top", "text": "SOLAR" } }
}
```

This is byte-compatible with the Phase 1 schema, so the blob round-trips through the
tracer, the node's `customPaths` field, and the loader.

### Import + backward compatibility

The loader (energy-path-tracer.html lines 1172–1230) rebuilds the `entities[]` model
and re-renders:

- **New blob (`entities` present):** rebuild directly. Direction comes from
  `entities[name].direction`; geometry from `energyPaths[forwardKey]` (an array becomes
  multiple segments, a string becomes one); label text/align from `labels[name]`.
- **Legacy blob (no `entities`):** reconstruct by name. Direction is taken from
  `Topology.DEFAULT_ENTITIES` when the name is a known default — which covers **every**
  real legacy export, since those predate custom entities. For an unknown legacy name,
  infer direction from the key shape present in `energyPaths`:
  - `<x>ToInverter` only → `source`
  - `inverterTo<X>` only → `sink` (note: ambiguous with `both`, see below)
  - both keys present → `both`

  The sink-vs-both ambiguity is genuine: a `both` entity stores geometry only under
  `inverterTo<E>`, identical to a `sink`. For unknown legacy names we default to `sink`
  and **flag the card** with a notice so the user can correct the direction dropdown.
  Known defaults resolve unambiguously via `DEFAULT_ENTITIES`, so this only affects
  hand-authored legacy blobs with non-default names — a rare, recoverable case.

The loader therefore round-trips the tracer's own new output losslessly.

### Validation — shared with the runtime

On every edit, build the `entities` object and run
`Topology.validateEntities(entitiesObj)`:

- Surface errors inline per card: non-identifier name, reserved name `inverter`,
  duplicate derived route key (including capitalization collisions like `grid` vs
  `Grid`), invalid direction (not reachable via the dropdown, but checked for safety).
- Show a header summary: "N entities, M paths, K labels".
- **Disable Export while hard errors exist.** Because this is the exact function the
  node and editor use, the tracer cannot produce a config the node would reject. Mirrors
  the editor validation added in commit `ccbf1c9`.

### Defaults on open

Cards seed from two sources combined at init:

- **Identity + direction** from `Topology.DEFAULT_ENTITIES`
  (solar=source, home=sink, grid/battery/car=both).
- **Geometry + label text + align + dummy values** from a tracer-local default map
  (the current `routePathDefs` / `labelPathDefs` contents, reorganized per entity;
  these are tool-specific reference geometry, not runtime topology, so they stay in the
  tracer).

Result: the tool opens showing exactly today's five entities with today's paths and
labels. "Still default to the values we have."

### Unchanged

The drawing engine (Move/Line modes, shift-snap, point capture, the green-start /
red-end markers), custom-image load, image scaling (`scaleFactor`, `REF_WIDTH/HEIGHT`),
and the coordinate readout are mechanically unchanged. They are rewired only to address
draw targets by `entity.id` + segment index (and the label target by `entity.id`)
instead of by `path-${name}` DOM ids.

## Where the code changes

### `nodes/topology.js`
- Add the dual-export footer (browser global + existing `module.exports`); widen the
  exported `api` to include `deriveTopology`, `DEFAULT_ENTITIES`, `validateEntities`
  (and the small helpers). No behavior change for Node or Vite.

### `energy-path-tracer.html`
- Add `<script src="nodes/topology.js">` in `<head>`.
- Replace `routePathDefs` / `labelPathDefs` static objects with: (a) a tracer-local
  default-geometry map keyed by entity name, and (b) the runtime-built `entities[]`
  model seeded from `DEFAULT_ENTITIES` + that map.
- Rewrite `initUI()` / `createPathEntry()` to render entity cards (name, direction,
  segments with add/remove, label, align, derived-key caption, delete) and an
  **+ Add entity** control.
- Rewire `renderAllPaths()`, `startDrawing()`, `stopDrawing()`, `clearPath()` and the
  point handlers to read/write the `entities[]` model and address targets by
  `entity.id` + segment index.
- Add live validation (`Topology.validateEntities`) with inline errors, a header
  summary, and Export disabling.
- Rewrite the export builder to emit `{ entities, energyPaths, labels }` via
  `deriveTopology`.
- Rewrite the loader to accept the `entities` block and to reconstruct legacy blobs by
  name (with direction inference + flagging as above).

## Testing strategy

- **Existing unit tests stand:** `node --test` already covers `deriveTopology` and
  `validateEntities` — the logic the tracer now depends on. The browser footer adds no
  new logic to test (it just re-exposes the same `api`); a one-line assertion that the
  module's `module.exports` still deep-equals its `api` keeps the footer honest.
- **Build stays green:** `npm run build` must succeed — the topology.js footer must not
  break the Vite UMD bundle. Verified explicitly.
- **Manual end-to-end (the tracer has no runner):**
  1. Open the tracer; confirm the five defaults render with today's geometry/labels.
  2. Add a `generator` entity (`source`), draw a path, set a label, export.
  3. Paste the exported blob into the node's `customPaths`; confirm
     `msg.payload.routes.generatorToInverter` animates and the GENERATOR label renders.
  4. Round-trip: Export → Load from JSON of the same blob → model is identical.
  5. Rename an entity; confirm the derived-key caption updates and export reflects it.
  6. Trigger each validation error (reserved `inverter`, bad identifier, duplicate key)
     and confirm inline errors + Export disabled.

## Backward compatibility

- Opening the tracer with no action → identical default cards → identical export to
  today's `{ energyPaths, labels }` *plus* an `entities` block describing the defaults.
  The added `entities` block is inert for default sets (it equals `DEFAULT_ENTITIES`),
  so the node behaves identically.
- Loading a legacy `{ energyPaths, labels }` blob → reconstructed against
  `DEFAULT_ENTITIES`, lossless for all real legacy exports.
- `nodes/topology.js` consumers (Node node, Vue component via Vite) are unaffected by
  the footer.

## Risks / open items

- **`<script src>` over `file://`:** loading `nodes/topology.js` relative to the tracer
  requires the tracer to be opened from the repo root (already true for `house.png`).
  Confirmed acceptable; documented in the tracer's instructions.
- **Vite/UMD with the footer:** the `if (typeof window …)` guard must not interfere with
  the bundle. Verify `npm run build` early.
- **Legacy sink-vs-both ambiguity:** handled by `DEFAULT_ENTITIES` lookup for known
  names and a visible flag for unknown ones; no silent misclassification.
- **Drawing rewire scope:** addressing targets by `id` instead of name touches the draw
  state machine. The mechanics don't change, but the indirection is the largest single
  edit; plan it as its own step.
