import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSesion } from '../lib/sesion';
import { mensajeError } from '../lib/supabase';
import { DIAS, cargarActividades, desdeIso, hora, iso, lunesDe, sumarDias, type Actividad } from '../lib/calendario';

const CORTE = '14:00';
const dm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
const conPunto = (t: string | null) => { const h = hora(t); return h ? `${Number(h.slice(0, 2))}.${h.slice(3)}` : ''; };

export default function ExportarSemana() {
  const { perfil } = useSesion();
  const [params, setParams] = useSearchParams();
  const lunes = lunesDe(params.get('desde') ? desdeIso(params.get('desde')!) : new Date());
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)), [params.get('desde')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [acts, setActs] = useState<Actividad[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    cargarActividades(iso(dias[0]), iso(dias[6]))
      .then((a) => setActs(a.filter((x) => x.tipo === 'deportiva' || x.tipo === 'logistica')))
      .catch((e) => setError(mensajeError(e)));
  }, [dias]);

  if (!perfil) return null;
  const sede = (perfil.club.sede_local ?? '').toUpperCase();

  const lugarDe = (d: Date) => {
    const s = iso(d);
    const partidoFuera = acts.find((a) => a.fecha === s && a.es_partido && a.fuera);
    if (partidoFuera) return { texto: (partidoFuera.lugar ?? partidoFuera.rival ?? 'FUERA').toUpperCase(), fuera: true };
    const hay = acts.some((a) => a.fecha === s);
    const finde = d.getDay() === 0 || d.getDay() === 6;
    return { texto: !finde || hay ? sede : '', fuera: false };
  };
  const tramos = (() => {
    const out: { texto: string; fuera: boolean; span: number; inicio: number }[] = [];
    dias.forEach((d, i) => {
      const l = lugarDe(d);
      const ult = out[out.length - 1];
      if (ult && l.texto && ult.texto === l.texto && ult.fuera === l.fuera) ult.span++;
      else out.push({ ...l, span: 1, inicio: i });
    });
    return out;
  })();
  const lineas = (d: Date, manana: boolean) => acts
    .filter((a) => a.fecha === iso(d) && (a.todo_el_dia ? manana : manana === (hora(a.hora_inicio) < CORTE)))
    .map((a) => ({
      id: a.id,
      texto: a.todo_el_dia ? a.nombre.toUpperCase() : `${conPunto(a.hora_inicio)} ${a.es_partido && a.rival ? `vs ${a.rival}`.toUpperCase() : a.nombre.toUpperCase()}`,
      partido: a.es_partido,
    }));
  const verde = (d: Date) => lugarDe(d).fuera;
  const borde = '2px solid #000';

  const Franja = ({ titulo, manana }: { titulo: string; manana: boolean }) => (
    <>
      <div style={{ borderTop: borde, padding: 4, textAlign: 'center', fontSize: 15, fontWeight: 700 }}>{titulo}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', borderTop: borde }}>
        {tramos.map((t) => (
          <div key={t.inicio} style={{ gridColumn: `span ${t.span}`, padding: '5px 4px', textAlign: 'center', fontSize: 15, fontWeight: 700, minHeight: 28, background: t.fuera ? '#CDEBB8' : undefined, borderRight: t.inicio + t.span < 7 ? borde : undefined }}>{t.texto}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', borderTop: borde }}>
        {dias.map((d, i) => (
          <div key={i} style={{ minHeight: 130, padding: '12px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, textAlign: 'center', background: verde(d) ? '#E3F3D8' : undefined, borderRight: i < 6 ? borde : undefined }}>
            {lineas(d, manana).map((l) => <span key={l.id} style={{ fontSize: 12, fontWeight: l.partido ? 700 : 400 }}>{l.texto}</span>)}
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div>
      <div className="no-print row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="row">
          <Link to="/calendario" className="btn">← Calendario</Link>
          <button type="button" className="btn" aria-label="Semana anterior" style={{ width: 44, padding: 0 }} onClick={() => setParams({ desde: iso(sumarDias(lunes, -7)) })}>‹</button>
          <button type="button" className="btn" aria-label="Semana siguiente" style={{ width: 44, padding: 0 }} onClick={() => setParams({ desde: iso(sumarDias(lunes, 7)) })}>›</button>
          <span className="small muted">Solo actividades deportivas y logísticas · corte a las 14:00</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Descargar PDF</button>
      </div>
      <p className="no-print xs muted" style={{ marginTop: -8 }}>En la ventana de impresión elige «Guardar como PDF» y orientación horizontal.</p>
      {error && <p className="notice notice-error no-print">{error}</p>}

      <div className="hoja" style={{ background: '#fff', color: '#000', fontFamily: 'Arial, Helvetica, sans-serif', padding: '24px 28px', borderRadius: 8, overflowX: 'auto' }}>
        <div style={{ minWidth: 860, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{perfil.club.nombre}</span>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{perfil.club.temporada ? `${perfil.club.temporada} ` : ''}Semana del {dm(dias[0])} al {dm(dias[6])}</p>
            <span style={{ width: 120 }} />
          </div>
          <p style={{ margin: 0, textAlign: 'center', fontSize: 12 }}>LOS HORARIOS QUEDAN SUJETOS A MODIFICACIONES POR PARTE DEL ENTRENADOR</p>
          <div style={{ border: borde }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))' }}>
              {dias.map((d, i) => (
                <div key={i} style={{ padding: '6px 4px', textAlign: 'center', fontSize: 15, fontWeight: 700, borderRight: i < 6 ? borde : undefined }}>{DIAS[i]} {d.getDate()}</div>
              ))}
            </div>
            <Franja titulo="MAÑANAS" manana />
            <Franja titulo="TARDES" manana={false} />
          </div>
        </div>
      </div>
    </div>
  );
}
