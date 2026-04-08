import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ModeProvider } from './context/ModeContext.tsx'
import AppShell from './shell/AppShell.tsx'
import Prototype from './pages/Prototype.tsx'

export default function App() {
  return (
    <BrowserRouter>
      <ModeProvider>
        <Routes>
          {/* Standalone prototype — own shell, no nesting */}
          <Route path="/prototype" element={<Prototype />} />
          {/* Everything else — production shell */}
          <Route path="/*" element={<AppShell />} />
        </Routes>
      </ModeProvider>
    </BrowserRouter>
  )
}
