import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { BrowserMultiFormatReader, BrowserCodeReader, type IScannerControls } from '@zxing/browser'
import { Camera, X, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface CameraScanProps {
  onScan: (value: string) => void
  onClose?: () => void
  /** Stop after first successful scan. Default true. */
  single?: boolean
}

const DEBOUNCE_MS = 1200

function isSecureContext(): boolean {
  return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
}

/**
 * Full-viewport barcode/QR scanner.
 * Explicitly requests getUserMedia first so desktop browsers show the permission prompt.
 */
export default function CameraScan({ onScan, onClose, single = true }: CameraScanProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [retryKey, setRetryKey] = useState(0)
  const lastScannedRef = useRef<string>('')
  const lastScanTime = useRef(0)
  const onScanRef = useRef(onScan)
  const onCloseRef = useRef(onClose)
  onScanRef.current = onScan
  onCloseRef.current = onClose

  const setVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node
    setVideoEl(node)
  }, [])

  const stop = useCallback(() => {
    try {
      controlsRef.current?.stop()
    } catch { /* ignore */ }
    controlsRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const close = useCallback(() => {
    stop()
    onCloseRef.current?.()
  }, [stop])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [close])

  useEffect(() => {
    if (!videoEl) return

    let cancelled = false
    const reader = new BrowserMultiFormatReader()

    async function startCamera() {
      const video = videoEl
      if (!video) return

      setStarting(true)
      setError(null)

      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser does not support camera access. Type the barcode instead, or use Chrome/Edge/Safari.')
        setStarting(false)
        return
      }

      if (!isSecureContext()) {
        setError('Camera needs HTTPS (or localhost). Open the site over a secure connection.')
        setStarting(false)
        return
      }

      try {
        // 1) Ask for permission explicitly — works on desktop webcams
        //    Prefer rear camera on phones; any camera on desktop.
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          })
        } catch {
          // Desktop often has no "environment" camera — fall back to any video device
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true,
          })
        }

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        streamRef.current = stream
        video.srcObject = stream
        await video.play().catch(() => { /* autoplay policies — muted+playsInline usually OK */ })

        // 2) Decode from the live stream
        const controls = await reader.decodeFromStream(stream, video, (result, _err, ctrl) => {
          if (!controlsRef.current) controlsRef.current = ctrl
          if (!result) return
          const text = result.getText().trim()
          if (!text) return
          const now = Date.now()
          if (lastScannedRef.current === text && now - lastScanTime.current < DEBOUNCE_MS) return
          lastScannedRef.current = text
          lastScanTime.current = now
          onScanRef.current(text)
          if (single) {
            stop()
            onCloseRef.current?.()
          }
        })

        if (cancelled) {
          controls.stop()
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        controlsRef.current = controls
        setStarting(false)
      } catch (e) {
        // Last resort: list devices then decodeFromVideoDevice
        try {
          await BrowserCodeReader.listVideoInputDevices()
          if (cancelled) throw e

          const controls = await reader.decodeFromVideoDevice(
            undefined,
            video,
            (result, _err, ctrl) => {
              if (!controlsRef.current) controlsRef.current = ctrl
              if (!result) return
              const text = result.getText().trim()
              if (!text) return
              const now = Date.now()
              if (lastScannedRef.current === text && now - lastScanTime.current < DEBOUNCE_MS) return
              lastScannedRef.current = text
              lastScanTime.current = now
              onScanRef.current(text)
              if (single) {
                stop()
                onCloseRef.current?.()
              }
            },
          )
          if (cancelled) {
            controls.stop()
            return
          }
          controlsRef.current = controls
          setStarting(false)
          return
        } catch (e2) {
          const msg = e2 instanceof Error ? e2.message : (e instanceof Error ? e.message : '')
          const name = e2 instanceof Error ? e2.name : (e instanceof DOMException ? e.name : '')
          if (name === 'NotAllowedError' || msg.includes('Permission') || msg.includes('NotAllowed')) {
            setError('Camera permission denied. Click the camera icon in the address bar → Allow, then tap Try again.')
          } else if (name === 'NotFoundError' || msg.includes('Requested device not found')) {
            setError('No camera found on this computer. Plug in a webcam, or type / USB-scan the barcode.')
          } else if (name === 'NotReadableError') {
            setError('Camera is busy (another app is using it). Close Zoom/Meet and tap Try again.')
          } else {
            setError(msg || 'Could not open camera. Type the barcode instead, or use a USB scanner.')
          }
          setStarting(false)
        }
      }
    }

    void startCamera()
    return () => {
      cancelled = true
      stop()
    }
  }, [videoEl, single, stop, retryKey])

  const ui = (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Barcode scanner"
    >
      <div className="absolute inset-0 bg-black" aria-hidden />

      <div className="relative z-[101] flex flex-col h-full w-full max-w-lg mx-auto">
        <div className="flex items-center justify-between px-4 py-3 bg-black/90 text-white safe-area-pt">
          <h3 className="font-semibold flex items-center gap-2 text-base">
            <Camera className="h-5 w-5 text-accent-400" />
            Point at barcode
          </h3>
          <button
            type="button"
            onClick={close}
            className="rounded-full p-2 hover:bg-white/10"
            aria-label="Close camera"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="relative flex-1 bg-black flex items-center justify-center min-h-0">
          <video
            ref={setVideoRef}
            className="absolute inset-0 w-full h-full object-cover"
            muted
            playsInline
            autoPlay
          />
          {starting && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white text-sm px-4 text-center bg-black/50">
              <div className="h-8 w-8 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              <p>Requesting camera…</p>
              <p className="text-xs text-white/60">Allow access when your browser asks</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center bg-black/85">
              <p className="text-red-100 text-sm leading-relaxed max-w-sm">{error}</p>
              <Button
                variant="outline"
                className="bg-white"
                onClick={() => {
                  stop()
                  setRetryKey((k) => k + 1)
                }}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Try again
              </Button>
            </div>
          )}
          {!error && !starting && (
            <>
              <div className="absolute inset-[12%] border-2 border-white/60 rounded-2xl pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              <div className="absolute inset-x-[18%] top-1/2 h-0.5 bg-red-500/90 -translate-y-1/2 pointer-events-none" />
            </>
          )}
        </div>

        <div className="relative z-[101] px-4 pt-3 pb-safe bg-black/95 text-center space-y-3">
          <p className="text-sm text-white/80">
            Hold steady — scans automatically. Press Esc to cancel.
          </p>
          <Button variant="outline" className="w-full bg-white" onClick={close}>
            Cancel — type barcode instead
          </Button>
        </div>
      </div>
    </div>
  )

  return createPortal(ui, document.body)
}
