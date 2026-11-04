'use client';

import { useActionState, useState, useTransition } from 'react';
import { Alert, Button, inputClass } from '@/components/ui';
import Scanner from '../scanner';
import { matchShelf, openZone, type FormState } from '../actions';

const EMPTY: FormState = {};

type Shelf = { id: string; code: string; name: string };

/** Reads the text on a shelf label photo (e.g. "T-01") in the browser. */
async function readLabel(file: File): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-./ ' });
  const { data } = await worker.recognize(file);
  await worker.terminate();
  return data.text.replace(/\s+/g, ' ').trim();
}

/**
 * Step 1 of counting: say which shelf. Four ways: scan its barcode/QR, photograph
 * a printed label such as "T-01" (read on the phone), type it, or — in a
 * warehouse whose shelves have no numbers — create a zone on the spot.
 * Scans and photos ask for confirmation before the shelf opens.
 */
export default function ZoneOpener({ stocktakeId }: { stocktakeId: string }) {
  const [state, action, pending] = useActionState(openZone.bind(null, stocktakeId), EMPTY);
  const [candidate, setCandidate] = useState<Shelf | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [newZone, setNewZone] = useState(false);
  const [typed, setTyped] = useState('');

  function propose(text: string) {
    setReadError(null);
    setReading(text);
    start(async () => {
      const shelf = await matchShelf(text);
      if (shelf) setCandidate(shelf);
      else {
        setCandidate(null);
        setReadError(`„${text}“ — ასეთი თარო ვერ ვიპოვე. შეასწორე ხელით ქვემოთ.`);
        setTyped(text.split(' ')[0] ?? '');
      }
    });
  }

  const missing = state.notice === 'missing';

  return (
    <section className="grid gap-3 rounded-control border border-rule/70 p-4">
      <p className="text-base font-semibold">1. აირჩიე თარო</p>

      <Scanner label="თაროს QR / შტრიხკოდი" onCode={propose} />

      <label className="cursor-pointer rounded-control border border-rule-strong bg-paper-sunk px-4 py-3 text-center text-base font-semibold">
        🔤 წარწერის ფოტო (მაგ. T-01)
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setCandidate(null);
            setReadError(null);
            setReading('ვკითხულობ წარწერას…');
            readLabel(f)
              .then((t) => (t ? propose(t) : setReadError('წარწერა ვერ წავიკითხე. გადაიღე ახლოდან ან ჩაწერე ხელით.')))
              .catch(() => setReadError('წარწერის წამკითხველი ვერ ჩაიტვირთა. ჩაწერე ხელით.'))
              .finally(() => setReading(null));
          }}
        />
      </label>
      {(reading || busy) && !candidate && <p className="text-center text-sm text-ink-soft">{reading ?? 'ვეძებ…'}</p>}

      {candidate && (
        <form action={action} className="grid gap-2 rounded-control border-2 border-match/60 bg-match/5 p-3">
          <input type="hidden" name="code" value={candidate.code} />
          <p className="text-base">
            თარო <b className="text-xl">{candidate.code}</b> {candidate.name !== candidate.code && <span className="text-ink-soft">· {candidate.name}</span>}?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setCandidate(null)} className="rounded-control border border-rule-strong py-3">✗ არა</button>
            <button type="submit" disabled={pending} className="rounded-control bg-ink py-3 font-semibold text-paper">✓ დიახ, გახსნა</button>
          </div>
        </form>
      )}
      {readError && <p className="text-sm text-mismatch">{readError}</p>}

      <form action={action} className="flex gap-2">
        <input value={typed} onChange={(e) => setTyped(e.target.value)} name="code" required autoCapitalize="characters" placeholder="ან ჩაწერე, მაგ. T-01" className={`${inputClass} text-base`} />
        <Button type="submit" disabled={pending}>{pending ? '…' : 'გახსნა'}</Button>
      </form>

      {state.error && <Alert>{state.error}</Alert>}

      {missing && (
        <form action={action} className="grid gap-2 rounded-control border border-review/50 p-3">
          <input type="hidden" name="create" value="1" />
          <input type="hidden" name="code" value={typed} />
          <p className="text-sm">დავამატო ახალი თარო <b>{typed}</b>?</p>
          <input name="name" placeholder="აღწერა (არასავალდებულო)" className={`${inputClass} text-base`} />
          <Button type="submit" disabled={pending}>+ დამატება და გახსნა</Button>
        </form>
      )}

      <button type="button" onClick={() => setNewZone((v) => !v)} className="text-left text-sm text-ink-soft underline">
        თაროები დანომრილი არ არის? → ახალი ზონა
      </button>
      {newZone && (
        <form action={action} className="grid gap-2 rounded-control border border-rule/70 p-3">
          <input type="hidden" name="create" value="1" />
          <p className="text-sm text-ink-soft">
            ზონას ნომერს თავად მივანიჭებ (Z-001, Z-002…). მოკლედ აღწერე, სად არის — მერე ამ ნომრით ეტიკეტსაც დავბეჭდავთ.
          </p>
          <input name="name" required placeholder="მაგ. კარის მარჯვნივ, ქვედა იარუსი" className={`${inputClass} text-base`} />
          <Button type="submit" disabled={pending}>+ ზონის შექმნა და დათვლა</Button>
        </form>
      )}
    </section>
  );
}
