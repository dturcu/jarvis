import { useEffect, useState } from 'react'

interface StageCount {
  stage: string
  count: number
}

interface Velocity {
  from_stage: string
  to_stage: string
  avg_days: number
  transitions: number
}

interface Activity {
  date: string
  count: number
}

interface ScoreBucket {
  bucket: string
  count: number
}

const STAGE_COLORS: Record<string, string> = {
  prospect: '#6366f1',
  qualified: '#8b5cf6',
  contacted: '#3b82f6',
  meeting: '#06b6d4',
  proposal: '#10b981',
  negotiation: '#f59e0b',
  won: '#22c55e',
  lost: '#ef4444',
  parked: '#6b7280',
}

export default function CrmAnalytics() {
  const [pipeline, setPipeline] = useState<StageCount[]>([])
  const [velocity, setVelocity] = useState<Velocity[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [scores, setScores] = useState<ScoreBucket[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/analytics/pipeline').then(r => r.json()),
      fetch('/api/analytics/velocity').then(r => r.json()),
      fetch('/api/analytics/activity').then(r => r.json()),
      fetch('/api/analytics/scores').then(r => r.json()),
    ]).then(([p, v, a, s]) => {
      setPipeline(p)
      setVelocity(v)
      setActivity(a)
      setScores(s)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>
  }

  const maxPipelineCount = Math.max(...pipeline.map(p => p.count), 1)
  const totalContacts = pipeline.reduce((sum, p) => sum + p.count, 0)
  const maxScoreCount = Math.max(...scores.map(s => s.count), 1)

  // Activity heatmap: 7 columns (days of week) x 13 rows (weeks)
  // Fill last 91 days
  const activityMap = new Map(activity.map(a => [a.date, a.count]))
  const heatmapDays: Array<{ date: string; count: number; dayOfWeek: number }> = []
  const today = new Date()
  for (let i = 90; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    heatmapDays.push({
      date: dateStr,
      count: activityMap.get(dateStr) ?? 0,
      dayOfWeek: d.getDay(),
    })
  }
  const maxActivity = Math.max(...heatmapDays.map(d => d.count), 1)

  // Arrange into weeks (columns)
  const weeks: Array<Array<{ date: string; count: number; dayOfWeek: number } | null>> = []
  let currentWeek: Array<{ date: string; count: number; dayOfWeek: number } | null> = Array(7).fill(null)
  for (const day of heatmapDays) {
    if (day.dayOfWeek === 0 && currentWeek.some(d => d !== null)) {
      weeks.push(currentWeek)
      currentWeek = Array(7).fill(null)
    }
    currentWeek[day.dayOfWeek] = day
  }
  if (currentWeek.some(d => d !== null)) weeks.push(currentWeek)

  // Donut chart calculations
  const donutRadius = 70
  const donutCenter = 90
  const donutStroke = 20
  let cumulativeAngle = 0

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">CRM Analytics</h1>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Pipeline Funnel */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Pipeline Funnel</h2>
          {pipeline.length === 0 ? (
            <p className="text-sm text-gray-600">No data available.</p>
          ) : (
            <div className="space-y-2">
              {pipeline.map(p => {
                const widthPct = (p.count / maxPipelineCount) * 100
                const color = STAGE_COLORS[p.stage] ?? '#6b7280'
                return (
                  <div key={p.stage} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-20 text-right truncate">{p.stage}</span>
                    <div className="flex-1 relative h-6">
                      <svg width="100%" height="24" className="overflow-visible">
                        <rect
                          x="0" y="2" rx="4" ry="4"
                          width={`${widthPct}%`} height="20"
                          fill={color} opacity={0.8}
                        />
                        <text
                          x={Math.max(widthPct * 3, 20)} y="16"
                          fill="#e5e7eb" fontSize="11" fontWeight="500"
                        >
                          {p.count}
                        </text>
                      </svg>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Stage Donut Chart */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Stage Distribution</h2>
          {pipeline.length === 0 || totalContacts === 0 ? (
            <p className="text-sm text-gray-600">No data available.</p>
          ) : (
            <div className="flex items-center gap-6">
              <svg width="180" height="180" viewBox="0 0 180 180">
                {pipeline.map(p => {
                  const fraction = p.count / totalContacts
                  const angle = fraction * 2 * Math.PI
                  const startAngle = cumulativeAngle
                  cumulativeAngle += angle
                  const endAngle = cumulativeAngle

                  // Arc path using large arc flag
                  const r = donutRadius
                  const x1 = donutCenter + r * Math.cos(startAngle - Math.PI / 2)
                  const y1 = donutCenter + r * Math.sin(startAngle - Math.PI / 2)
                  const x2 = donutCenter + r * Math.cos(endAngle - Math.PI / 2)
                  const y2 = donutCenter + r * Math.sin(endAngle - Math.PI / 2)
                  const largeArc = angle > Math.PI ? 1 : 0
                  const color = STAGE_COLORS[p.stage] ?? '#6b7280'

                  if (fraction < 0.005) return null

                  return (
                    <path
                      key={p.stage}
                      d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
                      fill="none"
                      stroke={color}
                      strokeWidth={donutStroke}
                      strokeLinecap="butt"
                    />
                  )
                })}
                <text x={donutCenter} y={donutCenter - 4} textAnchor="middle" fill="#e5e7eb" fontSize="20" fontWeight="bold">
                  {totalContacts}
                </text>
                <text x={donutCenter} y={donutCenter + 14} textAnchor="middle" fill="#6b7280" fontSize="10">
                  contacts
                </text>
              </svg>
              <div className="space-y-1.5">
                {pipeline.map(p => (
                  <div key={p.stage} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: STAGE_COLORS[p.stage] ?? '#6b7280' }} />
                    <span className="text-xs text-gray-400">{p.stage}</span>
                    <span className="text-xs text-gray-600">{p.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Activity Heatmap */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Activity (90 days)</h2>
          {heatmapDays.every(d => d.count === 0) ? (
            <p className="text-sm text-gray-600">No activity recorded.</p>
          ) : (
            <div>
              <div className="flex gap-0.5">
                {weeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-0.5">
                    {week.map((day, di) => {
                      if (!day) return <div key={di} className="w-3 h-3" />
                      const intensity = day.count / maxActivity
                      const opacity = day.count === 0 ? 0.08 : 0.2 + intensity * 0.8
                      return (
                        <div
                          key={di}
                          title={`${day.date}: ${day.count} activities`}
                          className="w-3 h-3 rounded-sm"
                          style={{ backgroundColor: `rgba(99, 102, 241, ${opacity})` }}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3 text-xs text-gray-600">
                <span>Less</span>
                {[0.08, 0.3, 0.5, 0.7, 1].map((op, i) => (
                  <div
                    key={i}
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: `rgba(99, 102, 241, ${op})` }}
                  />
                ))}
                <span>More</span>
              </div>
            </div>
          )}
        </div>

        {/* Score Histogram */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Score Distribution</h2>
          {scores.every(s => s.count === 0) ? (
            <p className="text-sm text-gray-600">No scored contacts.</p>
          ) : (
            <svg width="100%" height="160" viewBox="0 0 300 160">
              {scores.map((s, i) => {
                const barWidth = 48
                const gap = 12
                const x = i * (barWidth + gap) + 10
                const barHeight = (s.count / maxScoreCount) * 120
                const y = 130 - barHeight
                return (
                  <g key={s.bucket}>
                    <rect
                      x={x} y={y} rx="4" ry="4"
                      width={barWidth} height={barHeight}
                      fill="#6366f1" opacity={0.7 + (i * 0.06)}
                    />
                    <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fill="#d1d5db" fontSize="11" fontWeight="500">
                      {s.count}
                    </text>
                    <text x={x + barWidth / 2} y={148} textAnchor="middle" fill="#6b7280" fontSize="9">
                      {s.bucket}
                    </text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>
      </div>

      {/* Velocity Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Stage Velocity</h2>
        {velocity.length === 0 ? (
          <p className="text-sm text-gray-600">No stage transitions recorded.</p>
        ) : (
          <div className="overflow-hidden rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5 font-medium">From Stage</th>
                  <th className="text-left px-4 py-2.5 font-medium">To Stage</th>
                  <th className="text-left px-4 py-2.5 font-medium">Avg Days</th>
                  <th className="text-left px-4 py-2.5 font-medium">Transitions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {velocity.map((v, i) => (
                  <tr key={i} className="hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: (STAGE_COLORS[v.from_stage] ?? '#6b7280') + '33', color: STAGE_COLORS[v.from_stage] ?? '#9ca3af' }}>
                        {v.from_stage}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: (STAGE_COLORS[v.to_stage] ?? '#6b7280') + '33', color: STAGE_COLORS[v.to_stage] ?? '#9ca3af' }}>
                        {v.to_stage}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-300 font-medium">
                      {v.avg_days} days
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {v.transitions}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
