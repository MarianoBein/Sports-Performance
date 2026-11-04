import { useEffect } from 'react';

// Pantalla de «gracias» después de responder: se cierra sola.
export default function Gracias({ titulo, detalle, onCerrar, ms = 2200 }: { titulo: string; detalle: string; onCerrar: () => void; ms?: number }) {
  useEffect(() => { const t = window.setTimeout(onCerrar, ms); return () => window.clearTimeout(t); }, [onCerrar, ms]);
  return (
    <div role="status" className="gracias" onClick={onCerrar}>
      <span className="gracias-check" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5 9-10" /></svg>
      </span>
      <strong className="display" style={{ fontSize: 34 }}>{titulo}</strong>
      <span className="small muted" style={{ maxWidth: 300, textAlign: 'center' }}>{detalle}</span>
    </div>
  );
}
