import { useEffect, useState, useRef, useCallback } from 'react'

interface Entity {
  entity_id: string
  name: string
  type: string
  canonical_key?: string
  attributes?: Record<string, unknown> | null
  seen_by?: string | null
  created_at?: string
}

interface Relation {
  relation_id?: number
  source_id: string
  target_id: string
  kind: string
}

interface GraphData {
  nodes: Entity[]
  edges: Relation[]
}

interface Neighborhood {
  entity: Entity
  relations: Relation[]
  connectedEntities: Entity[]
}

// Force simulation node
interface SimNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  entity: Entity
  pinned: boolean
}

const TYPE_COLORS: Record<string, string> = {
  contact: '#3b82f6',   // blue
  company: '#22c55e',   // green
  document: '#f97316',  // orange
  project: '#a855f7',   // purple
  engagement: '#ef4444', // red
}
const DEFAULT_COLOR = '#6b7280' // gray

const TYPE_OPTIONS = ['contact', 'company', 'document', 'project', 'engagement', 'other']

function getColor(type: string): string {
  return TYPE_COLORS[type] ?? DEFAULT_COLOR
}

export default function EntityGraph() {
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] })
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null)
  const [neighborhood, setNeighborhood] = useState<Neighborhood | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set(TYPE_OPTIONS))
  const [loading, setLoading] = useState(true)

  // Force simulation state
  const simNodesRef = useRef<SimNode[]>([])
  const svgRef = useRef<SVGSVGElement | null>(null)
  const animFrameRef = useRef<number>(0)
  const draggingRef = useRef<string | null>(null)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const [, forceRender] = useState(0)

  // Fetch graph data
  useEffect(() => {
    setLoading(true)
    fetch('/api/entities/graph')
      .then(r => r.json())
      .then((data: GraphData) => {
        setGraph(data)
        setLoading(false)
      })
      .catch(() => { setGraph({ nodes: [], edges: [] }); setLoading(false) })
  }, [])

  // Initialize simulation nodes when graph data changes
  useEffect(() => {
    const width = 900
    const height = 600
    simNodesRef.current = graph.nodes.map((entity, i) => {
      // Distribute in a circle initially
      const angle = (2 * Math.PI * i) / Math.max(graph.nodes.length, 1)
      const radius = Math.min(width, height) * 0.35
      return {
        id: entity.entity_id,
        x: width / 2 + radius * Math.cos(angle) + (Math.random() - 0.5) * 20,
        y: height / 2 + radius * Math.sin(angle) + (Math.random() - 0.5) * 20,
        vx: 0,
        vy: 0,
        entity,
        pinned: false,
      }
    })
    forceRender(n => n + 1)
  }, [graph])

  // Force simulation loop
  const simulate = useCallback(() => {
    const nodes = simNodesRef.current
    if (nodes.length === 0) return
    const width = 900
    const height = 600
    const edges = graph.edges

    // Build adjacency for attraction
    const adjacency = new Map<string, Set<string>>()
    for (const e of edges) {
      if (!adjacency.has(e.source_id)) adjacency.set(e.source_id, new Set())
      if (!adjacency.has(e.target_id)) adjacency.set(e.target_id, new Set())
      adjacency.get(e.source_id)!.add(e.target_id)
      adjacency.get(e.target_id)!.add(e.source_id)
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]))

    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = 800 / (dist * dist)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        if (!a.pinned) { a.vx -= fx; a.vy -= fy }
        if (!b.pinned) { b.vx += fx; b.vy += fy }
      }
    }

    // Attraction along edges
    for (const e of edges) {
      const a = nodeMap.get(e.source_id)
      const b = nodeMap.get(e.target_id)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const force = (dist - 80) * 0.01
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      if (!a.pinned) { a.vx += fx; a.vy += fy }
      if (!b.pinned) { b.vx -= fx; b.vy -= fy }
    }

    // Center gravity
    for (const n of nodes) {
      if (n.pinned) continue
      n.vx += (width / 2 - n.x) * 0.001
      n.vy += (height / 2 - n.y) * 0.001
    }

    // Apply velocity with damping
    for (const n of nodes) {
      if (n.pinned) continue
      n.vx *= 0.85
      n.vy *= 0.85
      n.x += n.vx
      n.y += n.vy
      // Keep in bounds
      n.x = Math.max(20, Math.min(width - 20, n.x))
      n.y = Math.max(20, Math.min(height - 20, n.y))
    }

    forceRender(n => n + 1)
    animFrameRef.current = requestAnimationFrame(simulate)
  }, [graph.edges])

  useEffect(() => {
    if (graph.nodes.length > 0) {
      animFrameRef.current = requestAnimationFrame(simulate)
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [simulate, graph.nodes.length])

  // Click entity
  const handleEntityClick = (entity: Entity) => {
    setSelectedEntity(entity)
    fetch(`/api/entities/${entity.entity_id}/neighborhood`)
      .then(r => r.json())
      .then((data: Neighborhood) => setNeighborhood(data))
      .catch(() => setNeighborhood(null))
  }

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault()
    const node = simNodesRef.current.find(n => n.id === nodeId)
    if (!node) return
    draggingRef.current = nodeId
    node.pinned = true
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    dragOffsetRef.current = {
      x: e.clientX - rect.left - node.x,
      y: e.clientY - rect.top - node.y,
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!draggingRef.current) return
    const node = simNodesRef.current.find(n => n.id === draggingRef.current)
    if (!node) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    node.x = e.clientX - rect.left - dragOffsetRef.current.x
    node.y = e.clientY - rect.top - dragOffsetRef.current.y
    node.vx = 0
    node.vy = 0
  }

  const handleMouseUp = () => {
    if (draggingRef.current) {
      const node = simNodesRef.current.find(n => n.id === draggingRef.current)
      if (node) node.pinned = false
      draggingRef.current = null
    }
  }

  // Toggle type filter
  const toggleType = (type: string) => {
    setTypeFilters(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const nodes = simNodesRef.current
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // Apply filters
  const visibleNodeIds = new Set(
    nodes
      .filter(n => typeFilters.has(n.entity.type))
      .filter(n => !searchQuery || n.entity.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .map(n => n.id)
  )

  const highlightedIds = searchQuery
    ? new Set(nodes.filter(n => n.entity.name.toLowerCase().includes(searchQuery.toLowerCase())).map(n => n.id))
    : null

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main graph area */}
      <div className="flex-1 flex flex-col overflow-hidden p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-white">Entity Graph</h1>
          <span className="text-xs text-gray-500">{graph.nodes.length} entities, {graph.edges.length} relations</span>
        </div>

        {/* Search + type filters */}
        <div className="flex items-center gap-3 mb-4">
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search entities..."
            className="flex-1 text-sm bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
          <div className="flex items-center gap-1.5">
            {TYPE_OPTIONS.map(type => (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors flex items-center gap-1.5 ${
                  typeFilters.has(type) ? 'bg-gray-800 text-gray-300' : 'bg-gray-900 text-gray-600'
                }`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: typeFilters.has(type) ? getColor(type) : '#374151' }}
                />
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* SVG Canvas */}
        {graph.nodes.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
            No entities found. Run agents to populate the entity graph.
          </div>
        ) : (
          <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              viewBox="0 0 900 600"
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className="select-none"
            >
              {/* Edges */}
              {graph.edges.map((edge, i) => {
                const a = nodeMap.get(edge.source_id)
                const b = nodeMap.get(edge.target_id)
                if (!a || !b) return null
                if (!visibleNodeIds.has(a.id) || !visibleNodeIds.has(b.id)) return null
                const mx = (a.x + b.x) / 2
                const my = (a.y + b.y) / 2
                return (
                  <g key={`edge-${i}`}>
                    <line
                      x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke="#374151" strokeWidth="1" opacity={0.6}
                    />
                    {edge.kind && (
                      <text
                        x={mx} y={my - 4}
                        fill="#6b7280" fontSize="8" textAnchor="middle"
                      >
                        {edge.kind}
                      </text>
                    )}
                  </g>
                )
              })}

              {/* Nodes */}
              {nodes.map(node => {
                if (!visibleNodeIds.has(node.id)) return null
                const isHighlighted = highlightedIds ? highlightedIds.has(node.id) : false
                const isSelected = selectedEntity?.entity_id === node.id
                const color = getColor(node.entity.type)
                const radius = isSelected ? 10 : isHighlighted ? 9 : 7
                const opacity = highlightedIds && !isHighlighted ? 0.3 : 1
                return (
                  <g
                    key={node.id}
                    onMouseDown={e => handleMouseDown(e, node.id)}
                    onClick={() => handleEntityClick(node.entity)}
                    style={{ cursor: 'pointer', opacity }}
                  >
                    {isSelected && (
                      <circle cx={node.x} cy={node.y} r={radius + 3} fill="none" stroke={color} strokeWidth="2" opacity={0.5} />
                    )}
                    <circle cx={node.x} cy={node.y} r={radius} fill={color} />
                    <text
                      x={node.x} y={node.y + radius + 12}
                      fill="#d1d5db" fontSize="9" textAnchor="middle"
                      style={{ pointerEvents: 'none' }}
                    >
                      {node.entity.name.length > 16 ? node.entity.name.slice(0, 14) + '..' : node.entity.name}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>
        )}
      </div>

      {/* Sidebar detail panel */}
      {selectedEntity && (
        <div className="w-80 shrink-0 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
            <h2 className="font-semibold text-white truncate">{selectedEntity.name}</h2>
            <button
              onClick={() => { setSelectedEntity(null); setNeighborhood(null) }}
              className="text-gray-500 hover:text-white p-1 rounded hover:bg-gray-800 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M11 3L3 11M3 3l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {/* Basic info */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: getColor(selectedEntity.type) }}
                />
                <span className="text-xs text-gray-400 font-medium uppercase">{selectedEntity.type}</span>
              </div>
              {selectedEntity.canonical_key && (
                <div>
                  <span className="text-xs text-gray-600">Key: </span>
                  <span className="text-xs text-gray-400 font-mono">{selectedEntity.canonical_key}</span>
                </div>
              )}
              {selectedEntity.seen_by && (
                <div>
                  <span className="text-xs text-gray-600">Seen by: </span>
                  <span className="text-xs text-gray-400">{selectedEntity.seen_by}</span>
                </div>
              )}
              {selectedEntity.created_at && (
                <div>
                  <span className="text-xs text-gray-600">Created: </span>
                  <span className="text-xs text-gray-400">{new Date(selectedEntity.created_at).toLocaleDateString()}</span>
                </div>
              )}
            </div>

            {/* Attributes */}
            {selectedEntity.attributes && typeof selectedEntity.attributes === 'object' && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Attributes</h3>
                <div className="space-y-1">
                  {Object.entries(selectedEntity.attributes as Record<string, unknown>).map(([key, val]) => (
                    <div key={key} className="text-xs">
                      <span className="text-gray-600">{key}: </span>
                      <span className="text-gray-400">{String(val)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Connected entities */}
            {neighborhood && neighborhood.connectedEntities.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Connected ({neighborhood.connectedEntities.length})
                </h3>
                <div className="space-y-1.5">
                  {neighborhood.connectedEntities.map(e => {
                    const rel = neighborhood.relations.find(
                      r => r.source_id === e.entity_id || r.target_id === e.entity_id
                    )
                    return (
                      <div
                        key={e.entity_id}
                        onClick={() => handleEntityClick(e)}
                        className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-700 transition-colors"
                      >
                        <span
                          className="inline-block w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: getColor(e.type) }}
                        />
                        <span className="text-xs text-gray-300 truncate flex-1">{e.name}</span>
                        {rel?.kind && (
                          <span className="text-xs text-gray-600 shrink-0">{rel.kind}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Relations */}
            {neighborhood && neighborhood.relations.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Relations ({neighborhood.relations.length})
                </h3>
                <div className="space-y-1">
                  {neighborhood.relations.map((r, i) => (
                    <div key={i} className="text-xs text-gray-500">
                      <span className="text-gray-600">{r.kind}</span>
                      {' → '}
                      <span className="text-gray-400">
                        {r.source_id === selectedEntity.entity_id ? r.target_id : r.source_id}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
