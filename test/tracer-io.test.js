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
