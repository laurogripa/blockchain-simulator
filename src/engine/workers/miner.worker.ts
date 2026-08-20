// Grinds real SHA-256d nonces against a header template, throttled to a hashrate budget.
import { sha256dHex } from '../crypto/sha256';
import { serializeHeader } from '../serialize';
import type { BlockHeader } from '../types';

type MainToWorker =
  | { type: 'template'; header: BlockHeader; target: string; hps: number }
  | { type: 'stop' }
  | { type: 'setHps'; hps: number };

type WorkerToMain =
  | { type: 'solved'; nonce: number; hash: string; hashesTried: number }
  | { type: 'progress'; hashesTried: number };

let header: BlockHeader | null = null;
let target = '';
let hps = 1000;
let nonce = 0;
let hashesTried = 0;
let running = false;
let lastProgressPost = 0;

function post(msg: WorkerToMain) {
  (self as unknown as Worker).postMessage(msg);
}

function tick() {
  if (!running || !header) return;
  const sliceMs = 16;
  const hashesThisSlice = Math.max(1, Math.round((hps * sliceMs) / 1000));
  for (let i = 0; i < hashesThisSlice; i++) {
    const h = { ...header, nonce };
    const hash = sha256dHex(serializeHeader(h));
    hashesTried++;
    if (hash <= target) {
      running = false;
      post({ type: 'solved', nonce, hash, hashesTried });
      return;
    }
    nonce++;
  }
  const now = Date.now();
  if (now - lastProgressPost > 90) {
    lastProgressPost = now;
    post({ type: 'progress', hashesTried });
  }
  setTimeout(tick, 0);
}

self.onmessage = (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  if (msg.type === 'template') {
    header = msg.header;
    target = msg.target;
    hps = msg.hps;
    nonce = 0;
    hashesTried = 0;
    lastProgressPost = 0;
    running = true;
    tick();
  } else if (msg.type === 'stop') {
    running = false;
    header = null;
  } else if (msg.type === 'setHps') {
    hps = msg.hps;
  }
};
