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

var api = {
	buildCustomPaths: buildCustomPaths,
	parseCustomPaths: parseCustomPaths
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = api
}
if (typeof window !== 'undefined') {
	window.TracerIO = api
}
