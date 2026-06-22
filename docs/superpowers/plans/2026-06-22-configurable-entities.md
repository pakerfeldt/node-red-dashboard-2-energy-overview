# Configurable Entities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the widget's entity set data-driven so users can declare their own entities (e.g. a Diesel Generator) via the `customPaths` JSON, with zero code changes.

**Architecture:** A single pure CommonJS module (`nodes/topology.js`) derives routes, pulse-group keys, and the bidirectional map from an `entities` declaration. The Node-RED node `require`s it; the Vue component imports it (Vite bundles it into the UMD). The current five entities become the default declaration, so behaviour is identical when no `entities` block is provided. Hub-and-spoke only — every entity connects to the central inverter.

**Tech Stack:** Node-RED node (CommonJS), Vue 3 + Vuex component bundled by Vite (UMD), Node's built-in test runner (`node --test`).

## Global Constraints

- **Topology is hub-and-spoke only.** Every entity connects solely to the central inverter. No entity-to-entity edges.
- **Single source of truth:** all topology derivation lives in `nodes/topology.js`. Do not reintroduce hardcoded route/group/bidirectional tables anywhere else.
- **Backward compatibility is mandatory.** With no `customPaths` (or a legacy `customPaths` containing only `energyPaths` + `labels`), behaviour must be identical to today, and the message-API route names (`solarToInverter`, `inverterToGrid`, `gridToInverter`, `inverterToHome`, `inverterToBattery`, `batteryToInverter`, `inverterToCar`, `carToInverter`) must be unchanged.
- **Replace semantics:** when an `entities` block is present it *fully declares* the entity set; defaults are NOT merged in.
- **Route-key convention (must match exactly):** `source` → `<name>ToInverter`; `sink` → `inverterTo<Name>`; `both` → both, where `<Name>` is the entity name with its first character upper-cased.
- **Runtime stays Node ≥14 compatible.** `nodes/topology.js` and `nodes/ui-energy-overview.js` use conservative JS (no optional chaining / nullish coalescing). Tests may use `node --test` (Node ≥18); tests are dev-only and never shipped.
- **`nodes/topology.js` must be plain CommonJS** (`module.exports`) so Node-RED can `require()` it and Vite can bundle it. The Vue component imports it as a **default import** (`import EnergyTopology from '../../nodes/topology.js'`), not named imports.
- **Tests live in `test/`** (top-level), which is NOT in `package.json` `files`, so they are never published. (`nodes/*` is in `files`, so test files must not live under `nodes/`.)
- **Verification command is `npm run build`** (must stay green). `npm run lint` has no committed ESLint config and fails in any clean checkout — it is pre-existing and out of scope; do not rely on it.
- **Indentation:** `nodes/*.js` and `nodes/*.html` use **tabs**; the Vue component uses **4 spaces**. Match the file you edit.

---

### Task 1: Topology module + unit tests

**Files:**
- Create: `nodes/topology.js`
- Create: `test/topology.test.js`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: nothing.
- Produces (all on `module.exports`):
  - `DEFAULT_ENTITIES`: `{ solar:{direction:'source'}, home:{direction:'sink'}, grid:{direction:'both'}, battery:{direction:'both'}, car:{direction:'both'} }`
  - `deriveTopology(entities)` → `{ routes: { [routeName]: { group:string, reverse:boolean, opposite:string|null } }, pulseGroupKeys: { [entity]: string }, bidirectional: { [routeName]: string } }`
  - `matchPulseGroups(pulseNames: string[], pulseGroupKeys: {[entity]:string})` → `{ [entity]: string[] }`
  - `validateEntities(entities)` → `{ valid: boolean, errors: string[] }`
  - `parseEntities(customPathsString: string)` → validated `entities` object, or `null` (fall back to defaults)

- [ ] **Step 1: Write the failing tests**

Create `test/topology.test.js`:

```js
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const {
    DEFAULT_ENTITIES,
    deriveTopology,
    matchPulseGroups,
    validateEntities,
    parseEntities
} = require('../nodes/topology')

test('parity: default entities reproduce the original routes table', () => {
    const { routes } = deriveTopology(DEFAULT_ENTITIES)
    assert.deepStrictEqual(routes, {
        solarToInverter: { group: 'solar', reverse: false, opposite: null },
        inverterToHome: { group: 'home', reverse: false, opposite: null },
        inverterToGrid: { group: 'grid', reverse: false, opposite: 'gridToInverter' },
        gridToInverter: { group: 'grid', reverse: true, opposite: 'inverterToGrid' },
        inverterToBattery: { group: 'battery', reverse: false, opposite: 'batteryToInverter' },
        batteryToInverter: { group: 'battery', reverse: true, opposite: 'inverterToBattery' },
        inverterToCar: { group: 'car', reverse: false, opposite: 'carToInverter' },
        carToInverter: { group: 'car', reverse: true, opposite: 'inverterToCar' }
    })
})

test('parity: default entities reproduce the original bidirectional map', () => {
    const { bidirectional } = deriveTopology(DEFAULT_ENTITIES)
    assert.deepStrictEqual(bidirectional, {
        inverterToGrid: 'gridToInverter',
        gridToInverter: 'inverterToGrid',
        inverterToBattery: 'batteryToInverter',
        batteryToInverter: 'inverterToBattery',
        inverterToCar: 'carToInverter',
        carToInverter: 'inverterToCar'
    })
})

test('parity: default entities reproduce the original pulse-group keys', () => {
    const { pulseGroupKeys } = deriveTopology(DEFAULT_ENTITIES)
    assert.deepStrictEqual(pulseGroupKeys, {
        solar: 'solarToInverter',
        home: 'inverterToHome',
        grid: 'inverterToGrid',
        battery: 'inverterToBattery',
        car: 'inverterToCar'
    })
})

test('a source entity (generator) derives a one-way into-inverter route, no opposite', () => {
    const { routes, pulseGroupKeys, bidirectional } = deriveTopology({ generator: { direction: 'source' } })
    assert.deepStrictEqual(routes, {
        generatorToInverter: { group: 'generator', reverse: false, opposite: null }
    })
    assert.strictEqual(pulseGroupKeys.generator, 'generatorToInverter')
    assert.deepStrictEqual(bidirectional, {})
})

test('a sink entity derives a one-way out-of-inverter route', () => {
    const { routes, pulseGroupKeys } = deriveTopology({ pool: { direction: 'sink' } })
    assert.deepStrictEqual(routes, {
        inverterToPool: { group: 'pool', reverse: false, opposite: null }
    })
    assert.strictEqual(pulseGroupKeys.pool, 'inverterToPool')
})

test('matchPulseGroups maps suffixed and exact pulse keys to their entity', () => {
    const { pulseGroupKeys } = deriveTopology(DEFAULT_ENTITIES)
    const pulseNames = [
        'solarToInverter',
        'inverterToHome1', 'inverterToHome2',
        'inverterToGrid',
        'inverterToBattery',
        'inverterToCar'
    ]
    const groups = matchPulseGroups(pulseNames, pulseGroupKeys)
    assert.deepStrictEqual(groups.solar, ['solarToInverter'])
    assert.deepStrictEqual(groups.home, ['inverterToHome1', 'inverterToHome2'])
    assert.deepStrictEqual(groups.grid, ['inverterToGrid'])
    assert.deepStrictEqual(groups.battery, ['inverterToBattery'])
    assert.deepStrictEqual(groups.car, ['inverterToCar'])
})

test('validateEntities rejects invalid direction, reserved name, bad name, and duplicate routes', () => {
    assert.strictEqual(validateEntities({ x: { direction: 'sideways' } }).valid, false)
    assert.strictEqual(validateEntities({ inverter: { direction: 'source' } }).valid, false)
    assert.strictEqual(validateEntities({ '1bad': { direction: 'source' } }).valid, false)
    // 'grid' and 'Grid' both derive inverterToGrid → collision
    assert.strictEqual(validateEntities({ grid: { direction: 'both' }, Grid: { direction: 'both' } }).valid, false)
    assert.strictEqual(validateEntities(DEFAULT_ENTITIES).valid, true)
})

test('parseEntities returns null for blank/invalid/entity-less input and the object when valid', () => {
    assert.strictEqual(parseEntities(''), null)
    assert.strictEqual(parseEntities('   '), null)
    assert.strictEqual(parseEntities('not json'), null)
    assert.strictEqual(parseEntities(JSON.stringify({ energyPaths: {}, labels: {} })), null)
    assert.strictEqual(parseEntities(JSON.stringify({ entities: { x: { direction: 'nope' } } })), null)
    const ok = JSON.stringify({ entities: { generator: { direction: 'source' } } })
    assert.deepStrictEqual(parseEntities(ok), { generator: { direction: 'source' } })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/`
Expected: FAIL — `Cannot find module '../nodes/topology'`.

- [ ] **Step 3: Implement `nodes/topology.js`**

Create `nodes/topology.js`:

```js
'use strict'

// Single source of truth for the widget's hub-and-spoke topology.
// Loaded by the Node-RED node via require(), and bundled into the UMD by Vite
// when the Vue component imports it. Plain CommonJS, Node >=14 compatible.

// The built-in entity set. Providing a custom `entities` block REPLACES this.
var DEFAULT_ENTITIES = {
    solar: { direction: 'source' },
    home: { direction: 'sink' },
    grid: { direction: 'both' },
    battery: { direction: 'both' },
    car: { direction: 'both' }
}

var VALID_DIRECTIONS = ['source', 'sink', 'both']
var RESERVED_NAMES = ['inverter']
var NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/

function capitalize (name) {
    return name.charAt(0).toUpperCase() + name.slice(1)
}

// Route-key conventions (must match the original hardcoded routes):
//   source -> "<name>ToInverter", sink -> "inverterTo<Name>", both -> both.
function toInverterKey (name) {
    return name + 'ToInverter'
}
function fromInverterKey (name) {
    return 'inverterTo' + capitalize(name)
}

// Derive routes, pulse-group keys, and the bidirectional map from an entity set.
function deriveTopology (entities) {
    var routes = {}
    var pulseGroupKeys = {}
    var bidirectional = {}

    Object.keys(entities).forEach(function (name) {
        var direction = entities[name] && entities[name].direction
        var toInv = toInverterKey(name)
        var fromInv = fromInverterKey(name)

        if (direction === 'source') {
            routes[toInv] = { group: name, reverse: false, opposite: null }
            pulseGroupKeys[name] = toInv
        } else if (direction === 'sink') {
            routes[fromInv] = { group: name, reverse: false, opposite: null }
            pulseGroupKeys[name] = fromInv
        } else if (direction === 'both') {
            routes[fromInv] = { group: name, reverse: false, opposite: toInv }
            routes[toInv] = { group: name, reverse: true, opposite: fromInv }
            pulseGroupKeys[name] = fromInv
            bidirectional[fromInv] = toInv
            bidirectional[toInv] = fromInv
        }
    })

    return { routes: routes, pulseGroupKeys: pulseGroupKeys, bidirectional: bidirectional }
}

// Map actual pulse path keys to their entity group. A group's forward key matches
// either an exact pulse key or that key followed by a numeric suffix
// (e.g. "inverterToHome" -> "inverterToHome1", "inverterToHome2").
function matchPulseGroups (pulseNames, pulseGroupKeys) {
    var groups = {}
    Object.keys(pulseGroupKeys).forEach(function (entity) {
        var forwardKey = pulseGroupKeys[entity]
        groups[entity] = pulseNames.filter(function (name) {
            if (name === forwardKey) return true
            if (name.indexOf(forwardKey) === 0) {
                return /^\d+$/.test(name.slice(forwardKey.length))
            }
            return false
        })
    })
    return groups
}

// Validate a raw `entities` object. Returns { valid, errors }.
function validateEntities (entities) {
    var errors = []
    if (typeof entities !== 'object' || entities === null || Array.isArray(entities)) {
        return { valid: false, errors: ['entities must be an object'] }
    }
    var names = Object.keys(entities)
    if (names.length === 0) {
        return { valid: false, errors: ['entities must declare at least one entity'] }
    }
    var seenRoutes = {}
    names.forEach(function (name) {
        if (!NAME_RE.test(name)) {
            errors.push('Invalid entity name "' + name + '" (letters, digits, underscore; must start with a letter)')
        }
        if (RESERVED_NAMES.indexOf(name.toLowerCase()) !== -1) {
            errors.push('Reserved entity name "' + name + '"')
        }
        var entity = entities[name]
        var direction = entity && entity.direction
        if (VALID_DIRECTIONS.indexOf(direction) === -1) {
            errors.push('Entity "' + name + '" has invalid direction "' + direction + '" (expected source, sink or both)')
            return
        }
        var keys = direction === 'source'
            ? [toInverterKey(name)]
            : direction === 'sink'
                ? [fromInverterKey(name)]
                : [fromInverterKey(name), toInverterKey(name)]
        keys.forEach(function (k) {
            if (seenRoutes[k]) {
                errors.push('Duplicate route "' + k + '" from entities "' + seenRoutes[k] + '" and "' + name + '"')
            } else {
                seenRoutes[k] = name
            }
        })
    })
    return { valid: errors.length === 0, errors: errors }
}

// Parse the customPaths JSON string and return a validated `entities` object,
// or null to signal "fall back to DEFAULT_ENTITIES".
function parseEntities (customPathsString) {
    if (!customPathsString || typeof customPathsString !== 'string' || customPathsString.trim() === '') {
        return null
    }
    var parsed
    try {
        parsed = JSON.parse(customPathsString)
    } catch (e) {
        return null
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.entities) {
        return null
    }
    if (!validateEntities(parsed.entities).valid) {
        return null
    }
    return parsed.entities
}

module.exports = {
    DEFAULT_ENTITIES: DEFAULT_ENTITIES,
    deriveTopology: deriveTopology,
    matchPulseGroups: matchPulseGroups,
    validateEntities: validateEntities,
    parseEntities: parseEntities
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/`
Expected: PASS — all tests, 0 failures.

- [ ] **Step 5: Add the `test` script to `package.json`**

In `package.json`, in the `scripts` block, add a `test` entry (place it before `"build"`):

```json
        "test": "node --test test/",
```

Verify: `npm test` runs the suite and passes.

- [ ] **Step 6: Commit**

```bash
git add nodes/topology.js test/topology.test.js package.json
git commit -m "Add data-driven topology module with parity tests"
```

---

### Task 2: Wire the node backend to the derived bidirectional map

**Files:**
- Modify: `nodes/ui-energy-overview.js` (add require at top; remove hardcoded `BIDIRECTIONAL_ROUTES`; derive it per-node from config)

**Interfaces:**
- Consumes: `deriveTopology`, `parseEntities`, `DEFAULT_ENTITIES` from `./topology` (Task 1).
- Produces: no new exports. The node's `beforeSend` continues to read a `BIDIRECTIONAL_ROUTES` map; it is now derived rather than hardcoded.

- [ ] **Step 1: Add the require at the top of the file**

In `nodes/ui-energy-overview.js`, the file currently starts with:

```js
module.exports = function(RED) {
	const path = require('path')
```

Insert the topology require as the first line of the file (above `module.exports`), using tabs nowhere (it is at column 0):

```js
const { deriveTopology, parseEntities, DEFAULT_ENTITIES } = require('./topology')

module.exports = function(RED) {
	const path = require('path')
```

- [ ] **Step 2: Remove the hardcoded `BIDIRECTIONAL_ROUTES` constant**

Delete this entire block (currently lines 60–67, tab-indented):

```js
	const BIDIRECTIONAL_ROUTES = {
		inverterToGrid: 'gridToInverter',
		gridToInverter: 'inverterToGrid',
		inverterToBattery: 'batteryToInverter',
		batteryToInverter: 'inverterToBattery',
		inverterToCar: 'carToInverter',
		carToInverter: 'inverterToCar'
	}
```

- [ ] **Step 3: Derive `BIDIRECTIONAL_ROUTES` per node from config**

In `UIEnergyOverviewNode(config)`, the constructor currently has:

```js
		const node = this

		const group = RED.nodes.getNode(config.group)
```

Insert the derivation right after `const node = this` (tab-indented to match):

```js
		const node = this

		// Derive the bidirectional route map from the configured entities
		// (falls back to the built-in set). Single source of truth: ./topology.
		const entities = parseEntities(config.customPaths) || DEFAULT_ENTITIES
		const BIDIRECTIONAL_ROUTES = deriveTopology(entities).bidirectional

		const group = RED.nodes.getNode(config.group)
```

`beforeSend` is defined inside this constructor, so it closes over the new `BIDIRECTIONAL_ROUTES` const unchanged.

- [ ] **Step 4: Verify the file parses and topology behaviour is preserved**

Run: `node --check nodes/ui-energy-overview.js`
Expected: no output, exit 0 (valid syntax).

Run: `node --test test/`
Expected: PASS. (The parity test in Task 1 proves `deriveTopology(DEFAULT_ENTITIES).bidirectional` equals the deleted hardcoded map, so the merge behaviour is unchanged for default configs.)

- [ ] **Step 5: Commit**

```bash
git add nodes/ui-energy-overview.js
git commit -m "Derive node bidirectional route map from topology module"
```

---

### Task 3: Wire the Vue component to the derived topology

**Files:**
- Modify: `ui/components/UIEnergyOverview.vue` (import module; remove hardcoded `routes` data; add `activeEntities`/`topology` computeds; replace `this.routes` usages; rewrite pulse-group assembly in `initializePulses`)
- Possibly modify: `vite.config.mjs` (only if the CommonJS interop check in Step 6 fails)

**Interfaces:**
- Consumes: `EnergyTopology.parseEntities`, `.deriveTopology`, `.matchPulseGroups`, `.DEFAULT_ENTITIES` from `../../nodes/topology.js` (Task 1).
- Produces: `this.topology` (computed) → `{ routes, pulseGroupKeys, bidirectional }`; `this.activeEntities` (computed) → entity map. Replaces the removed `this.routes` data property.

- [ ] **Step 1: Add the default import**

In `ui/components/UIEnergyOverview.vue`, the `<script>` currently starts:

```js
import { mapState } from 'vuex'

const DEFAULT_HOUSE_IMAGE = '/ui-energy-overview/resources/house.webp'
```

Add the topology import below the vuex import (default import — see Global Constraints):

```js
import { mapState } from 'vuex'
import EnergyTopology from '../../nodes/topology.js'

const DEFAULT_HOUSE_IMAGE = '/ui-energy-overview/resources/house.webp'
```

- [ ] **Step 2: Remove the hardcoded `routes` data property**

In `data()`, delete the entire `routes: { ... }` object. It is the **last** property in the `data()` return object — currently lines 70–111, beginning `routes: {` and ending at its closing `}` on line 111 (the next line, `}`, closes the return object). Delete those lines. The preceding property `defaultLabelPathsData: { ... },` keeps its trailing comma, which is valid as the final property of an object literal. Leave the rest of `data()` intact.

- [ ] **Step 3: Add `activeEntities` and `topology` computeds**

In the `computed:` block, add these two computeds (4-space indent, place them right after the `parsedCustomPaths () { ... }` computed so all config-derived computeds sit together):

```js
        activeEntities () {
            return EnergyTopology.parseEntities(this.getProperty('customPaths')) || EnergyTopology.DEFAULT_ENTITIES
        },
        topology () {
            return EnergyTopology.deriveTopology(this.activeEntities)
        },
```

- [ ] **Step 4: Replace the three `this.routes` usages with `this.topology.routes`**

In `handleMessage`, change:

```js
            Object.keys(this.routes).forEach(routeName => {
```
to:
```js
            Object.keys(this.topology.routes).forEach(routeName => {
```

In `activateRoute`, change:

```js
            const route = this.routes[routeName]
```
to:
```js
            const route = this.topology.routes[routeName]
```

In `deactivateRoute`, change:

```js
            const route = this.routes[routeName]
```
to:
```js
            const route = this.topology.routes[routeName]
```

(There are exactly three `this.routes[...]` / `this.routes)` references; all three move to `this.topology.routes`.)

- [ ] **Step 5: Rewrite the pulse-group assembly in `initializePulses`**

In `initializePulses`, the tail currently reads:

```js
            this.pulseGroups.solar = [this.pulses.solarToInverter].filter(Boolean)
            
            const homePaths = Object.keys(this.pulses)
                .filter(name => name.startsWith('inverterToHome'))
                .map(name => this.pulses[name])
                .filter(Boolean)
            this.pulseGroups.home = homePaths.length > 0 ? homePaths : []
            
            this.pulseGroups.grid = [this.pulses.inverterToGrid].filter(Boolean)
            this.pulseGroups.battery = [this.pulses.inverterToBattery].filter(Boolean)
            this.pulseGroups.car = [this.pulses.inverterToCar].filter(Boolean)
```

Replace that whole tail with the data-driven assembly:

```js
            const grouped = EnergyTopology.matchPulseGroups(Object.keys(this.pulses), this.topology.pulseGroupKeys)
            this.pulseGroups = {}
            Object.keys(grouped).forEach(entity => {
                this.pulseGroups[entity] = grouped[entity]
                    .map(name => this.pulses[name])
                    .filter(Boolean)
            })
```

- [ ] **Step 6: Build and verify the CommonJS module was bundled (interop check)**

Run: `npm run build`
Expected: build succeeds (`✓ built` with the UMD size line).

Then confirm `nodes/topology.js` was actually pulled into the bundle (proves Vite's CommonJS interop worked):

Run: `grep -c "entities must be an object" resources/ui-energy-overview.umd.js`
Expected: `1` (or greater). This string only exists in `nodes/topology.js`; its presence proves the module was bundled.

**If the count is `0`** (interop failed), force the CommonJS plugin to transform the source file: in `vite.config.mjs`, inside the `build: {` object, add a `commonjsOptions` key alongside `sourcemap`:

```js
    build: {
        sourcemap: process.env.NODE_ENV === 'development',

        commonjsOptions: {
            include: [/nodes\/topology\.js$/, /node_modules/]
        },
```

Then re-run `npm run build` and re-run the grep; expect `1`.

- [ ] **Step 7: Run the topology tests (unchanged, must still pass)**

Run: `node --test test/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add ui/components/UIEnergyOverview.vue
# stage vite.config.mjs as well ONLY if Step 6 required the commonjsOptions fallback:
# git add vite.config.mjs
git commit -m "Drive component routes and pulse groups from topology module"
```

(Do NOT stage `resources/ui-energy-overview.umd.js` or `ui/dist/` — they are gitignored build artifacts, regenerated at publish time by `prepublishOnly`. `git status` will not show them.)

---

### Task 4: Editor validation and help text for the `entities` block

**Files:**
- Modify: `nodes/ui-energy-overview.html` (add a browser-side validator helper; extend `customPaths` `defaults.validate`; extend `validateCustomPaths` in `oneditprepare`; add help documentation)

**Interfaces:**
- Consumes: nothing at runtime (the editor cannot `require` the node module; it uses a small local copy of the validation rules).
- Produces: editor-only UX. Authoritative validation remains in `nodes/topology.js`.

- [ ] **Step 1: Add a browser-side entity-validation helper**

In `nodes/ui-energy-overview.html`, the editor script begins:

```js
<script type="text/javascript">
    RED.nodes.registerType('ui-energy-overview', {
```

Insert a helper function between the `<script>` tag and `RED.nodes.registerType` (this mirrors `validateEntities` in `nodes/topology.js`; keep them in sync — the node module is authoritative):

```js
<script type="text/javascript">
    // Mirror of validateEntities() in nodes/topology.js for editor-side feedback.
    // The runtime (node + component) is authoritative; this is UX only.
    function validateEnergyEntities(entities) {
        var errors = [];
        var validDirections = ['source', 'sink', 'both'];
        var nameRe = /^[A-Za-z][A-Za-z0-9_]*$/;
        if (typeof entities !== 'object' || entities === null || Array.isArray(entities)) {
            return { valid: false, errors: ['entities must be an object'] };
        }
        var names = Object.keys(entities);
        if (names.length === 0) {
            return { valid: false, errors: ['entities must declare at least one entity'] };
        }
        var seen = {};
        names.forEach(function (name) {
            if (!nameRe.test(name)) {
                errors.push('Invalid entity name "' + name + '"');
            }
            if (name.toLowerCase() === 'inverter') {
                errors.push('Reserved entity name "' + name + '"');
            }
            var direction = entities[name] && entities[name].direction;
            if (validDirections.indexOf(direction) === -1) {
                errors.push('Entity "' + name + '" has invalid direction "' + direction + '"');
                return;
            }
            var cap = name.charAt(0).toUpperCase() + name.slice(1);
            var keys = direction === 'source' ? [name + 'ToInverter']
                : direction === 'sink' ? ['inverterTo' + cap]
                    : ['inverterTo' + cap, name + 'ToInverter'];
            keys.forEach(function (k) {
                if (seen[k]) {
                    errors.push('Duplicate route "' + k + '"');
                } else {
                    seen[k] = name;
                }
            });
        });
        return { valid: errors.length === 0, errors: errors };
    }

    RED.nodes.registerType('ui-energy-overview', {
```

- [ ] **Step 2: Extend the `customPaths` `defaults.validate`**

The `customPaths` default currently is:

```js
            customPaths: { 
                value: "",
                validate: function(v) {
                    if (!v || v.trim() === "") return true
                    try {
                        const parsed = JSON.parse(v)
                        return parsed.energyPaths && parsed.labels
                    } catch (e) {
                        return false
                    }
                }
            },
```

Replace the `validate` function body so an `entities` block is validated and still requires geometry:

```js
            customPaths: { 
                value: "",
                validate: function(v) {
                    if (!v || v.trim() === "") return true
                    try {
                        const parsed = JSON.parse(v)
                        if (parsed.entities) {
                            return validateEnergyEntities(parsed.entities).valid && !!parsed.energyPaths && !!parsed.labels
                        }
                        return parsed.energyPaths && parsed.labels
                    } catch (e) {
                        return false
                    }
                }
            },
```

- [ ] **Step 3: Extend the live `validateCustomPaths` feedback in `oneditprepare`**

The function currently is:

```js
            function validateCustomPaths() {
                const value = $customPaths.val().trim();
                if (!value) {
                    $validationStatus.html('<span style="color: #888;">Using default paths</span>');
                    $customPaths.removeClass('input-error');
                    return;
                }
                try {
                    const parsed = JSON.parse(value);
                    if (parsed.energyPaths && parsed.labels) {
                        const pathCount = Object.keys(parsed.energyPaths).length;
                        const labelCount = Object.keys(parsed.labels).length;
                        $validationStatus.html('<span style="color: #5a5;">Valid JSON: ' + pathCount + ' energy paths, ' + labelCount + ' labels</span>');
                        $customPaths.removeClass('input-error');
                    } else {
                        $validationStatus.html('<span style="color: #d55;">Missing required fields: energyPaths and/or labels</span>');
                        $customPaths.addClass('input-error');
                    }
                } catch (e) {
                    $validationStatus.html('<span style="color: #d55;">Invalid JSON: ' + e.message + '</span>');
                    $customPaths.addClass('input-error');
                }
            }
```

Replace it with a version that reports entity errors and counts:

```js
            function validateCustomPaths() {
                const value = $customPaths.val().trim();
                if (!value) {
                    $validationStatus.html('<span style="color: #888;">Using default paths</span>');
                    $customPaths.removeClass('input-error');
                    return;
                }
                try {
                    const parsed = JSON.parse(value);
                    if (parsed.entities) {
                        const result = validateEnergyEntities(parsed.entities);
                        if (!result.valid) {
                            $validationStatus.html('<span style="color: #d55;">Entity errors: ' + result.errors.join('; ') + '</span>');
                            $customPaths.addClass('input-error');
                            return;
                        }
                        if (!parsed.energyPaths || !parsed.labels) {
                            $validationStatus.html('<span style="color: #d55;">entities provided but energyPaths and/or labels are missing</span>');
                            $customPaths.addClass('input-error');
                            return;
                        }
                        const entityCount = Object.keys(parsed.entities).length;
                        const pathCount = Object.keys(parsed.energyPaths).length;
                        const labelCount = Object.keys(parsed.labels).length;
                        $validationStatus.html('<span style="color: #5a5;">Valid JSON: ' + entityCount + ' entities, ' + pathCount + ' energy paths, ' + labelCount + ' labels</span>');
                        $customPaths.removeClass('input-error');
                        return;
                    }
                    if (parsed.energyPaths && parsed.labels) {
                        const pathCount = Object.keys(parsed.energyPaths).length;
                        const labelCount = Object.keys(parsed.labels).length;
                        $validationStatus.html('<span style="color: #5a5;">Valid JSON: ' + pathCount + ' energy paths, ' + labelCount + ' labels</span>');
                        $customPaths.removeClass('input-error');
                    } else {
                        $validationStatus.html('<span style="color: #d55;">Missing required fields: energyPaths and/or labels</span>');
                        $customPaths.addClass('input-error');
                    }
                } catch (e) {
                    $validationStatus.html('<span style="color: #d55;">Invalid JSON: ' + e.message + '</span>');
                    $customPaths.addClass('input-error');
                }
            }
```

- [ ] **Step 4: Add help documentation for entities**

In the help section (`<script type="text/html" data-help-name="ui-energy-overview">`), the "Custom Paths" block ends with its JSON `</pre>` immediately before `<h3>Example Flow</h3>`. Insert this new subsection between that `</pre>` and `<h3>Example Flow</h3>`:

```html
    <h3>Custom Entities</h3>
    <p>By default the widget shows five entities: solar, home, grid, battery and car. To define your own set (for example, add a Diesel Generator, or remove the car), include an <code>entities</code> block in the Custom Paths JSON. <strong>When <code>entities</code> is present it fully replaces the default set</strong>, so list every entity you want.</p>
    <p>Each entity has a <code>direction</code> relative to the central inverter:</p>
    <ul>
        <li><code>source</code> — flows into the inverter (e.g. solar, generator). Route name: <code>&lt;name&gt;ToInverter</code>.</li>
        <li><code>sink</code> — flows out of the inverter (e.g. home). Route name: <code>inverterTo&lt;Name&gt;</code>.</li>
        <li><code>both</code> — bidirectional (e.g. grid, battery, car). Route names: <code>inverterTo&lt;Name&gt;</code> and <code>&lt;name&gt;ToInverter</code>.</li>
    </ul>
    <p>Provide matching geometry for each entity in <code>energyPaths</code> (keyed by the route name) and <code>labels</code> (keyed by the entity name). Example adding a generator:</p>
    <pre>
{
  "entities": {
    "solar":     { "direction": "source" },
    "home":      { "direction": "sink" },
    "grid":      { "direction": "both" },
    "battery":   { "direction": "both" },
    "generator": { "direction": "source" }
  },
  "energyPaths": {
    "solarToInverter": "M ...",
    "inverterToHome": ["M ...", "M ..."],
    "inverterToGrid": "M ...",
    "inverterToBattery": "M ...",
    "generatorToInverter": "M ..."
  },
  "labels": {
    "solar":     { "position": "M ...", "align": "top",    "text": "SOLAR" },
    "generator": { "position": "M ...", "align": "bottom", "text": "GENERATOR" }
  }
}
    </pre>
    <p>Control the generator flow with <code>msg.payload.routes.generatorToInverter</code> and set its label with <code>msg.payload.labels.generator</code>.</p>
```

- [ ] **Step 5: Verify the editor file is well-formed**

There is no automated test for the editor HTML. Verify manually:

Run: `npm run build`
Expected: build succeeds (the HTML is not built by Vite, but this confirms nothing else broke).

Open the node in the dev Node-RED editor (Task 5 sets this up) and confirm: pasting a valid entities config shows the green "N entities, …" message; an invalid `direction` shows a red error; the help panel shows the new "Custom Entities" section.

- [ ] **Step 6: Commit**

```bash
git add nodes/ui-energy-overview.html
git commit -m "Add editor validation and help for custom entities"
```

---

### Task 5: End-to-end verification and Diesel Generator example

**Files:**
- Read: `examples/` (existing example flow, to match format)
- Create or Modify: an example demonstrating a custom entity (a Diesel Generator), following the existing examples format

**Interfaces:**
- Consumes: the full feature (Tasks 1–4).
- Produces: a runnable demonstration + a documented manual-verification result.

- [ ] **Step 1: Inspect the existing example format**

Run: `ls examples/ && sed -n '1,40p' examples/*.json 2>/dev/null`
Expected: see the existing example flow structure so the new example matches it (node types, `customPaths` field usage).

- [ ] **Step 2: Start the dev Node-RED instance**

This repo has a `.node-red-dev` directory and a `dev` build script. Build the UMD in watch mode and run the bundled dev Node-RED:

Run: `npm run build` (one-shot is sufficient for verification)
Then start the dev Node-RED per the project's existing dev workflow (the `.node-red-dev` runtime). If unsure of the exact command, ask the user how they normally launch the dev instance before proceeding.

- [ ] **Step 3: Manually verify backward compatibility (no custom entities)**

In the dev editor, add a default `ui-energy-overview` node (empty `customPaths`). Send the example payload:

```js
msg.payload = {
    routes: { solarToInverter: true, inverterToHome: true, inverterToGrid: true },
    labels: { solar: { value: "5.2 kW" }, home: { value: "2.1 kW" }, grid: { value: "0.8 kW", sublabel: "Exporting" } }
};
return msg;
```

Expected: solar→inverter, inverter→home, and inverter→grid animate exactly as before; grid label updates. Send `gridToInverter: true` and confirm the grid pulse reverses (import) and the export route auto-clears.

- [ ] **Step 4: Manually verify a custom Diesel Generator entity**

Paste this into the node's **Custom Paths** field. It declares the full set (replace semantics) — the five defaults reusing their default geometry, plus a `generator` (`source`) entity with a path and label placed in the free bottom-right area of the default house image:

```json
{
  "entities": {
    "solar":     { "direction": "source" },
    "home":      { "direction": "sink" },
    "grid":      { "direction": "both" },
    "battery":   { "direction": "both" },
    "car":       { "direction": "both" },
    "generator": { "direction": "source" }
  },
  "energyPaths": {
    "solarToInverter": "M 427 295 L 484 332 L 484 533",
    "inverterToHome": ["M 513 532 L 513 445 L 808 451 L 810 549", "M 513 532 L 513 445 L 966 455"],
    "inverterToGrid": "M 451 631 L 401 631 L 403 821 L 449 848",
    "inverterToBattery": "M 499 649 L 499 748 L 594 742",
    "inverterToCar": "M 451 604 L 389 608 L 253 599 L 253 654",
    "generatorToInverter": "M 513 649 L 760 700 L 880 800"
  },
  "labels": {
    "solar": { "position": "M 608 41 L 608 300", "align": "top", "text": "SOLAR" },
    "home": { "position": "M 776 41 L 776 445", "align": "top", "text": "HOME" },
    "grid": { "position": "M 448 850 L 448 921", "align": "bottom", "text": "GRID" },
    "battery": { "position": "M 643 772 L 643 921", "align": "bottom", "text": "BATTERY" },
    "car": { "position": "M 103 820 L 103 921", "align": "bottom", "text": "CAR" },
    "generator": { "position": "M 880 810 L 880 921", "align": "bottom", "text": "GENERATOR" }
  }
}
```

The editor status should read "Valid JSON: 6 entities, 6 energy paths, 6 labels". Deploy, then send:

```js
msg.payload = {
    routes: { generatorToInverter: true },
    labels: { generator: { value: "3.0 kW", sublabel: "Running" } }
};
return msg;
```

Expected: a pulse animates from the generator (bottom-right) toward the inverter, and the GENERATOR label shows "3.0 kW / Running". Toggling `generatorToInverter: false` stops it. Confirm the five default flows still animate too.

- [ ] **Step 5: Save the example and record the result**

Create `examples/energy-overview-generator-example.json` as a Node-RED flow (match the structure of the existing `examples/energy-overview-example.json`) containing a `ui-energy-overview` node whose `customPaths` is the JSON from Step 4, plus an inject/function node sending the `generatorToInverter` payload. Note the manual-verification outcome in the commit message.

- [ ] **Step 6: Final build and commit**

Run: `npm run build` then `node --test test/`
Expected: build green; all tests pass.

```bash
git add examples/
git commit -m "Add Diesel Generator example and verify configurable entities end to end"
```

---

## Phase 2 (out of scope — future session)

Making the Path Tracer (`energy-path-tracer.html`) emit the `entities` block is deferred. See the design doc's "Phase 2" section: `docs/superpowers/specs/2026-06-22-configurable-entities-design.md`.
