# Path Tracer — Configurable Entities (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Path Tracer (`energy-path-tracer.html`) manage configurable entities — add / rename / delete, each with a `source`/`sink`/`both` direction — defaulting to today's five built-ins, and emit/consume the `entities` block alongside `energyPaths` and `labels`.

**Architecture:** The tracer becomes driven by an in-memory entity model instead of two static `*Defs` objects. The route-key derivation and validation come from the existing `nodes/topology.js` (given a browser-export footer and loaded via `<script src>`). The pure transforms between the model and the `customPaths` JSON are extracted into a new, unit-tested `nodes/tracer-io.js` (same dual Node/browser export pattern as `topology.js` and `payload-merge.js`) so the HTML keeps only DOM and drawing concerns.

**Tech Stack:** Vanilla browser JS (the tracer is a standalone `file://` HTML page), CommonJS modules under `nodes/`, Node's built-in test runner (`node --test`), Vite for the widget UMD build.

## Global Constraints

- Runtime stays **Node >= 14** compatible; tests are dev-only and may use Node 18+ (`node --test`). (`package.json` `engines.node: ">=14"`.)
- **No new runtime dependencies** — `dependencies` stays `{}`.
- Shared logic lives in **CommonJS** modules under `nodes/` (shipped via the `files: ["nodes/*"]` glob) with a dual-export footer: `module.exports` for Node/Vite **and** a `window.*` global for the browser tracer. Tests live under top-level `test/` (never shipped).
- Test files use: `'use strict'`, `const { test } = require('node:test')`, `const assert = require('node:assert')`, `require('../nodes/<module>')`. Run with `npm test`.
- The tracer is opened **from the repo root** (it already references `house.png` relative), so `<script src="nodes/topology.js">` resolves.
- The emitted blob shape is exactly `{ entities, energyPaths, labels }` from the Phase 1 schema, so it round-trips tracer → node `customPaths` field → loader. `both` entities store geometry under the forward key only (`inverterTo<E>`).
- Default geometry, labels, and the five default entities (`solar` source, `home` sink, `grid`/`battery`/`car` both) must be **byte-for-byte preserved** when the tracer is opened and exported with no edits.
- `npm run build` must stay green.

---

## File Structure

- **Modify** `nodes/topology.js` — add dual-export footer; widen the exported api with `deriveTopology`, `DEFAULT_ENTITIES`, `validateEntities`, and the key helpers (`capitalize`, `toInverterKey`, `fromInverterKey`). No behavior change.
- **Create** `nodes/tracer-io.js` — pure `buildCustomPaths(descriptors, topo)` and `parseCustomPaths(blob, defaultEntities, topo)`; dual-export footer (`window.TracerIO`).
- **Create** `test/tracer-io.test.js` — unit tests for both transforms.
- **Modify** `test/topology.test.js` — assert the widened api surface.
- **Modify** `energy-path-tracer.html` — replace the two static `*Defs` objects and DOM-by-name addressing with the entity model, entity cards, model-driven render/draw, validation, and tracer-io-backed export/import; update instructions/help text.

A **descriptor** (the shared contract between the tracer and `tracer-io.js`) is:

```js
{ name, direction, segments: [string], labelPosition: string, label: string, align: string, directionGuessed?: boolean }
```

The tracer's in-memory **entity** is a descriptor plus view-only fields: `id` (stable handle), `dummyValue`, `dummySublabel`.

---

### Task 1: `topology.js` browser/tracer export footer

**Files:**
- Modify: `nodes/topology.js:141-147` (the `module.exports` block)
- Test: `test/topology.test.js` (append one test)

**Interfaces:**
- Consumes: nothing new.
- Produces: `require('../nodes/topology')` and `window.Topology` both expose `{ DEFAULT_ENTITIES, deriveTopology, matchPulseGroups, validateEntities, parseEntities, capitalize, toInverterKey, fromInverterKey }`.

- [ ] **Step 1: Write the failing test**

Append to `test/topology.test.js`:

```js
test('module exposes the full api surface used by the browser tracer', () => {
    const topology = require('../nodes/topology')
    assert.strictEqual(typeof topology.deriveTopology, 'function')
    assert.strictEqual(typeof topology.validateEntities, 'function')
    assert.strictEqual(typeof topology.capitalize, 'function')
    assert.strictEqual(typeof topology.toInverterKey, 'function')
    assert.strictEqual(typeof topology.fromInverterKey, 'function')
    assert.strictEqual(topology.toInverterKey('grid'), 'gridToInverter')
    assert.strictEqual(topology.fromInverterKey('grid'), 'inverterToGrid')
    assert.ok(topology.DEFAULT_ENTITIES && topology.DEFAULT_ENTITIES.solar)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `topology.capitalize` / `toInverterKey` / `fromInverterKey` are `undefined` (currently not exported).

- [ ] **Step 3: Replace the export block**

Replace `nodes/topology.js:141-147`:

```js
module.exports = {
	DEFAULT_ENTITIES: DEFAULT_ENTITIES,
	deriveTopology: deriveTopology,
	matchPulseGroups: matchPulseGroups,
	validateEntities: validateEntities,
	parseEntities: parseEntities
}
```

with:

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

if (typeof module !== 'undefined' && module.exports) {
	module.exports = api
}
if (typeof window !== 'undefined') {
	window.Topology = api
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all topology tests, including the new one).

- [ ] **Step 5: Verify the Vite build still bundles cleanly**

Run: `npm run build`
Expected: build succeeds with no errors (the `typeof window` guard must not break the UMD bundle).

- [ ] **Step 6: Commit**

```bash
git add nodes/topology.js test/topology.test.js
git commit -m "Expose topology api as a browser global for the Path Tracer"
```

---

### Task 2: `tracer-io.js` — `buildCustomPaths`

**Files:**
- Create: `nodes/tracer-io.js`
- Test: `test/tracer-io.test.js`

**Interfaces:**
- Consumes: `topo.deriveTopology(entities).pulseGroupKeys` (from Task 1).
- Produces: `buildCustomPaths(descriptors, topo) -> { entities, energyPaths, labels }`. Single-segment entities emit a string under the forward key; multi-segment emit an array; `both` entities emit under the forward key only; entities with no geometry are skipped; a label is emitted only when `labelPosition` is non-empty. Exposed as `module.exports.buildCustomPaths` and `window.TracerIO.buildCustomPaths`.

- [ ] **Step 1: Write the failing test**

Create `test/tracer-io.test.js`:

```js
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const topo = require('../nodes/topology')
const { buildCustomPaths } = require('../nodes/tracer-io')

test('source entity emits a single string under <name>ToInverter', () => {
    const out = buildCustomPaths([
        { name: 'solar', direction: 'source', segments: ['M 1 2 L 3 4'], labelPosition: '', label: '', align: 'top' }
    ], topo)
    assert.deepStrictEqual(out.entities, { solar: { direction: 'source' } })
    assert.deepStrictEqual(out.energyPaths, { solarToInverter: 'M 1 2 L 3 4' })
    assert.deepStrictEqual(out.labels, {})
})

test('multi-segment sink emits an array under inverterTo<Name>', () => {
    const out = buildCustomPaths([
        { name: 'home', direction: 'sink', segments: ['M 1 1', 'M 2 2'], labelPosition: 'M 9 9', label: 'HOME', align: 'top' }
    ], topo)
    assert.deepStrictEqual(out.energyPaths, { inverterToHome: ['M 1 1', 'M 2 2'] })
    assert.deepStrictEqual(out.labels, { home: { position: 'M 9 9', align: 'top', text: 'HOME' } })
})

test('both entity emits geometry under the forward key only', () => {
    const out = buildCustomPaths([
        { name: 'grid', direction: 'both', segments: ['M 5 5'], labelPosition: '', label: '', align: 'bottom' }
    ], topo)
    assert.deepStrictEqual(out.energyPaths, { inverterToGrid: 'M 5 5' })
    assert.deepStrictEqual(out.entities, { grid: { direction: 'both' } })
})

test('empty/whitespace segments are skipped, no energyPaths key', () => {
    const out = buildCustomPaths([
        { name: 'solar', direction: 'source', segments: ['', '   '], labelPosition: '', label: '', align: 'top' }
    ], topo)
    assert.deepStrictEqual(out.energyPaths, {})
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../nodes/tracer-io'`.

- [ ] **Step 3: Create `nodes/tracer-io.js` with `buildCustomPaths`**

```js
'use strict'

// Pure transforms between the Path Tracer's entity descriptors and the
// customPaths JSON blob ({ entities, energyPaths, labels }). No DOM. The
// topology api is injected (topo) so this shares one source of truth with
// nodes/topology.js. Plain CommonJS + browser global, Node >=14 compatible.
//
// descriptor: { name, direction, segments: [string], labelPosition, label, align }

function trimmedSegments (segments) {
	return (segments || []).map(function (s) { return (s || '').trim() }).filter(Boolean)
}

// descriptors -> { entities, energyPaths, labels }
function buildCustomPaths (descriptors, topo) {
	var entities = {}
	descriptors.forEach(function (d) {
		entities[d.name] = { direction: d.direction }
	})
	var pulseGroupKeys = topo.deriveTopology(entities).pulseGroupKeys
	var energyPaths = {}
	var labels = {}
	descriptors.forEach(function (d) {
		var key = pulseGroupKeys[d.name]
		var segs = trimmedSegments(d.segments)
		if (key && segs.length === 1) {
			energyPaths[key] = segs[0]
		} else if (key && segs.length > 1) {
			energyPaths[key] = segs
		}
		var pos = (d.labelPosition || '').trim()
		if (pos) {
			labels[d.name] = {
				position: pos,
				align: d.align || 'top',
				text: (d.label || '').trim()
			}
		}
	})
	return { entities: entities, energyPaths: energyPaths, labels: labels }
}

var api = {
	buildCustomPaths: buildCustomPaths
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = api
}
if (typeof window !== 'undefined') {
	window.TracerIO = api
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all four `tracer-io` build tests).

- [ ] **Step 5: Commit**

```bash
git add nodes/tracer-io.js test/tracer-io.test.js
git commit -m "Add tracer-io buildCustomPaths transform with tests"
```

---

### Task 3: `tracer-io.js` — `parseCustomPaths` (import + legacy reconstruction)

**Files:**
- Modify: `nodes/tracer-io.js` (add helpers + `parseCustomPaths`, widen `api`)
- Test: `test/tracer-io.test.js` (append)

**Interfaces:**
- Consumes: `topo.deriveTopology`, `topo.toInverterKey`, `topo.fromInverterKey` (Task 1); `defaultEntities` (e.g. `topo.DEFAULT_ENTITIES`).
- Produces: `parseCustomPaths(blob, defaultEntities, topo) -> { descriptors, notices }`. When `blob.entities` is present, directions come from it. Otherwise (legacy) directions come from `defaultEntities` by name, or are guessed from key shape (`<x>ToInverter`→source, `inverterTo<X>`→sink [flagged ambiguous, `directionGuessed: true`, + a notice], both→both). Geometry arrays become multiple `segments`. Exposed on `module.exports` and `window.TracerIO`.

- [ ] **Step 1: Write the failing test**

Append to `test/tracer-io.test.js`:

```js
const { parseCustomPaths } = require('../nodes/tracer-io')

test('parse new blob with entities block keeps directions and segments', () => {
    const blob = {
        entities: { generator: { direction: 'source' } },
        energyPaths: { generatorToInverter: 'M 1 1 L 2 2' },
        labels: { generator: { position: 'M 9 9', align: 'bottom', text: 'GEN' } }
    }
    const { descriptors, notices } = parseCustomPaths(blob, topo.DEFAULT_ENTITIES, topo)
    assert.strictEqual(notices.length, 0)
    assert.deepStrictEqual(descriptors, [
        { name: 'generator', direction: 'source', segments: ['M 1 1 L 2 2'], labelPosition: 'M 9 9', label: 'GEN', align: 'bottom', directionGuessed: false }
    ])
})

test('parse legacy blob (no entities) resolves default names from defaultEntities', () => {
    const blob = {
        energyPaths: { inverterToGrid: 'M 5 5' },
        labels: { grid: { position: 'M 8 8', align: 'bottom', text: 'GRID' } }
    }
    const { descriptors, notices } = parseCustomPaths(blob, topo.DEFAULT_ENTITIES, topo)
    assert.strictEqual(notices.length, 0)
    const grid = descriptors.find(function (d) { return d.name === 'grid' })
    assert.strictEqual(grid.direction, 'both')
    assert.deepStrictEqual(grid.segments, ['M 5 5'])
    assert.strictEqual(grid.directionGuessed, false)
})

test('parse legacy unknown name with inverterTo-only key guesses sink and flags it', () => {
    const blob = { energyPaths: { inverterToPool: 'M 7 7' }, labels: { pool: { position: 'M 1 1', align: 'top', text: 'POOL' } } }
    const { descriptors, notices } = parseCustomPaths(blob, topo.DEFAULT_ENTITIES, topo)
    const pool = descriptors.find(function (d) { return d.name === 'pool' })
    assert.strictEqual(pool.direction, 'sink')
    assert.strictEqual(pool.directionGuessed, true)
    assert.strictEqual(notices.length, 1)
})

test('parse legacy unknown name with <x>ToInverter-only key guesses source, no flag', () => {
    const blob = { energyPaths: { windToInverter: 'M 7 7' }, labels: {} }
    const { descriptors, notices } = parseCustomPaths(blob, topo.DEFAULT_ENTITIES, topo)
    const wind = descriptors.find(function (d) { return d.name === 'wind' })
    assert.strictEqual(wind.direction, 'source')
    assert.strictEqual(wind.directionGuessed, false)
    assert.strictEqual(notices.length, 0)
})

test('buildCustomPaths then parseCustomPaths round-trips a descriptor set', () => {
    const input = [
        { name: 'solar', direction: 'source', segments: ['M 1 1'], labelPosition: 'M 2 2', label: 'SOLAR', align: 'top' },
        { name: 'home', direction: 'sink', segments: ['M 3 3', 'M 4 4'], labelPosition: 'M 5 5', label: 'HOME', align: 'top' },
        { name: 'grid', direction: 'both', segments: ['M 6 6'], labelPosition: 'M 7 7', label: 'GRID', align: 'bottom' }
    ]
    const blob = buildCustomPaths(input, topo)
    const { descriptors } = parseCustomPaths(blob, topo.DEFAULT_ENTITIES, topo)
    const stripped = descriptors.map(function (d) {
        return { name: d.name, direction: d.direction, segments: d.segments, labelPosition: d.labelPosition, label: d.label, align: d.align }
    })
    assert.deepStrictEqual(stripped, input)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `parseCustomPaths` is `undefined`.

- [ ] **Step 3: Add helpers + `parseCustomPaths`, widen `api`**

In `nodes/tracer-io.js`, insert these functions after `buildCustomPaths` (before the `var api` block):

```js
// Does energyPaths contain `key` exactly, or `key` followed by digits?
function hasGeomKey (energyPaths, key) {
	return Object.keys(energyPaths).some(function (k) {
		if (k === key) return true
		if (k.indexOf(key) === 0) return /^\d+$/.test(k.slice(key.length))
		return false
	})
}

// Recover an entity name from a route key, ignoring numeric suffixes.
function entityNameFromKey (key) {
	var m = /^(.+)ToInverter$/.exec(key)
	if (m) return m[1]
	m = /^inverterTo([A-Z][A-Za-z0-9_]*?)\d*$/.exec(key)
	if (m) return m[1].charAt(0).toLowerCase() + m[1].slice(1)
	return null
}

// Legacy blobs (no entities block): guess a direction from which keys exist.
function guessDirection (name, energyPaths, topo) {
	var hasTo = hasGeomKey(energyPaths, topo.toInverterKey(name))
	var hasFrom = hasGeomKey(energyPaths, topo.fromInverterKey(name))
	if (hasTo && hasFrom) return { direction: 'both', ambiguous: false }
	if (hasTo) return { direction: 'source', ambiguous: false }
	// inverterTo<Name>-only is indistinguishable between sink and both
	return { direction: 'sink', ambiguous: true }
}

// blob -> { descriptors, notices }
function parseCustomPaths (blob, defaultEntities, topo) {
	blob = blob || {}
	var energyPaths = blob.energyPaths || {}
	var labels = blob.labels || {}
	var notices = []
	var directions = {}
	var guessed = {}

	if (blob.entities && typeof blob.entities === 'object') {
		Object.keys(blob.entities).forEach(function (name) {
			directions[name] = blob.entities[name] && blob.entities[name].direction
		})
	} else {
		var names = {}
		Object.keys(labels).forEach(function (n) { names[n] = true })
		Object.keys(energyPaths).forEach(function (key) {
			var n = entityNameFromKey(key)
			if (n) names[n] = true
		})
		Object.keys(names).forEach(function (name) {
			if (defaultEntities[name]) {
				directions[name] = defaultEntities[name].direction
			} else {
				var g = guessDirection(name, energyPaths, topo)
				directions[name] = g.direction
				if (g.ambiguous) {
					guessed[name] = true
					notices.push('Guessed direction "' + g.direction + '" for "' + name + '" — please verify.')
				}
			}
		})
	}

	var entities = {}
	Object.keys(directions).forEach(function (n) { entities[n] = { direction: directions[n] } })
	var pulseGroupKeys = topo.deriveTopology(entities).pulseGroupKeys

	var descriptors = Object.keys(directions).map(function (name) {
		var key = pulseGroupKeys[name]
		var geom = key ? energyPaths[key] : undefined
		var segments = Array.isArray(geom) ? geom.slice() : (typeof geom === 'string' ? [geom] : [])
		var lbl = labels[name] || {}
		return {
			name: name,
			direction: directions[name],
			segments: segments,
			labelPosition: typeof lbl.position === 'string' ? lbl.position : '',
			label: typeof lbl.text === 'string' ? lbl.text : '',
			align: lbl.align || 'top',
			directionGuessed: !!guessed[name]
		}
	})

	return { descriptors: descriptors, notices: notices }
}
```

Then widen the `api` object:

```js
var api = {
	buildCustomPaths: buildCustomPaths,
	parseCustomPaths: parseCustomPaths
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all `tracer-io` tests including the round-trip).

- [ ] **Step 5: Commit**

```bash
git add nodes/tracer-io.js test/tracer-io.test.js
git commit -m "Add tracer-io parseCustomPaths with legacy reconstruction and tests"
```

---

### Task 4: Make the tracer model-driven (entity cards, render, draw)

This rewrites the tracer's UI core. The tracer has no automated test harness, so each step is a precise edit and the task ends with a manual browser verification. Open `energy-path-tracer.html` from the repo root via `file://` (or any static server rooted at the repo) so `nodes/topology.js` and `nodes/tracer-io.js` resolve.

**Files:**
- Modify: `energy-path-tracer.html` (`<head>` scripts; sidebar section markup; the entire `<script>` init/render/draw machinery)

**Interfaces:**
- Consumes: `window.Topology` (Task 1), `window.TracerIO` (Tasks 2–3).
- Produces (tracer-internal, used by Tasks 5–6): the `entities` array of entity objects; `buildDescriptors()`; `setModel(entityList)`; `descriptorToEntity(d)`; `renderCards()`; `currentDrawTarget`; DOM ids `name-<id>`, `dir-<id>`, `seg-<id>-<i>`, `lblpos-<id>`, `lbltext-<id>`, `align-<id>`, `keys-<id>`, `note-<id>`, `err-<id>`, `card-<id>`; container `#entityCards`; `#addEntityBtn`; `#validationSummary`.

- [ ] **Step 1: Load the shared modules**

In `energy-path-tracer.html`, immediately before the existing `<script>` (line 467, `<script>` opening the inline code), add:

```html
    <script src="nodes/topology.js"></script>
    <script src="nodes/tracer-io.js"></script>
```

- [ ] **Step 2: Replace the sidebar section markup**

Replace `energy-path-tracer.html:406-410`:

```html
        <h3>Route Paths (Pulse Animations)</h3>
        <div id="routePaths"></div>

        <h3>Label Paths (Text Labels)</h3>
        <div id="labelPaths"></div>
```

with:

```html
        <h3>Entities
            <button id="addEntityBtn" style="float:right; background:#4dcbbf; color:#000; border:none; border-radius:4px; padding:3px 10px; font-size:12px; cursor:pointer;">+ Add</button>
        </h3>
        <div id="validationSummary" style="font-size:11px; color:#888; margin-bottom:8px;"></div>
        <div id="entityCards"></div>
```

- [ ] **Step 3: Replace the two static def objects with default geometry + model state**

Replace `energy-path-tracer.html:485-527` (the `routePathDefs` object, `labelPathDefs` object, and the `// State` block down to `let mousePos = null;`) with:

```js
        // Default geometry/labels per entity (tool-specific reference geometry).
        // Entity identity + direction come from Topology.DEFAULT_ENTITIES.
        const DEFAULT_GEOMETRY = {
            solar:   { segments: ['M 427 295 L 484 332 L 484 533'], labelPosition: 'M 608 41 L 608 300', label: 'SOLAR', align: 'top', dummyValue: '2.4 kW', dummySublabel: '12.5 kWh' },
            home:    { segments: ['M 513 532 L 513 445 L 808 451 L 810 549', 'M 513 532 L 513 445 L 966 455'], labelPosition: 'M 776 41 L 776 445', label: 'HOME', align: 'top', dummyValue: '1.8 kW', dummySublabel: '' },
            grid:    { segments: ['M 451 631 L 401 631 L 403 821 L 449 848'], labelPosition: 'M 448 850 L 448 921', label: 'GRID', align: 'bottom', dummyValue: '0.3 kW', dummySublabel: 'Importing' },
            battery: { segments: ['M 499 649 L 499 748 L 594 742'], labelPosition: 'M 643 772 L 643 921', label: 'BATTERY', align: 'bottom', dummyValue: '85%', dummySublabel: 'Charging' },
            car:     { segments: ['M 453 586 L 388 585 L 257 587 L 255 658'], labelPosition: 'M 103 820 L 103 921', label: 'CAR', align: 'bottom', dummyValue: '11 kW', dummySublabel: '2h 15m left' }
        };

        // Entity model — single source of truth for the sidebar.
        // entity: { id, name, direction, segments:[str], labelPosition, label, align, dummyValue, dummySublabel, directionGuessed }
        let entities = [];
        let idCounter = 0;
        function nextId() { return 'e' + (++idCounter); }

        function descriptorToEntity(d) {
            const g = DEFAULT_GEOMETRY[d.name] || {};
            return {
                id: nextId(),
                name: d.name,
                direction: d.direction,
                segments: (d.segments && d.segments.length) ? d.segments.slice() : [''],
                labelPosition: d.labelPosition || '',
                label: d.label || '',
                align: d.align || 'top',
                dummyValue: g.dummyValue || '',
                dummySublabel: g.dummySublabel || '',
                directionGuessed: !!d.directionGuessed
            };
        }

        function defaultEntityList() {
            return Object.keys(Topology.DEFAULT_ENTITIES).map(function (name) {
                const g = DEFAULT_GEOMETRY[name] || { segments: [''], labelPosition: '', label: name.toUpperCase(), align: 'top' };
                return descriptorToEntity({
                    name: name,
                    direction: Topology.DEFAULT_ENTITIES[name].direction,
                    segments: g.segments.slice(),
                    labelPosition: g.labelPosition || '',
                    label: g.label || name.toUpperCase(),
                    align: g.align || 'top'
                });
            });
        }

        function buildDescriptors() {
            return entities.map(function (e) {
                return { name: e.name, direction: e.direction, segments: e.segments, labelPosition: e.labelPosition, label: e.label, align: e.align };
            });
        }

        function findEntity(id) { return entities.find(function (e) { return e.id === id; }); }

        // Drawing state
        let currentDrawTarget = null; // { entityId, kind: 'segment'|'label', segIndex }
        let drawMode = 'M';
        let currentPoints = [];
        let imageLoaded = false;
        let mousePos = null;
```

- [ ] **Step 4: Update the container DOM references**

Replace `energy-path-tracer.html:542-543`:

```js
        const routePathsContainer = document.getElementById('routePaths');
        const labelPathsContainer = document.getElementById('labelPaths');
```

with:

```js
        const entityCardsContainer = document.getElementById('entityCards');
        const addEntityBtn = document.getElementById('addEntityBtn');
        const validationSummary = document.getElementById('validationSummary');
```

- [ ] **Step 5: Replace `createPathEntry` and `initUI` with card rendering + init**

Replace `energy-path-tracer.html:545-634` (the `createPathEntry` function and the `initUI` function) with:

```js
        function escapeAttr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }

        function updateKeysCaption(ent) {
            const caption = document.getElementById('keys-' + ent.id);
            if (!caption) return;
            if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(ent.name)) { caption.textContent = '→ (enter a valid name)'; return; }
            const single = {}; single[ent.name] = { direction: ent.direction };
            const routes = Topology.deriveTopology(single).routes;
            caption.textContent = '→ ' + Object.keys(routes).join(' + ');
        }

        function createCard(ent) {
            const card = document.createElement('div');
            card.className = 'path-entry';
            card.id = 'card-' + ent.id;

            const segmentsHtml = ent.segments.map(function (seg, i) {
                return '<div class="seg-row" style="display:flex; gap:6px; margin-top:4px;">' +
                    '<input type="text" id="seg-' + ent.id + '-' + i + '" value="' + escapeAttr(seg) + '" placeholder="M x y L x y..." style="flex:1;">' +
                    '<button class="draw-btn" data-entity="' + ent.id + '" data-kind="segment" data-seg="' + i + '">Draw</button>' +
                    '<button class="seg-remove secondary" data-entity="' + ent.id + '" data-seg="' + i + '" title="Remove segment">×</button>' +
                    '</div>';
            }).join('');

            card.innerHTML =
                '<div style="display:flex; gap:6px; align-items:center;">' +
                    '<input type="text" id="name-' + ent.id + '" value="' + escapeAttr(ent.name) + '" placeholder="entity name" style="flex:1; font-weight:bold;">' +
                    '<select id="dir-' + ent.id + '">' +
                        '<option value="source"' + (ent.direction === 'source' ? ' selected' : '') + '>source</option>' +
                        '<option value="sink"' + (ent.direction === 'sink' ? ' selected' : '') + '>sink</option>' +
                        '<option value="both"' + (ent.direction === 'both' ? ' selected' : '') + '>both</option>' +
                    '</select>' +
                    '<button class="entity-delete secondary" data-entity="' + ent.id + '" title="Delete entity">×</button>' +
                '</div>' +
                '<div id="keys-' + ent.id + '" style="font-size:10px; color:#4dcbbf; margin-top:4px;"></div>' +
                '<div id="note-' + ent.id + '" style="font-size:11px; color:#ffd700; margin-top:4px;">' + (ent.directionGuessed ? 'Direction guessed — please verify.' : '') + '</div>' +
                '<div style="font-size:11px; color:#888; margin-top:8px;">Geometry</div>' +
                segmentsHtml +
                '<button class="seg-add" data-entity="' + ent.id + '" style="margin-top:4px; background:#555; font-size:11px;">+ segment</button>' +
                '<div style="font-size:11px; color:#888; margin-top:8px;">Label</div>' +
                '<div style="display:flex; gap:6px; margin-top:4px;">' +
                    '<input type="text" id="lblpos-' + ent.id + '" value="' + escapeAttr(ent.labelPosition) + '" placeholder="label position path" style="flex:1;">' +
                    '<button class="draw-btn" data-entity="' + ent.id + '" data-kind="label">Draw</button>' +
                '</div>' +
                '<div style="display:flex; gap:6px; margin-top:4px;">' +
                    '<input type="text" id="lbltext-' + ent.id + '" value="' + escapeAttr(ent.label) + '" placeholder="LABEL TEXT" style="flex:1;">' +
                    '<select id="align-' + ent.id + '">' +
                        '<option value="top"' + (ent.align === 'top' ? ' selected' : '') + '>top</option>' +
                        '<option value="bottom"' + (ent.align === 'bottom' ? ' selected' : '') + '>bottom</option>' +
                    '</select>' +
                '</div>' +
                '<div id="err-' + ent.id + '" style="color:#ef4444; font-size:11px; margin-top:6px;"></div>';

            wireCard(card, ent);
            return card;
        }

        function wireCard(card, ent) {
            card.querySelector('#name-' + ent.id).addEventListener('input', function (e) {
                ent.name = e.target.value.trim();
                updateKeysCaption(ent);
                syncValidation();
                renderAllPaths();
            });
            card.querySelector('#dir-' + ent.id).addEventListener('change', function (e) {
                ent.direction = e.target.value;
                ent.directionGuessed = false;
                const note = document.getElementById('note-' + ent.id);
                if (note) note.textContent = '';
                updateKeysCaption(ent);
                syncValidation();
                renderAllPaths();
            });
            ent.segments.forEach(function (_, i) {
                card.querySelector('#seg-' + ent.id + '-' + i).addEventListener('input', function (e) {
                    ent.segments[i] = e.target.value;
                    renderAllPaths();
                });
            });
            card.querySelector('#lblpos-' + ent.id).addEventListener('input', function (e) {
                ent.labelPosition = e.target.value;
                renderAllPaths();
            });
            card.querySelector('#lbltext-' + ent.id).addEventListener('input', function (e) {
                ent.label = e.target.value;
                renderAllPaths();
            });
            card.querySelector('#align-' + ent.id).addEventListener('change', function (e) {
                ent.align = e.target.value;
                renderAllPaths();
            });
            card.querySelectorAll('.draw-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    const seg = btn.dataset.seg != null ? parseInt(btn.dataset.seg, 10) : null;
                    startDrawing(btn.dataset.entity, btn.dataset.kind, seg);
                });
            });
            // .seg-add / .seg-remove / .entity-delete are wired in Task 5
            updateKeysCaption(ent);
        }

        function renderCards() {
            entityCardsContainer.innerHTML = '';
            entities.forEach(function (ent) { entityCardsContainer.appendChild(createCard(ent)); });
            syncValidation();
        }

        function setModel(entityList) {
            // Stop any in-progress drawing whose target may no longer exist.
            currentDrawTarget = null;
            entities = entityList;
            renderCards();
            renderAllPaths();
        }

        // Placeholder until Task 6 wires real validation. Keeps render calls safe.
        function syncValidation() {}

        function init() {
            setModel(defaultEntityList());
            addEntityBtn.addEventListener('click', onAddEntity);
        }

        // onAddEntity is defined in Task 5.
        function onAddEntity() {}
```

- [ ] **Step 6: Replace `renderAllPaths` to iterate the model**

Replace `energy-path-tracer.html:691-721` (the `renderAllPaths` function) with:

```js
        function renderAllPaths() {
            if (!imageLoaded) return;

            const defs = overlay.querySelector('defs');
            overlay.innerHTML = '';
            overlay.appendChild(defs);

            entities.forEach(function (ent) {
                ent.segments.forEach(function (seg, i) {
                    if (seg && seg.trim()) {
                        const active = !!currentDrawTarget && currentDrawTarget.entityId === ent.id &&
                            currentDrawTarget.kind === 'segment' && currentDrawTarget.segIndex === i;
                        renderRoutePath(seg.trim(), active);
                    }
                });
                if (ent.labelPosition && ent.labelPosition.trim()) {
                    const active = !!currentDrawTarget && currentDrawTarget.entityId === ent.id && currentDrawTarget.kind === 'label';
                    renderLabelPath(ent.labelPosition.trim(), ent.align, ent, active);
                }
            });

            if (currentDrawTarget) renderDrawingPoints();
        }
```

- [ ] **Step 7: Update `renderRoutePath` signature**

In `energy-path-tracer.html`, change the `renderRoutePath` header and active logic. Replace:

```js
        function renderRoutePath(name, pathData) {
            const svgNS = "http://www.w3.org/2000/svg";
            const isActive = currentDrawingPath === name;
```

with:

```js
        function renderRoutePath(pathData, isActive) {
            const svgNS = "http://www.w3.org/2000/svg";
```

Then remove the now-stale line `path.setAttribute("data-name", name);` from that function.

- [ ] **Step 8: Update `renderLabelPath` signature and label-text source**

Change the `renderLabelPath` header. Replace:

```js
        function renderLabelPath(name, pathData, align, def) {
```

with:

```js
        function renderLabelPath(pathData, align, ent, isActive) {
```

In that function: change `currentDrawingPath === name` to `isActive`; remove `path.setAttribute("data-name", name);`; change `def.dummyValue` to `ent.dummyValue` and `def.dummySublabel` to `ent.dummySublabel`. Replace these two lines:

```js
            const labelInput = document.getElementById(`label-${name}`);
            const labelText = labelInput ? labelInput.value : (def.label || name.toUpperCase());
```

with:

```js
            const labelText = ent.label || ent.name.toUpperCase();
```

- [ ] **Step 9: Rewrite `startDrawing` / `stopDrawing`, remove `clearPath`**

Replace `energy-path-tracer.html:898-956` (the `startDrawing`, `stopDrawing`, and `clearPath` functions) with:

```js
        function startDrawing(entityId, kind, segIndex) {
            document.querySelectorAll('.path-entry').forEach(function (e) { e.classList.remove('active'); });
            document.querySelectorAll('.draw-btn').forEach(function (b) { b.classList.remove('active'); });

            const same = currentDrawTarget && currentDrawTarget.entityId === entityId &&
                currentDrawTarget.kind === kind && currentDrawTarget.segIndex === segIndex;
            if (same) { stopDrawing(); return; }

            currentDrawTarget = { entityId: entityId, kind: kind, segIndex: (segIndex == null ? null : segIndex) };
            currentPoints = [];
            mousePos = null;
            drawMode = 'M';
            moveBtn.classList.add('active');
            lineBtn.classList.remove('active');

            const card = document.getElementById('card-' + entityId);
            if (card) card.classList.add('active');
            const ent = findEntity(entityId);
            const what = kind === 'segment' ? ('segment ' + (segIndex + 1)) : 'label';
            modeIndicator.textContent = 'Drawing: ' + (ent ? ent.name : '?') + ' ' + what;
            overlay.classList.add('interactive');
            endBtn.style.display = 'inline-block';
            renderAllPaths();
        }

        function stopDrawing() {
            document.querySelectorAll('.path-entry').forEach(function (e) { e.classList.remove('active'); });
            document.querySelectorAll('.draw-btn').forEach(function (b) { b.classList.remove('active'); });
            currentDrawTarget = null;
            currentPoints = [];
            mousePos = null;
            modeIndicator.textContent = "Click a path's \"Draw\" button to start";
            overlay.classList.remove('interactive');
            endBtn.style.display = 'none';
            renderAllPaths();
        }

        // Read/write the model field the current draw target points at.
        function getTargetField() {
            const ent = findEntity(currentDrawTarget.entityId);
            if (!ent) return null;
            if (currentDrawTarget.kind === 'label') {
                return { get: function () { return ent.labelPosition; }, set: function (v) { ent.labelPosition = v; } };
            }
            const i = currentDrawTarget.segIndex;
            return { get: function () { return ent.segments[i]; }, set: function (v) { ent.segments[i] = v; } };
        }

        function syncTargetInput() {
            const ent = findEntity(currentDrawTarget.entityId);
            if (!ent) return;
            const input = currentDrawTarget.kind === 'label'
                ? document.getElementById('lblpos-' + ent.id)
                : document.getElementById('seg-' + ent.id + '-' + currentDrawTarget.segIndex);
            const field = getTargetField();
            if (input && field) input.value = field.get();
        }
```

- [ ] **Step 10: Rewrite the canvas click handler to write through the model**

Replace `energy-path-tracer.html:976-1013` (the `canvasContainer` click listener) with:

```js
        canvasContainer.addEventListener('click', (e) => {
            if (!currentDrawTarget || !imageLoaded) return;

            const rect = baseImage.getBoundingClientRect();
            const scaleX = baseImage.naturalWidth / rect.width;
            const scaleY = baseImage.naturalHeight / rect.height;

            const rawX = (e.clientX - rect.left) * scaleX / scaleFactor;
            const rawY = (e.clientY - rect.top) * scaleY / scaleFactor;
            let x = Math.round(rawX);
            let y = Math.round(rawY);

            if (e.shiftKey && drawMode === 'L' && currentPoints.length > 0) {
                const lastPoint = currentPoints[currentPoints.length - 1];
                const snapped = snapToCardinal(lastPoint, x, y);
                x = snapped.x;
                y = snapped.y;
            }

            currentPoints.push({ x, y });

            const field = getTargetField();
            if (currentPoints.length === 1) {
                field.set(`M ${x} ${y}`);
                drawMode = 'L';
                lineBtn.classList.add('active');
                moveBtn.classList.remove('active');
            } else {
                field.set(field.get() + ` ${drawMode} ${x} ${y}`);
            }
            syncTargetInput();
            renderAllPaths();
        });
```

- [ ] **Step 11: Update the mousemove guard reference**

In `energy-path-tracer.html` near line 1027, replace:

```js
            if (currentDrawingPath && drawMode === 'L' && currentPoints.length > 0) {
```

with:

```js
            if (currentDrawTarget && drawMode === 'L' && currentPoints.length > 0) {
```

- [ ] **Step 12: Update the bootstrap call**

Replace the final `initUI();` (near line 1233) with:

```js
        init();
```

- [ ] **Step 13: Manual verification in the browser**

Open `energy-path-tracer.html` from the repo root over `file://`. Verify:
- The sidebar shows **one card each** for solar, home, grid, battery, car, with the correct direction preselected (solar=source, home=sink, grid/battery/car=both) and an **+ Add** button in the Entities header.
- Each card shows its derived key caption (e.g. solar → `solarToInverter`; grid → `inverterToGrid + gridToInverter`).
- The `home` card shows **two** segment rows.
- The overlay renders the five default routes and labels **identically to before this task** (compare against `git stash`-ed original if needed): same paths, same green-start/red-end markers, same label text/values.
- Click **Draw** on solar's segment, click two points on the image → the path updates live, the segment input fills with `M … L …`, and the green/red markers appear. Press **Esc** to stop.
- Edit a label text field → the on-image label updates live. Change an align dropdown → the label repositions.
- No console errors; `window.Topology` and `window.TracerIO` are defined (the `<script src>` tags resolved).

- [ ] **Step 14: Commit**

```bash
git add energy-path-tracer.html
git commit -m "Drive Path Tracer from an entity model with per-entity cards"
```

---

### Task 5: Add / delete entities and add / remove segments

**Files:**
- Modify: `energy-path-tracer.html` (`onAddEntity`, and the segment/delete wiring inside `wireCard`)

**Interfaces:**
- Consumes: `entities`, `descriptorToEntity`, `renderCards`, `renderAllPaths`, `findEntity`, `stopDrawing`, `currentDrawTarget` (Task 4).
- Produces: working **+ Add** (appends a uniquely-named source entity), per-card **× delete**, per-segment **× remove**, and **+ segment**.

- [ ] **Step 1: Implement `onAddEntity` with a unique default name**

Replace the Task 4 placeholder:

```js
        // onAddEntity is defined in Task 5.
        function onAddEntity() {}
```

with:

```js
        function uniqueName(base) {
            const taken = entities.map(function (e) { return e.name; });
            if (taken.indexOf(base) === -1) return base;
            let i = 2;
            while (taken.indexOf(base + i) !== -1) i++;
            return base + i;
        }

        function onAddEntity() {
            entities.push(descriptorToEntity({
                name: uniqueName('entity'), direction: 'source',
                segments: [''], labelPosition: '', label: '', align: 'top'
            }));
            renderCards();
            renderAllPaths();
        }
```

- [ ] **Step 2: Wire segment-add, segment-remove, and entity-delete in `wireCard`**

In `wireCard`, replace the comment line:

```js
            // .seg-add / .seg-remove / .entity-delete are wired in Task 5
```

with:

```js
            card.querySelector('.seg-add').addEventListener('click', function () {
                ent.segments.push('');
                renderCards();
                renderAllPaths();
            });
            card.querySelectorAll('.seg-remove').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    const i = parseInt(btn.dataset.seg, 10);
                    if (currentDrawTarget && currentDrawTarget.entityId === ent.id && currentDrawTarget.kind === 'segment') {
                        stopDrawing();
                    }
                    ent.segments.splice(i, 1);
                    if (ent.segments.length === 0) ent.segments.push('');
                    renderCards();
                    renderAllPaths();
                });
            });
            card.querySelector('.entity-delete').addEventListener('click', function () {
                if (currentDrawTarget && currentDrawTarget.entityId === ent.id) stopDrawing();
                entities = entities.filter(function (e) { return e.id !== ent.id; });
                renderCards();
                renderAllPaths();
            });
```

- [ ] **Step 3: Manual verification**

Open the tracer. Verify:
- **+ Add** appends a card named `entity` (then `entity2`, …) with direction `source`, one empty segment, key caption `entityToInverter`.
- Editing the new card's name to `generator` updates the caption to `generatorToInverter`.
- **+ segment** on any card adds a segment row; drawing into it works; the route renders.
- **× remove** on a segment removes that row (and never leaves zero rows — the last removal leaves one empty row).
- **× delete** on a card removes the entity and its rendered paths/labels; deleting the card you're actively drawing into stops drawing cleanly (no console error).

- [ ] **Step 4: Commit**

```bash
git add energy-path-tracer.html
git commit -m "Add entity add/delete and per-entity segment add/remove to the tracer"
```

---

### Task 6: Live validation, then export & import via tracer-io

**Files:**
- Modify: `energy-path-tracer.html` (`syncValidation`; the export button handler; the import/modal-load handler)

**Interfaces:**
- Consumes: `Topology.validateEntities`, `TracerIO.buildCustomPaths`, `TracerIO.parseCustomPaths`, `Topology.DEFAULT_ENTITIES`, `buildDescriptors`, `setModel`, `descriptorToEntity` (Tasks 1–5).
- Produces: a real `syncValidation()` (inline per-card errors, header summary, Export disabled on hard errors); export emitting `{ entities, energyPaths, labels }`; import accepting that shape and legacy blobs.

- [ ] **Step 1: Implement real `syncValidation`**

Replace the Task 4 placeholder:

```js
        // Placeholder until Task 6 wires real validation. Keeps render calls safe.
        function syncValidation() {}
```

with:

```js
        function buildEntitiesObj() {
            const obj = {};
            entities.forEach(function (e) { obj[e.name] = { direction: e.direction }; });
            return obj;
        }

        function syncValidation() {
            // Clear per-card errors.
            entities.forEach(function (e) {
                const err = document.getElementById('err-' + e.id);
                if (err) err.textContent = '';
            });

            const result = Topology.validateEntities(buildEntitiesObj());
            // Attach each error to the first card whose name it mentions, else summary-only.
            const unattached = [];
            result.errors.forEach(function (msg) {
                const hit = entities.find(function (e) { return e.name && msg.indexOf('"' + e.name + '"') !== -1; });
                const target = hit ? document.getElementById('err-' + hit.id) : null;
                if (target) { target.textContent += (target.textContent ? ' ' : '') + msg; }
                else { unattached.push(msg); }
            });

            const pathCount = entities.reduce(function (n, e) {
                return n + e.segments.filter(function (s) { return s && s.trim(); }).length;
            }, 0);
            const labelCount = entities.filter(function (e) { return e.labelPosition && e.labelPosition.trim(); }).length;

            if (result.valid) {
                validationSummary.style.color = '#888';
                validationSummary.textContent = entities.length + ' entities, ' + pathCount + ' paths, ' + labelCount + ' labels';
            } else {
                validationSummary.style.color = '#ef4444';
                validationSummary.textContent = result.errors.length + ' error(s) — fix before exporting' +
                    (unattached.length ? ': ' + unattached.join('; ') : '');
            }
            exportBtn.disabled = !result.valid;
            exportBtn.style.opacity = result.valid ? '1' : '0.5';
            exportBtn.style.cursor = result.valid ? 'pointer' : 'not-allowed';
        }
```

- [ ] **Step 2: Rewrite the export handler to use tracer-io**

Replace `energy-path-tracer.html:1083-1139` (the entire `exportBtn` click listener) with:

```js
        // Export for Node-RED node configuration (JSON format)
        exportBtn.addEventListener('click', () => {
            if (exportBtn.disabled) return;
            const exportObj = TracerIO.buildCustomPaths(buildDescriptors(), Topology);
            const output = JSON.stringify(exportObj, null, 2);
            exportArea.value = output;

            navigator.clipboard.writeText(output).then(() => {
                const originalText = exportBtn.textContent;
                exportBtn.textContent = 'Copied!';
                setTimeout(() => { exportBtn.textContent = originalText; }, 1500);
            });
        });
```

- [ ] **Step 3: Rewrite the import handler to use tracer-io**

Replace `energy-path-tracer.html:1172-1230` (the entire `modalLoadBtn` click listener) with:

```js
        modalLoadBtn.addEventListener('click', () => {
            const input = loadJsonInput.value.trim();
            if (!input) { alert('Please paste JSON data'); return; }

            let parsed;
            try { parsed = JSON.parse(input); }
            catch (e) { alert('Error parsing JSON: ' + e.message); return; }

            if (!parsed.energyPaths && !parsed.labels && !parsed.entities) {
                alert('Invalid JSON format. Expected { entities?, energyPaths, labels }');
                return;
            }

            const result = TracerIO.parseCustomPaths(parsed, Topology.DEFAULT_ENTITIES, Topology);
            setModel(result.descriptors.map(function (d) { return descriptorToEntity(d); }));
            loadJsonModal.style.display = 'none';
            if (result.notices.length) alert(result.notices.join('\n'));
        });
```

- [ ] **Step 4: Manual verification**

Open the tracer. Verify:
- Header summary reads `5 entities, 6 paths, 5 labels` on load.
- Rename an entity to `inverter` → its card shows a red error, the summary turns red, **Copy JSON** is disabled. Rename it back → error clears, Export re-enabled.
- Make two entities resolve to the same key (e.g. `grid` and `Grid`) → duplicate-route error shown; Export disabled.
- Click **Copy JSON for Node-RED** → output contains an `entities` block (`"solar": { "direction": "source" }`, …), `inverterToHome` as a **2-element array**, and `inverterToGrid`/`Battery`/`Car` as strings (no `*ToInverter` geometry).
- **Load from JSON** the just-exported blob → the five cards rebuild identically (round-trip).
- **Load from JSON** a legacy blob (only `energyPaths` + `labels`, no `entities`, default names) → cards rebuild with correct directions, no warning alert.
- **Load from JSON** a legacy blob with an unknown name that only has an `inverterToX` key → that card loads as `sink` with a yellow "Direction guessed" note and an alert lists it.

- [ ] **Step 5: Commit**

```bash
git add energy-path-tracer.html
git commit -m "Validate entities live and route tracer export/import through tracer-io"
```

---

### Task 7: Instructions/help text, end-to-end check, build

**Files:**
- Modify: `energy-path-tracer.html` (the `.info-box` instructions, lines 392–404)

**Interfaces:**
- Consumes: everything above.
- Produces: updated user-facing instructions; a verified end-to-end path; green build.

- [ ] **Step 1: Update the instructions box**

Replace `energy-path-tracer.html:392-404` (the `.info-box` contents) with:

```html
        <div class="info-box">
            <strong>Instructions:</strong><br>
            1. Each entity has a <strong>name</strong> and a <strong>direction</strong>
               (source = into inverter, sink = out of inverter, both = bidirectional).<br>
            2. Use <strong>+ Add</strong> to add an entity, <strong>×</strong> to delete one,
               and <strong>+ segment</strong> for multi-part paths (like Home).<br>
            3. Click "Draw" on a segment or label, then click on the image to add points
               (first point = start).<br>
            4. Hold <strong>Shift</strong> to snap to horizontal/vertical lines. Esc or End to stop.<br>
            5. The derived route key(s) are shown under each entity; fix any red errors
               before exporting.<br>
            <br>
            <strong style="color: #ffd700;">Path Direction:</strong><br>
            Draw FROM source TO destination. The pulse animates first point → last point
            (green = start, red = end).<br>
            <em style="color:#888;">Open this tool from the repo root so it can load
            nodes/topology.js.</em>
        </div>
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all `topology` and `tracer-io` tests.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: build succeeds; the UMD bundle is produced without errors.

- [ ] **Step 4: End-to-end manual verification against a running node (optional but recommended)**

In a dev Node-RED instance with this widget:
- In the tracer, add a `generator` entity (`source`), draw a path and a label, **Copy JSON**.
- Paste the JSON into the node's `customPaths` field; deploy.
- Send `msg.payload = { routes: { generatorToInverter: true }, labels: { generator: { value: '3 kW' } } }`.
- Confirm the generator route animates and the GENERATOR label renders.

- [ ] **Step 5: Commit**

```bash
git add energy-path-tracer.html
git commit -m "Update Path Tracer instructions for configurable entities"
```

---

## Self-Review

**Spec coverage** (against `2026-06-22-path-tracer-configurable-entities-design.md`):
- In-memory entity model with stable `id`, segments-as-array → Task 4 Step 3/5.
- Browser-export footer on `topology.js` + `<script src>` → Task 1, Task 4 Step 1.
- Entity cards (name/direction/segments/label/align/derived-key/delete) → Task 4 Step 5; +Add → Task 5.
- Export `{ entities, energyPaths, labels }`, `both` forward-key-only, array for multi-segment → Task 2 + Task 6 Step 2.
- Import new + legacy with `DEFAULT_ENTITIES` resolution, key-shape inference, ambiguity flagging → Task 3 + Task 6 Step 3.
- Shared validation, inline errors, summary, Export disable → Task 6 Step 1.
- Defaults preserved on open → Task 4 Step 3 (`DEFAULT_GEOMETRY` + `Topology.DEFAULT_ENTITIES`) + Step 13 verification.
- Drawing engine unchanged mechanically, re-targeted by `id` → Task 4 Steps 6–11.
- Testing (unit on the pure logic, manual on the tracer, build green) → Tasks 1–3 (`npm test`), Task 4/5/6 manual steps, Task 7 build.

**Placeholder scan:** The two intentional placeholders (`syncValidation`/`onAddEntity` in Task 4) are explicitly replaced with full implementations in Tasks 6 and 5 respectively; both replacement sites quote the exact placeholder text. No `TBD`/`TODO`/"handle edge cases".

**Type consistency:** Descriptor fields (`name`, `direction`, `segments`, `labelPosition`, `label`, `align`, `directionGuessed`) are identical across `tracer-io.js`, the tests, and the tracer's `descriptorToEntity`/`buildDescriptors`. Function names are stable: `buildCustomPaths`, `parseCustomPaths`, `deriveTopology`, `validateEntities`, `toInverterKey`, `fromInverterKey`, `renderCards`, `setModel`, `findEntity`, `getTargetField`, `syncTargetInput`, `startDrawing`, `stopDrawing`, `renderRoutePath(pathData, isActive)`, `renderLabelPath(pathData, align, ent, isActive)`. DOM id scheme (`name-/dir-/seg-/lblpos-/lbltext-/align-/keys-/note-/err-/card-<id>`) is used identically in `createCard`, `wireCard`, `syncValidation`, `startDrawing`, and `syncTargetInput`.
