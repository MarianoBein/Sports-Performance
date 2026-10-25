import { useEffect, type ReactNode } from 'react';

export default function Dialogo({ titulo, onCerrar, children, pie, ancho = 640 }: { titulo: string; onCerrar: () => void; children: ReactNode; pie?: ReactNode; ancho?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCerrar]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-label={titulo} style={{ maxWidth: ancho }}>
        <div className="dialog-head">
          <h2 className="display">{titulo}</h2>
          <button type="button" className="close" aria-label="Cerrar" onClick={onCerrar}>×</button>
        </div>
        <div className="dialog-body">{children}</div>
        {pie && <div className="dialog-foot">{pie}</div>}
      </section>
    </div>
  );
}
