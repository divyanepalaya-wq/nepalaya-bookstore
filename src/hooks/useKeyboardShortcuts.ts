import { useEffect, useRef } from 'react'

type ShortcutMap = Record<string, () => void>

/**
 * App-wide keyboard shortcuts.
 * - Single keys: '?', '[', Escape
 * - Sequences: 'g h', 'g s', etc. (G then letter within 1s)
 * Ignored while typing in inputs/textareas/contenteditable.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap, enabled = true) {
  const pendingG = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return

    const isTyping = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable
      )
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.target)) return

      const key = e.key.toLowerCase()

      if (key === 'escape' && shortcuts.escape) {
        shortcuts.escape()
        return
      }

      if (key === '?' && shortcuts['?']) {
        e.preventDefault()
        shortcuts['?']()
        pendingG.current = false
        return
      }

      if (key === '[' && shortcuts['[']) {
        e.preventDefault()
        shortcuts['[']()
        pendingG.current = false
        return
      }

      if (key === 'g') {
        pendingG.current = true
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => { pendingG.current = false }, 1000)
        return
      }

      if (pendingG.current) {
        pendingG.current = false
        if (timer.current) clearTimeout(timer.current)
        const chord = `g ${key}`
        if (shortcuts[chord]) {
          e.preventDefault()
          shortcuts[chord]()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [shortcuts, enabled])
}
