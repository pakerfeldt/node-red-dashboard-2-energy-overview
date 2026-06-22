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
