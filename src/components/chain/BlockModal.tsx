import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useSimStore } from '../../store/useSimStore';
import { engine } from '../../engine/engine';
import { computeBlockHash, meetsTarget } from '../../engine/chain';
import { targetHexForBits } from '../../engine/constants';
import { feeRate } from '../../engine/mempool';
import type { BlockHeader } from '../../engine/types';

const MINE_CHUNK = 4000; // hashes per tick, keeps the main thread responsive

/**
 * Click-a-block inspector, à la Anders Brownworth's demo: shows the full header, lets you
 * tamper with nonce/timestamp/merkleRoot and watch the hash go invalid, and re-mine it for
 * real. Purely a local sandbox — it never touches the committed chain or the sim's own miners.
 */
export function BlockModal() {
  const inspectedBlock = useSimStore((s) => s.inspectedBlock);
  const closeBlockModal = useSimStore((s) => s.closeBlockModal);
  useSimStore((s) => s.blockIndex); // re-render when new blocks arrive (children list)

  const block = inspectedBlock ? engine.blocks.get(inspectedBlock) : undefined;

  const [nonce, setNonce] = useState(0);
  const [timestamp, setTimestamp] = useState(0);
  const [merkleRoot, setMerkleRoot] = useState('');
  const [mining, setMining] = useState(false);
  const [hashesTried, setHashesTried] = useState(0);
  const [tab, setTab] = useState<'header' | 'txs'>('header');
  const miningRef = useRef(false);

  // Reset the scratch fields whenever a different block is opened.
  useEffect(() => {
    if (!block) return;
    setNonce(block.header.nonce);
    setTimestamp(block.header.timestamp);
    setMerkleRoot(block.header.merkleRoot);
    setMining(false);
    setHashesTried(0);
    miningRef.current = false;
    setTab('header');
  }, [block]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeBlockModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeBlockModal]);

  const liveHeader: BlockHeader | null = block
    ? { ...block.header, nonce, timestamp, merkleRoot }
    : null;
  const liveHash = useMemo(() => (liveHeader ? computeBlockHash(liveHeader) : ''), [liveHeader]);
  const target = block ? targetHexForBits(block.header.bits) : '';
  const isValid = block ? meetsTarget(liveHash, block.header.bits) : false;
  const isTampered = block
    ? nonce !== block.header.nonce || timestamp !== block.header.timestamp || merkleRoot !== block.header.merkleRoot
    : false;

  const children = block
    ? Array.from(engine.blocks.values()).filter((b) => b.hash !== block.hash && b.header.prevHash === block.hash)
    : [];

  function mine() {
    if (!block) return;
    setMining(true);
    miningRef.current = true;
    let n = nonce;
    const header = { ...block.header, timestamp, merkleRoot };
    const t = targetHexForBits(block.header.bits);

    function step() {
      if (!miningRef.current) return;
      for (let i = 0; i < MINE_CHUNK; i++) {
        const h = computeBlockHash({ ...header, nonce: n });
        if (h <= t) {
          setNonce(n);
          setHashesTried((prev) => prev + i + 1);
          setMining(false);
          miningRef.current = false;
          return;
        }
        n++;
      }
      setHashesTried((prev) => prev + MINE_CHUNK);
      setNonce(n);
      setTimeout(step, 0);
    }
    setTimeout(step, 0);
  }

  function stopMining() {
    miningRef.current = false;
    setMining(false);
  }

  function reset() {
    if (!block) return;
    stopMining();
    setNonce(block.header.nonce);
    setTimestamp(block.header.timestamp);
    setMerkleRoot(block.header.merkleRoot);
    setHashesTried(0);
  }

  if (!block) return null;

  return (
    <div
      onClick={closeBlockModal}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel"
        style={{ width: 560, maxHeight: '85vh', overflow: 'auto', padding: 16 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="display" style={{ fontSize: 20 }}>block h{block.height}</span>
            {block.minedBy !== 'genesis' && (
              <span className="mono" style={{ color: `var(--miner-${block.minedBy})`, fontSize: 12 }}>
                {block.minedBy}
              </span>
            )}
            <span className={`seal ${isValid ? '' : 'seal-void'}`} style={{ fontSize: 10, width: 34, height: 34, marginLeft: 4 }}>
              {isValid ? 'OK' : 'VOID'}
            </span>
          </div>
          <button onClick={closeBlockModal}>×</button>
        </div>

        <Field label="hash (live, from header fields)">
          <span
            className="mono"
            style={{ wordBreak: 'break-all', color: isValid ? 'var(--good)' : 'var(--danger)' }}
          >
            {liveHash}
          </span>
        </Field>

        <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
          {!mining ? (
            <button onClick={mine} className={!isValid ? 'active' : ''}>
              ⛏ mine
            </button>
          ) : (
            <button onClick={stopMining}>stop</button>
          )}
          <button onClick={reset} disabled={!isTampered && hashesTried === 0}>
            reset
          </button>
          <span className="mono" style={{ alignSelf: 'center', color: 'var(--text-dim)', fontSize: 11 }}>
            {mining ? `grinding… ${hashesTried.toLocaleString()} hashes` : isTampered ? 'tampered — hash no longer matches the chain' : 'unmodified'}
          </span>
        </div>

        {children.length > 0 && (
          <div style={{ marginBottom: 12, fontSize: 11 }}>
            <div className="panel-title">children (would break if you change this block)</div>
            {children.map((c) => {
              const linkOk = !isTampered;
              return (
                <div key={c.hash} className="mono" style={{ color: linkOk ? 'var(--text-dim)' : 'var(--danger)' }}>
                  h{c.height} · {c.hash.slice(0, 10)} → prevHash {linkOk ? 'OK' : 'MISMATCH'}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 2, marginBottom: 10, borderBottom: '1px solid var(--border)' }}>
          <TabButton label="header" active={tab === 'header'} onClick={() => setTab('header')} />
          <TabButton label={`transactions (${block.txs.length})`} active={tab === 'txs'} onClick={() => setTab('txs')} />
        </div>

        {tab === 'header' && (
          <>
            <Field label="hash (committed)">
              <span className="mono" style={{ wordBreak: 'break-all', color: 'var(--text-dim)' }}>
                {block.hash}
              </span>
            </Field>

            <Field label="target">
              <span className="mono" style={{ wordBreak: 'break-all', color: 'var(--text-dim)', fontSize: 10 }}>
                {target}
              </span>
            </Field>

            <Field label="prev hash">
              <span className="mono" style={{ wordBreak: 'break-all', color: 'var(--text-dim)' }}>
                {block.header.prevHash}
              </span>
            </Field>

            <Field label="merkle root">
              <input
                className="mono"
                style={inputStyle}
                value={merkleRoot}
                onChange={(e) => setMerkleRoot(e.target.value)}
              />
            </Field>

            <Field label="timestamp">
              <input
                type="number"
                className="mono"
                style={inputStyle}
                value={timestamp}
                onChange={(e) => setTimestamp(Number(e.target.value))}
              />
            </Field>

            <Field label="nonce">
              <input
                type="number"
                className="mono"
                style={inputStyle}
                value={nonce}
                onChange={(e) => setNonce(Number(e.target.value))}
              />
            </Field>

            <Field label="bits (fixed)">
              <span className="mono">{block.header.bits}</span>
            </Field>
          </>
        )}

        {tab === 'txs' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              columnGap: 12,
              rowGap: 6,
              fontSize: 11,
            }}
          >
            <div className="mono" style={{ color: 'var(--text-dim)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em' }}>txid</div>
            <div className="mono" style={{ color: 'var(--text-dim)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em' }}>outputs</div>
            <div className="mono" style={{ color: 'var(--text-dim)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>fee rate</div>
            {block.txs.map((tx) => (
              <div key={tx.txid} className="mono" style={{ display: 'contents' }}>
                <span style={{ color: tx.isCoinbase ? 'var(--accent)' : 'var(--text)' }}>
                  {tx.isCoinbase ? '⛏ coinbase' : tx.txid.slice(0, 10)}
                </span>
                <span style={{ color: 'var(--text-dim)' }}>
                  {tx.outputs.map((o, i) => (
                    <span key={i} style={{ marginRight: 10 }}>
                      <span style={{ color: `var(--addr-${o.address})` }}>{o.address}</span> {o.value}
                    </span>
                  ))}
                </span>
                <span style={{ color: 'var(--text-dim)', textAlign: 'right' }}>
                  {tx.isCoinbase ? '—' : feeRate(tx).toFixed(3)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        borderRadius: 0,
        color: active ? 'var(--text)' : 'var(--text-dim)',
        padding: '6px 10px',
        fontSize: 10,
      }}
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 12 }}>{children}</div>
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: '100%',
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  color: 'var(--text)',
  padding: '4px 6px',
  fontSize: 11,
};
