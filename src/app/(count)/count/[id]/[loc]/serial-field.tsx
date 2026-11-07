'use client';

import { useState } from 'react';
import { inputClass } from '@/components/ui';
import Scanner from '../../scanner';

/**
 * Picks the serial number out of text read from a rating plate: the value
 * after S/N, SN, Serial No…, otherwise the longest letters-and-digits token.
 */
export function serialFromText(text: string): string | null {
  const t = text.replace(/[|]/g, 'I').replace(/\s+/g, ' ').toUpperCase();
  const tagged = t.match(
    /(?:S\s*\/\s*N|SN|SERIAL\s*(?:NO|NUMBER|#)?|SER\.?\s*NO)\s*[:.#-]?\s*([A-Z0-9][A-Z0-9-/]{3,30})/,
  );
  if (tagged) return tagged[1].replace(/[-/]+$/, '');
  const tokens = (t.match(/[A-Z0-9][A-Z0-9-]{4,30}/g) ?? []).filter(
    (x) => /\d/.test(x) && /[A-Z0-9]{5,}/.test(x),
  );
  return tokens.sort((a, b) => b.length - a.length)[0] ?? null;
}

async function readPlate(file: File): Promise<{ serial: string | null; text: string }> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/:#. ',
  });
  const { data } = await worker.recognize(file);
  await worker.terminate();
  return { serial: serialFromText(data.text), text: data.text.replace(/\s+/g, ' ').trim() };
}

/**
 * Factory serial number: typed, scanned from its barcode (most equipment has
 * one next to "S/N"), or read from a photo of the rating plate.
 */
export default function SerialField({
  value,
  onChange,
  ocr = true,
}: {
  value: string;
  onChange: (v: string) => void;
  /** The 📷 read-from-photo button (off in the stock app). */
  ocr?: boolean;
}) {
  const [scan, setScan] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="ქარხნული სერიული №"
          className={`${inputClass} py-3 text-base`}
        />
        <button
          type="button"
          onClick={() => setScan((v) => !v)}
          aria-label="სერიულის შტრიხკოდის სკანი"
          className="w-14 shrink-0 rounded-control border border-rule-strong text-lg"
        >
          ▮▮
        </button>
        {ocr && (
          <label
            aria-label="სერიულის ამოცნობა ფოტოდან"
            className="grid w-14 shrink-0 cursor-pointer place-items-center rounded-control border border-rule-strong text-lg"
          >
            📷
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setNote('ვკითხულობ ფირფიტას…');
                try {
                  const { serial, text } = await readPlate(f);
                  if (serial) {
                    onChange(serial);
                    setNote(`წავიკითხე: ${serial} — შეამოწმე.`);
                  } else
                    setNote(
                      `ნომერი ვერ ვიპოვე${text ? ` („${text.slice(0, 40)}“)` : ''}. ჩაწერე ხელით.`,
                    );
                } catch {
                  setNote('ვერ წავიკითხე. ჩაწერე ხელით.');
                }
              }}
            />
          </label>
        )}
      </div>
      {scan && (
        <Scanner
          label="სერიულის შტრიხკოდი"
          onCode={(code) => {
            onChange(code.trim());
            setScan(false);
            setNote('');
          }}
        />
      )}
      {note && <p className="text-xs text-ink-soft">{note}</p>}
    </div>
  );
}
