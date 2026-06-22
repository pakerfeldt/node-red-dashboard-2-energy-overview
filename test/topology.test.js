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
