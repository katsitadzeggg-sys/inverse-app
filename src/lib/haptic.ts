'use client';

/**
 * A short buzz (and beep) when a code is read.
 *
 * iPhone Safari has no navigator.vibrate. Since iOS 18 a tap on the label of
 * an <input type="checkbox" switch> gives a haptic tick, and a click from
 * script counts, so that is used there. A short beep goes with it, so the
 * counter also hears that the scan went through.
 */
let label: HTMLLabelElement | null = null;
let audio: AudioContext | null = null;

function iosTick() {
  if (!label) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.id = 'haptic-switch';
    input.style.display = 'none';
    label = document.createElement('label');
    label.htmlFor = input.id;
    label.style.display = 'none';
    document.body.append(input, label);
  }
  label.click();
}

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === 'suspended') audio.resume();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 1700;
    gain.gain.setValueAtTime(0.12, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.12);
  } catch {}
}

export function scanFeedback() {
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(60);
    else iosTick();
  } catch {}
  beep();
}
