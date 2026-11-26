import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, X } from 'lucide-react';

export interface QrLabelData {
  property_id: number;
  property_code: string;
  property_name: string;
  serial_number?: string | null;
  category_name?: string;
  location_name?: string;
  qr_value?: string;
  qr_image_data?: string | null;
}

interface QrLabelPrintModalProps {
  label: QrLabelData | null;
  onClose: () => void;
  primaryDoneLabel?: string;
  onPrimaryDone?: () => void;
}

export function QrLabelPrintModal({
  label,
  onClose,
  primaryDoneLabel = 'Close',
  onPrimaryDone,
}: QrLabelPrintModalProps) {
  const [imgSrc, setImgSrc] = useState<string>('');

  useEffect(() => {
    if (!label) return;
    if (label.qr_image_data) {
      setImgSrc(label.qr_image_data);
      return;
    }
    const text = label.qr_value || label.property_code;
    QRCode.toDataURL(text, { width: 300, margin: 2 })
      .then((url) => setImgSrc(url))
      .catch(() => setImgSrc(''));
  }, [label]);

  if (!label) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-base font-semibold text-slate-900">
            Printable Asset QR Label
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Printable Tag */}
        <div
          id="qr-print-area"
          className="border border-slate-300 rounded-lg p-5 bg-white text-center space-y-3"
        >
          <div className="border-b border-slate-200 pb-2">
            <p className="text-[11px] font-semibold tracking-wide text-blue-800 uppercase">
              MSU - Main Campus · CICS
            </p>
            <p className="text-xs text-slate-500">Official Property Identification Tag</p>
          </div>

          <div className="flex justify-center py-1">
            {imgSrc ? (
              <img
                src={imgSrc}
                alt={`QR code for ${label.property_code}`}
                className="w-44 h-44 object-contain"
              />
            ) : (
              <div className="w-44 h-44 bg-slate-100 flex items-center justify-center text-xs text-slate-500">
                Generating QR...
              </div>
            )}
          </div>

          <div className="space-y-1">
            <p className="font-mono text-base font-bold text-slate-900 tracking-tight">
              {label.property_code}
            </p>
            <p className="text-sm font-semibold text-slate-800 leading-snug">
              {label.property_name}
            </p>
            <p className="text-xs text-slate-600">
              {label.category_name || 'CICS Property'}
              {label.location_name ? ` · ${label.location_name}` : ''}
            </p>
            {label.serial_number && (
              <p className="text-[11px] font-mono text-slate-500">SN: {label.serial_number}</p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Printer className="w-4 h-4" />
            <span>Print QR Label</span>
          </button>
          <button
            type="button"
            onClick={onPrimaryDone || onClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            {primaryDoneLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
