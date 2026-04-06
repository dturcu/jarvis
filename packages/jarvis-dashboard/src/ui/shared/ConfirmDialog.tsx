import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  warning?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open, title, message, warning, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  variant = 'default', onConfirm, onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (open) dialogRef.current?.showModal()
    else dialogRef.current?.close()
  }, [open])

  if (!open) return null

  const confirmColors = {
    danger: 'bg-red-600 hover:bg-red-500 text-white',
    warning: 'bg-amber-600 hover:bg-amber-500 text-white',
    default: 'bg-indigo-600 hover:bg-indigo-500 text-white',
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="bg-transparent p-0 m-0 max-w-md w-full backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="bg-slate-900 border border-white/10 rounded-xl p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-white mb-2">{title}</h2>
        <p className="text-sm text-slate-400 mb-4">{message}</p>
        {warning && (
          <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg px-4 py-3 mb-4">
            <p className="text-xs text-amber-300">{warning}</p>
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="text-sm px-4 py-2 rounded-lg font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors cursor-pointer ${confirmColors[variant]}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
