# Configurable Entities — Design

**Date:** 2026-06-22
**Branch:** `worktree-configurable-entities`
**Status:** Approved design, ready for implementation planning

## Problem

The widget hardcodes its set of entities (solar, home, grid, battery, car) and the
topology that connects them. Adding a new entity — e.g. a **Diesel Generator** — is
impossible without editing the source, even though the visual geometry (`energyPaths`,
`labels`) is already user-configurable via the `customPaths` field and the Path Tracer
tool.

The topology is hardcoded in **three** places that must stay in sync by hand:

1. `ui/components/UIEnergyOverview.vue` → the `routes` object (`{ group, reverse, opposite }`
   per route) — the real topology table.
2. `ui/components/UIEnergyOverview.vue` → `initializePulses()`, which assembles
   `pulseGroups` by literal name (`this.pulses.solarToInverter`, `inverterToGrid`, …) plus
   a special-case prefix match for `inverterToHome*`.
3. `nodes/ui-energy-overview.js` → `BIDIRECTIONAL_ROUTES`, a duplicated opposite-route map
   used during the `beforeSend` merge.

## Goals

- Let a user declare their own entity set (add a Diesel Generator, remove the car, etc.)
  with **no code changes**, by extending the existing `customPaths` JSON.
- Derive routes, pulse-groups, and the bidirectional map from **one data definition**
  (single source of truth), eliminating the three hardcoded tables.
- Preserve the current behaviour and message API exactly when no entity config is given
  (full backward compatibility).

## Non-Goals

- Arbitrary entity-to-entity connections. The model stays **hub-and-spoke**: every entity
  connects only to the central inverter. (Explicitly decided.)
- A Node-RED editor UI for adding entities row-by-row. Entities are declared in the
  `customPaths` JSON (authored by hand in Phase 1, by the Path Tracer in Phase 2).
- Making the central hub ("inverter") configurable or relabelable. It stays a fixed,
  label-less central node.

## Topology model

Hub-and-spoke. Each entity has exactly one **direction** relative to the inverter:

| `direction` | meaning              | example          |
|-------------|----------------------|------------------|
| `source`    | entity → inverter    | solar, generator |
| `sink`      | inverter → entity    | home             |
| `both`      | bidirectional        | grid, battery, car |

## Schema — extended `customPaths`

`customPaths` keeps `energyPaths` (flow geometry) and `labels` (label text + position),
and gains one **optional** `entities` block carrying topology only:

```json
{
  "entities": {
    "solar":     { "direction": "source" },
    "home":      { "direction": "sink"   },
    "grid":      { "direction": "both"   },
    "battery":   { "direction": "both"   },
    "car":       { "direction": "both"   },
    "generator": { "direction": "source" }
  },
  "energyPaths": {
    "solarToInverter":     "M ...",
    "inverterToHome":      ["M ...", "M ..."],
    "inverterToGrid":      "M ...",
    "inverterToBattery":   "M ...",
    "inverterToCar":       "M ...",
    "generatorToInverter": "M ..."
  },
  "labels": {
    "solar":     { "position": "M ...", "align": "top",    "text": "SOLAR" },
    "generator": { "position": "M ...", "align": "bottom", "text": "GENERATOR" }
  }
}
```

Single source of truth per concern:

- `entities[name].direction` → **topology** (the only field in an entity entry).
- `labels[name]` → label **text + position + align** (optional; text falls back to
  `name.toUpperCase()`, matching today's `cfg.label || name.toUpperCase()`).
- `energyPaths[<derived key>]` → flow **path geometry** (string, or array for multi-segment
  like home).

The `entities` key set **is** the group/label key set. `direction` is *not* duplicated in
`labels`; `text` is *not* duplicated in `entities`.

### Replace semantics

When the `entities` block is **present**, it **fully declares** the entity set — the
built-in defaults are not merged in. This gives true "pick your own entities," including
removing built-ins. When `entities` is **absent**, the built-in default topology applies
(current behaviour).

## Derivation rules (the single source of truth)

A pure function `deriveTopology(entities)` maps the entity declarations to the three
structures the engine needs. For entity key `<e>` with capitalized form `<E>`
(`grid` → `Grid`, `home` → `Home`):

| direction | forward path key  | routes generated                                                                 |
|-----------|-------------------|----------------------------------------------------------------------------------|
| `source`  | `<e>ToInverter`   | `<e>ToInverter` → `{ group: <e>, reverse: false, opposite: null }`               |
| `sink`    | `inverterTo<E>`   | `inverterTo<E>` → `{ group: <e>, reverse: false, opposite: null }`               |
| `both`    | `inverterTo<E>`   | `inverterTo<E>` → `{ group: <e>, reverse: false, opposite: <e>ToInverter }` **and** `<e>ToInverter` → `{ group: <e>, reverse: true, opposite: inverterTo<E> }` |

`deriveTopology` returns:

- `routes`: `{ [routeName]: { group, reverse, opposite } }` — replaces the hardcoded
  `routes` object in the Vue component.
- `pulseGroupKeys`: `{ [entity]: <forwardPathKey> }` — the rule for collecting pulses into
  a group. The component matches every pulse whose key equals the forward key **or** the
  forward key followed by a numeric suffix (so `inverterToHome` → `inverterToHome1`,
  `inverterToHome2`).
- `bidirectional`: `{ [routeName]: oppositeRouteName }` — replaces `BIDIRECTIONAL_ROUTES`
  in the node, built only from `both` entities.

### Parity guarantee

Run against the default entity set
(`solar: source, home: sink, grid: both, battery: both, car: both`), `deriveTopology`
reproduces **today's exact** `routes` table, pulse-group assembly, and
`BIDIRECTIONAL_ROUTES` map. Therefore:

- The message API is unchanged: `msg.payload.routes.inverterToGrid`,
  `.gridToInverter`, `.solarToInverter`, `.inverterToHome`, etc. all keep their names and
  meaning.
- Every existing flow keeps working untouched.

A unit test asserts this parity explicitly.

## Where the code changes

### New: `nodes/topology.js` (CommonJS, pure)

- Exports `deriveTopology(entities)` and a `DEFAULT_ENTITIES` constant
  (`solar/home/grid/battery/car` with their directions).
- Also exports `parseEntities(customPathsString)` → validated `entities` object or `null`
  (so both the node and the component parse/validate identically).
- Plain CommonJS (`module.exports`) so Node-RED can `require()` it at runtime, and Vite can
  bundle it into the UMD when the Vue component imports it.
- **First implementation step:** confirm Vite's CommonJS interop pulls this file into the
  UMD build cleanly. If interop is awkward, fall back to a single small duplicated function
  guarded by the parity unit test (see Risks).
- Ships automatically: the `package.json` `files` array already globs `nodes/*`, so
  `nodes/topology.js` is included with no change. (Tests therefore must **not** live under
  `nodes/` — see Testing strategy — or they'd ship too.)

### `ui/components/UIEnergyOverview.vue`

- Remove the literal `routes` object and the literal `pulseGroups` assembly in
  `initializePulses()`.
- Compute `routes` + group keys from `deriveTopology(activeEntities)`, where
  `activeEntities` = parsed `customPaths.entities` if present, else `DEFAULT_ENTITIES`.
- `initializePulses()` builds each `pulseGroups[entity]` by matching pulse keys against the
  `pulseGroupKeys[entity]` forward key (exact or numeric-suffixed), replacing the hardcoded
  group lines and the hardcoded `inverterToHome` prefix special-case.
- `defaultPulsePathsData` / `defaultLabelPathsData` remain the default **geometry**;
  `DEFAULT_ENTITIES` is the default **topology**. Together they equal today's behaviour.

### `nodes/ui-energy-overview.js`

- Replace the hardcoded `BIDIRECTIONAL_ROUTES` constant with a value derived from
  `parseEntities(config.customPaths)` (falling back to `DEFAULT_ENTITIES`) via
  `deriveTopology(...).bidirectional`.
- Derive once at node construction (config is static per deploy), not per message.

### `nodes/ui-energy-overview.html`

- Extend the `customPaths` validator to understand the optional `entities` block:
  - Show a summary: "N entities, M paths, K labels".
  - Surface errors: duplicate route names, reserved/invalid entity name (`inverter`,
    non-identifier characters), invalid `direction`, or an entity with no corresponding
    `energyPaths` geometry.
- Help text documents the `entities` block, the three `direction` values, and that
  providing `entities` replaces the default set.

## Validation rules (applied in `parseEntities`, surfaced in the editor)

- Entity name must be a non-empty identifier (`[A-Za-z][A-Za-z0-9_]*`), not `inverter`.
- `direction` ∈ `{ source, sink, both }`.
- Derived route names must be unique across all entities (capitalization collisions, e.g.
  `grid` vs `Grid`, are rejected).
- An entity should have geometry in `energyPaths` for its forward key; missing geometry is
  a warning (the route is declared but draws nothing) — matches today's tolerance for
  partial configs.
- On any hard validation failure, behaviour matches the current `parsedCustomPaths` policy:
  warn to console / editor and fall back to defaults rather than throwing.

## Testing strategy

This project has no test runner today (`npm run lint` has no committed config; `npm run
build` is the only green baseline). The pure derivation logic is the high-value thing to
test, and it needs zero new runtime dependencies:

- Add dev tests using Node's built-in runner (`node --test`, Node 18+; dev-only, not
  shipped, so the `engines: node >=14` runtime constraint is unaffected).
- Put tests in a top-level `test/` directory (which is **not** in `package.json` `files`,
  so they are never published) and add a `"test": "node --test test/"` script.
- Test cases:
  - **Parity:** `deriveTopology(DEFAULT_ENTITIES)` deep-equals the captured current
    `routes` / group keys / `BIDIRECTIONAL_ROUTES`.
  - Per-direction derivation: `source`, `sink`, `both`.
  - Array path expansion (`inverterToHome` → grouped `inverterToHome1/2`).
  - Capitalization (`grid` → `inverterToGrid` / `gridToInverter`).
  - Validation: duplicate route names, reserved name `inverter`, invalid direction,
    non-identifier name.
- Manual end-to-end: add a `generator` (`source`) entity via `customPaths` in the dev
  Node-RED instance; confirm the route animates on `msg.payload.routes.generatorToInverter`
  and the label renders.
- `npm run build` must stay green (verification command for this feature).

## Backward compatibility

- No `customPaths` → default geometry + `DEFAULT_ENTITIES` = pixel-identical to today.
- Legacy `customPaths` (only `energyPaths` + `labels`, no `entities`) → `DEFAULT_ENTITIES`
  topology with the legacy geometry overrides, exactly as today.
- New `customPaths` with `entities` → fully data-driven, replace semantics.
- Message API route names are unchanged for all default entities.

## Phase 2 — Path Tracer tool (notes for a future session)

Phase 1 leaves the `entities` block authored by hand. Phase 2 makes the Path Tracer
(`energy-path-tracer.html`) emit it so users never hand-edit JSON. Things for that future
session to keep in mind:

- The tracer currently emits only `energyPaths` + `labels` (see its `Build energyPaths
  object` section, ~line 1085, and its loader at ~line 1182). It must additionally emit an
  `entities` block.
- Each traced entity needs a **direction** choice in the tracer UI (`source` / `sink` /
  `both`). The direction determines the forward path key the tracer should write
  (`<e>ToInverter` vs `inverterTo<E>`) — the tracer must name the path key to match
  `deriveTopology`'s convention, or the runtime won't group it.
- The tracer should reuse the **same** validation (`parseEntities` rules: identifier names,
  no `inverter`, unique route names) so the editor and tracer never disagree.
- Multi-segment paths (home-style arrays) must remain expressible per entity.
- Keep the emitted JSON shape identical to this spec's schema so a blob round-trips between
  the tracer, the editor field, and the loader.
- Consider migrating the tracer's hardcoded default entity list to import/share
  `DEFAULT_ENTITIES` so all three surfaces (component, node, tracer) share one default.

## Risks / open items

- **Vite ↔ CommonJS interop** for `nodes/topology.js` imported by the Vue component. Verify
  early. Fallback: duplicate the small `deriveTopology` in the component, with the parity
  test asserting both implementations agree on `DEFAULT_ENTITIES`.
- **Capitalization convention** (`inverterTo<E>`) must exactly match the existing five
  routes — covered by the parity test.
- **`engines` vs `node --test`:** tests use Node 18+, runtime stays Node 14+ compatible;
  tests are dev-only and never shipped.
