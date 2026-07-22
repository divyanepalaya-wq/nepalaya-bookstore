import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { Camera, X, RefreshCw, Flashlight } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface CameraScanProps {
  onScan: (value: string) => void
  onClose?: () => void
  /** Stop after first successful scan. Default true. */
  single?: boolean
}

const DEBOUNCE_MS = 1500

function isSecureContext(): boolean {
  return (
    window.isSecureContext ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  )
}

function buildReader() {
  const hints = new Map<DecodeHintType, unknown>()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.ITF,
  ])
  hints.set(DecodeHintType.TRY_HARDER, true)
  // Delay between decode attempts (ms) — lower = snappier, higher = less CPU
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 50 })
}

/**
 * Full-screen barcode / QR scanner.
 * Uses a single ZXing decodeFromConstraints path (no double getUserMedia).
 */
export default function CameraScan({ onScan, onClose, single = true }: CameraScanProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [flash, setFlash] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const lastScannedRef = useRef('')
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
    } catch {
      /* ignore */
    }
    controlsRef.current = null
    const video = videoRef.current
    const stream = video?.srcObject as MediaStream | null
    stream?.getTracks().forEach((t) => t.stop())
    if (video) video.srcObject = null
    setTorchOn(false)
    setTorchSupported(false)
  }, [])

  const close = useCallback(() => {
    stop()
    onCloseRef.current?.()
  }, [stop])

  const toggleTorch = useCallback(async () => {
    const video = videoRef.current
    const stream = video?.srcObject as MediaStream | null
    const track = stream?.getVideoTracks()?.[0]
    if (!track) return
    const caps = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean }
    if (!caps?.torch) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch {
      /* torch unsupported on this device */
    }
  }, [torchOn])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
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
    const reader = buildReader()

    const handleResult = (result: { getText: () => string } | undefined, ctrl?: IScannerControls) => {
      if (ctrl && !controlsRef.current) controlsRef.current = ctrl
      if (!result) return
      const text = result.getText().trim()
      if (!text) return
      const now = Date.now()
      if (lastScannedRef.current === text && now - lastScanTime.current < DEBOUNCE_MS) return
      lastScannedRef.current = text
      lastScanTime.current = now
      setFlash(true)
      window.setTimeout(() => setFlash(false), 250)
      try {
        navigator.vibrate?.(40)
      } catch { /* ignore */ }
      onScanRef.current(text)
      if (single) {
        stop()
        onCloseRef.current?.()
      }
    }

    async function startCamera() {
      setStarting(true)
      setError(null)

      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot use the camera. Type the barcode, or use Chrome / Safari.')
        setStarting(false)
        return
      }
      if (!isSecureContext()) {
        setError('Camera needs HTTPS (or localhost). Open the preview over a secure link.')
        setStarting(false)
        return
      }

      const constraintsList: MediaStreamConstraints[] = [
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        {
          audio: false,
          video: { facingMode: 'environment' },
        },
        {
          audio: false,
          video: true,
        },
      ]

      let lastError: unknown

      for (const constraints of constraintsList) {
        if (cancelled) return
        try {
          const controls = await reader.decodeFromConstraints(
            constraints,
            videoEl!,
            (result, _err, ctrl) => handleResult(result ?? undefined, ctrl),
          )
          if (cancelled) {
            controls.stop()
            return
          }
          controlsRef.current = controls

          // Detect torch support after stream is live
          const stream = videoEl!.srcObject as MediaStream | null
          const track = stream?.getVideoTracks()?.[0]
          const caps = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean }
          setTorchSupported(Boolean(caps?.torch))

          setStarting(false)
          return
        } catch (e) {
          lastError = e
        }
      }

      // Final fallback: let ZXing pick any video device
      try {
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoEl!,
          (result, _err, ctrl) => handleResult(result ?? undefined, ctrl),
        )
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
        setStarting(false)
      } catch (e2) {
        const err = e2 ?? lastError
        const msg = err instanceof Error ? err.message : ''
        const name = err instanceof Error ? err.name : err instanceof DOMException ? err.name : ''
        if (name === 'NotAllowedError' || /permission|notallowed/i.test(msg)) {
          setError('Camera blocked. Tap the camera icon in the address bar → Allow, then Try again.')
        } else if (name === 'NotFoundError' || /device not found/i.test(msg)) {
          setError('No camera found. Plug in a webcam, or type / USB-scan the barcode.')
        } else if (name === 'NotReadableError') {
          setError('Camera is busy in another app. Close it and tap Try again.')
        } else {
          setError(msg || 'Could not open camera. Type the barcode instead.')
        }
        setStarting(false)
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
      className="fixed inset-0 z-[200] flex flex-col bg-neutral-950 text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Barcode scanner"
    >
      {/* Header */}
      <header className="safe-area-pt shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-neutral-950/95 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <Camera className="h-5 w-5 text-orange-400 shrink-0" />
          <h3 className="font-semibold text-base truncate">Scan barcode</h3>
        </div>
        <div className="flex items-center gap-1">
          {torchSupported && (
            <button
              type="button"
              onClick={() => void toggleTorch()}
              className={`rounded-full p-2.5 transition-colors ${
                torchOn ? 'bg-amber-400 text-neutral-950' : 'hover:bg-white/10 text-white'
              }`}
              aria-label={torchOn ? 'Turn torch off' : 'Turn torch on'}
            >
              <Flashlight className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={close}
            className="rounded-full p-2.5 hover:bg-white/10"
            aria-label="Close camera"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </header>

      {/* Viewport */}
      <div className="relative flex-1 min-h-0 bg-black overflow-hidden">
        <video
          ref={setVideoRef}
          className="absolute inset-0 h-full w-full object-cover"
          muted
          playsInline
          autoPlay
        />

        {/* Dim overlay with clear cutout (no giant box-shadow) */}
        {!error && !starting && (
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="absolute inset-x-0 top-0 h-[18%] bg-black/55" />
            <div className="absolute inset-x-0 bottom-0 h-[22%] bg-black/55" />
            <div className="absolute top-[18%] bottom-[22%] left-0 w-[10%] bg-black/55" />
            <div className="absolute top-[18%] bottom-[22%] right-0 w-[10%] bg-black/55" />
            {/* Corner brackets */}
            <div className="absolute top-[18%] left-[10%] right-[10%] bottom-[22%]">
              <span className="absolute top-0 left-0 h-8 w-8 border-t-[3px] border-l-[3px] border-orange-400 rounded-tl-md" />
              <span className="absolute top-0 right-0 h-8 w-8 border-t-[3px] border-r-[3px] border-orange-400 rounded-tr-md" />
              <span className="absolute bottom-0 left-0 h-8 w-8 border-b-[3px] border-l-[3px] border-orange-400 rounded-bl-md" />
              <span className="absolute bottom-0 right-0 h-8 w-8 border-b-[3px] border-r-[3px] border-orange-400 rounded-br-md" />
              <span className="absolute left-[8%] right-[8%] top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
            </div>
          </div>
        )}

        {flash && (
          <div className="pointer-events-none absolute inset-0 bg-emerald-400/30 animate-pulse" />
        )}

        {starting && !error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
            <div className="h-9 w-9 rounded-full border-2 border-white/30 border-t-orange-400 animate-spin" />
            <p className="text-sm font-medium">Starting camera…</p>
            <p className="text-xs text-white/60">Allow access when the browser asks</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-neutral-950/95 px-6 text-center">
            <p className="max-w-sm text-sm leading-relaxed text-red-100">{error}</p>
            <Button
              variant="outline"
              className="bg-white text-neutral-900 border-0"
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
      </div>

      {/* Footer */}
      <footer className="pb-safe shrink-0 space-y-3 border-t border-white/10 bg-neutral-950 px-4 pt-3">
        <p className="text-center text-sm text-white/70">
          Line up the barcode in the frame — it scans automatically
        </p>
        <Button
          variant="outline"
          className="w-full min-h-[48px] bg-white text-neutral-900 border-0 font-semibold"
          onClick={close}
        >
          Cancel — type code instead
        </Button>
      </footer>
    </div>
  )

  return createPortal(ui, document.body)
}
