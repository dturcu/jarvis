interface TabBarProps<T extends string> {
  tabs: readonly T[]
  active: T
  onChange: (tab: T) => void
  badges?: Partial<Record<T, number>>
  variant?: 'pill' | 'underline'
}

export default function TabBar<T extends string>({
  tabs, active, onChange, badges, variant = 'pill',
}: TabBarProps<T>) {
  if (variant === 'underline') {
    return (
      <div className="flex gap-6 border-b border-white/5 mb-6">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => onChange(tab)}
            className={`pb-2.5 text-sm font-medium transition-colors relative cursor-pointer ${
              active === tab
                ? 'text-indigo-400 border-b-2 border-indigo-500 -mb-px'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab}
            {badges?.[tab] != null && badges[tab]! > 0 && (
              <span className="ml-1.5 bg-amber-500/90 text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                {badges[tab]}
              </span>
            )}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex gap-1.5 mb-6">
      {tabs.map(tab => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`text-xs px-3.5 py-1.5 rounded-full font-medium transition-colors cursor-pointer ${
            active === tab
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
          }`}
        >
          {tab}
          {badges?.[tab] != null && badges[tab]! > 0 && (
            <span className="ml-1.5 bg-amber-500/90 text-black text-[10px] font-bold px-1 py-0.5 rounded-full min-w-[16px] text-center inline-block">
              {badges[tab]}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
