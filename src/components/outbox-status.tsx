'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { flushOutbox, isSyncing, onOutbox, pendingJobs } from '@/lib/outbox';

/**
 * A strip under the header on the counter's phone: no connection, or saved
 * work still waiting to be sent. Sends the queue whenever the connection
 * returns, the app comes back to the front, and every 30 seconds.
 */
export default function OutboxStatus() {
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [waiting, setWaiting] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let last = 0;
    const update = async () => {
      const n = (await pendingJobs()).length;
      setWaiting(n);
      setSending(isSyncing());
      // Everything went through: refresh the counts on screen.
      if (last > 0 && n === 0 && !isSyncing()) router.refresh();
      last = n;
    };
    const net = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) flushOutbox();
    };
    const front = () => document.visibilityState === 'visible' && flushOutbox();
    const t0 = setTimeout(() => {
      net();
      update();
    }, 0);
    const off = onOutbox(update);
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    document.addEventListener('visibilitychange', front);
    const timer = setInterval(() => flushOutbox(), 30_000);
    return () => {
      clearTimeout(t0);
      off();
      window.removeEventListener('online', net);
      window.removeEventListener('offline', net);
      document.removeEventListener('visibilitychange', front);
      clearInterval(timer);
    };
  }, [router]);

  if (online && waiting === 0) return null;
  return (
    <div
      className={`px-4 py-2 text-center text-sm font-semibold ${online ? 'bg-review/20 text-ink' : 'bg-mismatch text-white'}`}
    >
      {!online
        ? `📴 ინტერნეტი არ არის — ვინახავ ტელეფონში${waiting ? ` (${waiting})` : ''}`
        : sending
          ? `⏳ იგზავნება… (${waiting})`
          : `⏳ გასაგზავნია ${waiting} — ქსელს ველოდები`}
    </div>
  );
}
