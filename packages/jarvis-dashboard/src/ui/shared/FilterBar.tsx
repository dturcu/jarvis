interface SelectFilter {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}

interface FilterBarProps {
  filters: SelectFilter[]
  search?: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }
}

export default function FilterBar({ filters, search }: FilterBarProps) {
  return (
    <div className="flex items-center gap-3 mb-5">
      {search && (
        <input
          type="text"
          value={search.value}
          onChange={e => search.onChange(e.target.value)}
          placeholder={search.placeholder ?? 'Search...'}
          className="text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500 flex-1 max-w-xs"
        />
      )}
      {filters.map(filter => (
        <select
          key={filter.label}
          value={filter.value}
          onChange={e => filter.onChange(e.target.value)}
          className="text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500"
        >
          {filter.options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ))}
    </div>
  )
}
