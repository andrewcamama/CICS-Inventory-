import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff, Keyboard, Search } from 'lucide-react';

interface QrScannerPanelProps {
  onLookup: (code: string, method: 'QR' | 'Barcode' | 'Manual') => Promise<void> | void;
  loading?: boolean;
  error?: string | null;
  title?: string;
  subtitle?: string;
}

export function QrScannerPanel({
  onLookup,
  loading = false,
  error = null,
  title = 'Scan Property QR Code or Barcode',
  subtitle = 'Use your device camera, a USB barcode scanner, or enter the Property ID / Serial Number manually.',
}: QrScannerPanelProps) {
  const [manualCode, setManualCode] = useState('');
  const [entryMode, setEntryMode] = useState<'Manual' | 'Barcode'>('Manual');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const readerIdRef = useRef(`cics-qr-reader-${Math.random().toString(36).slice(2, 8)}`);

  const stopCamera = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      } catch {
        // Ignore cleanup errors
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setCameraError(null);
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setCameraError(
        'Camera access requires HTTPS on LAN (or localhost). Please use Manual Entry / USB Scanner below, or enable HTTPS per README.'
      );
      inputRef.current?.focus();
      return;
    }

    try {
      setCameraActive(true);
      await new Promise((r) => setTimeout(r, 80));
      const html5Qr = new Html5Qrcode(readerIdRef.current);
      scannerRef.current = html5Qr;
      await html5Qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        async (decodedText) => {
          const clean = decodedText.trim();
          if (clean) {
            await stopCamera();
            setManualCode(clean);
            await onLookup(clean, 'QR');
          }
        },
        () => {
          // Ignore per-frame decode misses
        }
      );
    } catch (err: any) {
      await stopCamera();
      setCameraError(
        err?.message?.includes('Permission') || err?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Use Manual Entry or USB Barcode Scanner below.'
          : 'No usable camera detected on this device. Use Manual Entry or USB Barcode Scanner below.'
      );
      inputRef.current?.focus();
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualCode.trim();
    if (!trimmed) return;
    await onLookup(trimmed, entryMode);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-600 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!cameraActive ? (
            <button
              type="button"
              onClick={startCamera}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
            >
              <Camera className="w-4 h-4" />
              <span>Start Camera Scan</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={stopCamera}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
            >
              <CameraOff className="w-4 h-4" />
              <span>Stop Camera</span>
            </button>
          )}
        </div>
      </div>

      {cameraActive && (
        <div className="mb-5 border border-slate-200 rounded-lg overflow-hidden bg-slate-950 max-w-md mx-auto">
          <div id={readerIdRef.current} className="w-full min-h-[240px]" />
          <p className="text-xs text-slate-300 text-center py-2 px-3 bg-slate-900">
            Point camera at a CICS Property QR label or barcode
          </p>
        </div>
      )}

      {cameraError && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
          {cameraError}
        </div>
      )}

      <form onSubmit={handleManualSubmit} className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label htmlFor="manual-property-input" className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
            <Keyboard className="w-3.5 h-3.5 text-slate-500" />
            <span>Manually Enter Property ID / Serial Number (or scan with USB Barcode Scanner)</span>
          </label>
          <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md text-xs">
            <button
              type="button"
              onClick={() => setEntryMode('Manual')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                entryMode === 'Manual' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Manual ID
            </button>
            <button
              type="button"
              onClick={() => setEntryMode('Barcode')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                entryMode === 'Barcode' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              USB Barcode
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            ref={inputRef}
            id="manual-property-input"
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="e.g. CICS-PRP-0001 or SN-DL7010-8841"
            className="flex-1 px-3.5 py-2.5 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
          />
          <button
            type="submit"
            disabled={loading || !manualCode.trim()}
            className="px-5 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Search className="w-4 h-4" />
            <span>{loading ? 'Looking up...' : 'Retrieve Property'}</span>
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}
