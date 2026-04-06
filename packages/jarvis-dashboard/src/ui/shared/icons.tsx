/* ── SVG Icon Components ──────────────────────────────────── */
/* Consolidated from App.tsx + Home.tsx inline icons.          */
/* All icons: 20x20 viewBox, stroke-based, currentColor.      */

import type { ReactNode } from 'react'

const I = ({ children }: { children: ReactNode }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

/* ── Navigation icons ─────────────────────────────────────── */

export function IconHome() {
  return <I><path d="M3 10.5L10 4l7 6.5" /><path d="M5 9.5V16a1 1 0 001 1h3v-4h2v4h3a1 1 0 001-1V9.5" /></I>
}

export function IconWorkflow() {
  return <I><path d="M4 6h5M4 10h3M4 14h5" /><circle cx="14" cy="6" r="2" /><circle cx="14" cy="14" r="2" /><path d="M12 6H9M12 14H9M14 8v4" /></I>
}

export function IconInbox() {
  return <I><path d="M3 10l3-3h8l3 3" /><rect x="3" y="10" width="14" height="7" rx="1" /><path d="M3 10h4l1 2h4l1-2h4" /></I>
}

export function IconHistory() {
  return <I><circle cx="10" cy="10" r="7" /><path d="M10 6v4l3 2" /><path d="M3 10H1M10 3V1" /></I>
}

export function IconSystem() {
  return <I><rect x="4" y="3" width="12" height="10" rx="1" /><path d="M7 16h6M10 13v3" /><circle cx="10" cy="8" r="1.5" /></I>
}

export function IconRecovery() {
  return <I><path d="M4 10a6 6 0 0111.3-2.7" /><path d="M16 10a6 6 0 01-11.3 2.7" /><path d="M15 4v3.3h-3.3" /><path d="M5 16v-3.3h3.3" /></I>
}

export function IconSettings() {
  return <I><circle cx="10" cy="10" r="3" /><path d="M10 2v2M10 16v2M3.5 5.5l1.4 1.4M15.1 13.1l1.4 1.4M2 10h2M16 10h2M3.5 14.5l1.4-1.4M15.1 6.9l1.4-1.4" /></I>
}

export function IconGodmode() {
  return <I><path d="M10 2L3 7v6l7 5 7-5V7z" /><circle cx="10" cy="10" r="3" /><path d="M10 7v6M7 10h6" /></I>
}

export function IconRuns() {
  return <I><path d="M3 10h2l2-5 3 10 2-5h5" /></I>
}

export function IconModels() {
  return <I><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="11" y="3" width="6" height="6" rx="1" /><rect x="3" y="11" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" /></I>
}

export function IconQueue() {
  return <I><path d="M4 5h12M4 9h10M4 13h8" /><circle cx="16" cy="13" r="1" /></I>
}

export function IconSupport() {
  return <I><circle cx="10" cy="10" r="7" /><path d="M10 7v3M10 13v.5" /></I>
}

/* ── Expert-only / legacy nav icons ───────────────────────── */

export function IconCrm() {
  return <I><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M2 7h16" /><path d="M7 7v10" /></I>
}

export function IconKnowledge() {
  return <I><path d="M4 4h4l2 2h6a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" /></I>
}

export function IconDecisions() {
  return <I><path d="M10 3v14" /><path d="M3 10h14" /><circle cx="10" cy="10" r="7" /></I>
}

export function IconSchedule() {
  return <I><rect x="3" y="4" width="14" height="13" rx="2" /><path d="M3 8h14" /><path d="M7 2v4M13 2v4" /></I>
}

export function IconPlugins() {
  return <I><path d="M8 3v3M12 3v3" /><rect x="4" y="6" width="12" height="11" rx="2" /><path d="M8 17v-3h4v3" /></I>
}

export function IconGraph() {
  return <I><circle cx="10" cy="5" r="2" /><circle cx="5" cy="14" r="2" /><circle cx="15" cy="14" r="2" /><path d="M10 7v3M8.5 11.5L6.5 12.5M11.5 11.5l2 1" /></I>
}

export function IconAnalytics() {
  return <I><path d="M5 16V10M10 16V6M15 16V3" /></I>
}

/* ── Inline utility icons (smaller, for badges/actions) ───── */

export function IconWarning({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path d="M9 2L16.5 15H1.5L9 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 7v3M9 12v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function IconError({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 6.5l5 5M11.5 6.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function IconCheck({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 9l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconArrowRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconChevronLeft({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconClock({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 5v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
