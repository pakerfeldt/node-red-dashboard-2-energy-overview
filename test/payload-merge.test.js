'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const { mergePayload } = require('../nodes/payload-merge')

test('non-reset: incoming routes/labels merge over stored state', () => {
    const stored = { routes: { solarToInverter: true }, labels: { solar: { value: '5 kW' } } }
    const incoming = { routes: { inverterToHome: true }, labels: { home: { value: '2 kW' } } }
    const out = mergePayload(stored, incoming, { reset: false, bidirectional: {} })
    assert.deepStrictEqual(out.routes, { solarToInverter: true, inverterToHome: true })
    assert.deepStrictEqual(out.labels, { solar: { value: '5 kW' }, home: { value: '2 kW' } })
})

test('non-reset: turning a bidirectional route ON auto-disables its opposite', () => {
    const bidirectional = { gridToInverter: 'inverterToGrid', inverterToGrid: 'gridToInverter' }
    const stored = { routes: { inverterToGrid: true } }
    const incoming = { routes: { gridToInverter: true } }
    const out = mergePayload(stored, incoming, { reset: false, bidirectional })
    assert.deepStrictEqual(out.routes, { inverterToGrid: false, gridToInverter: true })
})

test('reset: every previously-stored route is switched OFF explicitly (not omitted)', () => {
    const stored = {
        routes: { solarToInverter: true, inverterToHome: true, generatorToInverter: true },
        labels: { solar: { sublabel: 'Producing' } }
    }
    const incoming = { routes: {}, labels: { generator: { value: '0 kW', sublabel: 'Idle' } } }
    const out = mergePayload(stored, incoming, { reset: true, bidirectional: {} })
    assert.deepStrictEqual(out.routes, {
        solarToInverter: false,
        inverterToHome: false,
        generatorToInverter: false
    })
    // reset drops stored labels, then applies the incoming labels
    assert.deepStrictEqual(out.labels, { generator: { value: '0 kW', sublabel: 'Idle' } })
})

test('reset with a new active route: stored routes go false, the new route stays true', () => {
    const stored = { routes: { solarToInverter: true } }
    const incoming = { routes: { generatorToInverter: true } }
    const out = mergePayload(stored, incoming, { reset: true, bidirectional: {} })
    assert.deepStrictEqual(out.routes, { solarToInverter: false, generatorToInverter: true })
})

test('does not mutate the incoming payload object', () => {
    const incoming = { routes: { gridToInverter: true }, labels: {} }
    const before = JSON.stringify(incoming)
    mergePayload({ routes: {} }, incoming, { reset: false, bidirectional: { gridToInverter: 'inverterToGrid' } })
    assert.strictEqual(JSON.stringify(incoming), before)
})

test('tolerates missing/empty stored and incoming payloads', () => {
    assert.deepStrictEqual(mergePayload(undefined, undefined, { reset: false }), { routes: {}, labels: {} })
    assert.deepStrictEqual(mergePayload({}, {}, { reset: true }), { routes: {}, labels: {} })
})
