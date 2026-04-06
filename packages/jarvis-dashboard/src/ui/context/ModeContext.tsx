import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Mode = 'simple' | 'expert'
type ModeContextType = { mode: Mode; setMode: (m: Mode) => void }

const ModeContext = createContext<ModeContextType>({ mode: 'simple', setMode: () => {} })

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>('simple')

  useEffect(() => {
    fetch('/api/mode')
      .then(r => r.json())
      .then(d => setModeState(d.mode ?? 'simple'))
      .catch(() => {})
  }, [])

  const setMode = (m: Mode) => {
    const previous = mode
    setModeState(m)
    fetch('/api/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: m }),
    }).then(r => {
      if (!r.ok) setModeState(previous)
    }).catch(() => {
      setModeState(previous)
    })
  }

  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>
}

export const useMode = () => useContext(ModeContext)
