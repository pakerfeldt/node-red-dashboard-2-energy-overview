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
