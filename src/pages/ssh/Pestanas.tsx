import { useMemo, useState } from 'react';
import { DIAS_CORTOS, desdeIso, fechaLarga, hoyIso, iso, sumarDias } from '../../lib/calendario';
import { etiquetaMD } from '../../lib/workout';
import {
  NOMBRE, VENTANA_MOVIL, diasEntre, fmt, refMD, refMovil, resumen, semaforo, semanaDe,
  type Datos, type Metrica, type Periodo,
} from '../../lib/carga';
import { Cargando, FiltroGrupo, Leyenda, SelectorPeriodo, Valor, filtrar, useDatos } from './comun';
import { useSesion } from '../../lib/sesion';

// Qué mide este club (Ajustes → Fuentes de datos). Lo que no tiene no se muestra.
function useFuentes() {
  const { perfil } = useSesion();
  return { gps: !!perfil?.club.fuentes?.gps, fuerza: !!perfil?.club.fuentes?.fuerza };
}
import Grafico from './Grafico';

const WELLNESS: Metrica[] = ['preparacion', 'sueno', 'fatiga', 'estres', 'dolor'];
const etiquetaDia = (f: string) => { const d = desdeIso(f); return `${DIAS_CORTOS[(d.getDay() + 6) % 7]} ${d.getDate()}`; };
const inicial = (): Periodo => ({ modo: 'semana', ...semanaDe(hoyIso()) });

function Cabecera({ periodo, setPeriodo, datos, filtro, setFiltro }: {
  periodo: Periodo; setPeriodo: (p: Periodo) => void; datos: Datos | null; filtro: string; setFiltro: (f: string) => void;
}) {
  return (
    <div className="row" style={{ gap: 10 }}>
      <SelectorPeriodo periodo={periodo} onCambio={setPeriodo} partidos={datos?.partidos ?? []} />
      <span className="spacer" />
      {datos && <FiltroGrupo datos={datos} valor={filtro} onCambio={setFiltro} />}
    </div>
  );
}

// ---------- Wellness: tarjeta por jugador, cada valor contra su propia media móvil ----------
export function PestanaWellness() {
  const [periodo, setPeriodo] = useState<Periodo>(inicial);
  const [filtro, setFiltro] = useState('');
  const { datos, error } = useDatos(periodo.desde, periodo.hasta);
  const dias = useMemo(() => diasEntre(periodo.desde, periodo.hasta), [periodo]);

  return (
    <div className="stack">
      <Cabecera periodo={periodo} setPeriodo={setPeriodo} datos={datos} filtro={filtro} setFiltro={setFiltro} />
      <Leyenda extra={<span>Cada valor se compara con la media de los últimos {VENTANA_MOVIL} días del propio jugador. Sueño: 5 = bien; fatiga, estrés y dolor: 5 = mal.</span>} />
      {!datos ? <Cargando error={error} /> : filtrar(datos, filtro).map((j) => {
        const aplica = dias.filter((f) => datos.dia(j.id, f).wAplica);
        const con = aplica.filter((f) => datos.dia(j.id, f).preparacion != null);
        const media = resumen(con.map((f) => datos.dia(j.id, f).preparacion as number));
        return (
          <section key={j.id} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 16 }}>{j.nombre}</strong>
              <span className="small muted">Preparación media {fmt(media.media, 2)} · respondió {con.length} de {aplica.length} días</span>
            </div>
            <div className="table-wrap">
              <table className="tbl" style={{ fontSize: 13 }}>
                <thead><tr><th />{dias.map((f) => <th key={f} style={{ textAlign: 'center' }}>{etiquetaDia(f)}<div className="xs muted">{etiquetaMD(f, datos.partidos) ?? ''}</div></th>)}</tr></thead>
                <tbody>
                  {WELLNESS.map((m) => (
                    <tr key={m}>
                      <th scope="row" style={{ fontWeight: m === 'preparacion' ? 700 : 500, whiteSpace: 'nowrap' }}>{NOMBRE[m]}</th>
                      {dias.map((f) => {
                        const d = datos.dia(j.id, f);
                        if (!d.wAplica && d[m] == null) return <td key={f} style={{ textAlign: 'center' }}><span className="xs muted">No aplica</span></td>;
                        const ref = refMovil(datos, j.id, f, m);
                        return <td key={f} style={{ textAlign: 'center' }}><Valor v={d[m]} tono={semaforo(d[m], ref, m)} ref={ref} d={m === 'preparacion' ? 2 : 0} chico /></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Grafico titulo="Preparación por día" max={5} decimales={1} alto={130}
              etiquetas={dias.map((f) => etiquetaMD(f, datos.partidos))}
              puntos={dias.map((f) => { const v = datos.dia(j.id, f).preparacion; return { fecha: f, valor: v, tono: semaforo(v, refMovil(datos, j.id, f, 'preparacion'), 'preparacion') }; })}
              linea={dias.map((f) => refMovil(datos, j.id, f, 'preparacion').media)} lineaNombre={`media móvil ${VENTANA_MOVIL} días`} />
          </section>
        );
      })}
    </div>
  );
}

// ---------- Sesión: un día, por jugador, contra su media del mismo tipo de día (MD) ----------
export function PestanaSesion() {
  const [fecha, setFecha] = useState(hoyIso());
  const [verRef, setVerRef] = useState(false);
  const [filtro, setFiltro] = useState('');
  const { datos, error } = useDatos(fecha, fecha);
  const { gps } = useFuentes();
  const md = datos ? etiquetaMD(fecha, datos.partidos) : null;
  const jugadores = datos ? filtrar(datos, filtro) : [];
  const prom = (m: Metrica) => resumen(jugadores.map((j) => datos!.dia(j.id, fecha)[m]).filter((v): v is number => v != null));

  return (
    <div className="stack">
      <div className="row" style={{ gap: 10 }}>
        <button type="button" className="btn btn-sm" aria-label="Día anterior" onClick={() => setFecha(iso(sumarDias(desdeIso(fecha), -1)))}>‹</button>
        <strong style={{ minWidth: 200, textAlign: 'center' }}>{fechaLarga(fecha)}{md ? ` · ${md}` : ''}</strong>
        <button type="button" className="btn btn-sm" aria-label="Día siguiente" onClick={() => setFecha(iso(sumarDias(desdeIso(fecha), 1)))}>›</button>
        {fecha !== hoyIso() && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFecha(hoyIso())}>Hoy</button>}
        <span className="spacer" />
        <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={verRef} onChange={(e) => setVerRef(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#16181D' }} />
          Ver media de referencia ({md ?? 'mismo tipo de día'})
        </label>
        {datos && <FiltroGrupo datos={datos} valor={filtro} onCambio={setFiltro} />}
      </div>
      {!datos ? <Cargando error={error} /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            {([['Preparación', prom('preparacion'), 2, 'de 1 a 5'], ...(gps ? [['Volumen', null, 0, 'sin datos del GPS'], ['Intensidad', null, 0, 'sin datos del GPS']] as const : []), ['Esfuerzo', prom('esfuerzo'), 0, 'RPE × minutos']] as const).map(([t, r, d, sub]) => (
              <div key={t} className="card" style={{ padding: 14, textAlign: 'center' }}>
                <div className="small muted">{t}</div>
                <div className="display" style={{ fontSize: 30 }}>{r ? fmt(r.media, d) : '—'}</div>
                <div className="xs muted">{r ? `media del equipo · ${r.n} jugadores` : sub}</div>
              </div>
            ))}
          </div>
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table className="tbl">
              <thead><tr><th style={{ paddingLeft: 14 }}>Jugador</th><th>Preparación</th>{gps && <><th>Volumen</th><th>Volumen/min</th><th>Intensidad</th><th>Intensidad/min</th></>}<th>Esfuerzo</th></tr></thead>
              <tbody>
                {jugadores.map((j) => {
                  const d = datos.dia(j.id, fecha);
                  const rp = refMD(datos, j.id, fecha, 'preparacion');
                  const re = refMD(datos, j.id, fecha, 'esfuerzo');
                  return (
                    <tr key={j.id} style={{ borderTop: '1px solid var(--line-soft)' }}>
                      <td style={{ paddingLeft: 14, fontWeight: 500 }}>{j.nombre}</td>
                      <td>{!d.wAplica && d.preparacion == null ? <span className="xs muted">No aplica</span> : <Valor v={d.preparacion} tono={semaforo(d.preparacion, rp, 'preparacion')} ref={rp} d={2} mostrarRef={verRef} />}</td>
                      {gps && <><td className="muted">—</td><td className="muted">—</td><td className="muted">—</td><td className="muted">—</td></>}
                      <td>{!d.rAplica && d.esfuerzo == null ? <span className="xs muted">No aplica</span> : <Valor v={d.esfuerzo} tono={semaforo(d.esfuerzo, re, 'esfuerzo')} ref={re} d={0} mostrarRef={verRef} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Leyenda extra={<span>Se compara con la media del propio jugador en días {md ?? 'del mismo tipo'} de los últimos 90 días.{gps ? ' Volumen e intensidad se completan cuando conectemos el GPS.' : ''}</span>} />
        </>
      )}
    </div>
  );
}

// ---------- Semana: carga por día y por jugador, contra las 4 semanas (periodos) anteriores ----------
export function PestanaSemana() {
  const [periodo, setPeriodo] = useState<Periodo>(inicial);
  const [filtro, setFiltro] = useState('');
  const largo = diasEntre(periodo.desde, periodo.hasta).length;
  const desdeRef = iso(sumarDias(desdeIso(periodo.desde), -largo * 4));
  const { datos, error } = useDatos(desdeRef, periodo.hasta);
  const dias = useMemo(() => diasEntre(periodo.desde, periodo.hasta), [periodo]);
  const { gps } = useFuentes();

  const totalJugador = (j: string, ds: string[]) => {
    const vals = ds.map((f) => datos!.dia(j, f).esfuerzo);
    const con = vals.filter((v): v is number => v != null);
    return { total: con.length ? con.reduce((a, b) => a + b, 0) : null, n: con.length };
  };

  return (
    <div className="stack">
      <Cabecera periodo={periodo} setPeriodo={setPeriodo} datos={datos} filtro={filtro} setFiltro={setFiltro} />
      {!datos ? <Cargando error={error} /> : (() => {
        const js = filtrar(datos, filtro);
        const porDia = (m: Metrica) => dias.map((f) => resumen(js.map((j) => datos.dia(j.id, f)[m]).filter((v): v is number => v != null)));
        const esf = porDia('esfuerzo'); const prep = porDia('preparacion');
        const mds = dias.map((f) => etiquetaMD(f, datos.partidos));
        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
              <div className="card" style={{ padding: 14 }}>
                <Grafico titulo="Esfuerzo medio por día (RPE × minutos)" etiquetas={mds}
                  puntos={dias.map((f, i) => ({ fecha: f, valor: esf[i].media, nota: `${esf[i].n} jugadores con dato` }))} />
              </div>
              <div className="card" style={{ padding: 14 }}>
                <Grafico titulo="Preparación media por día" max={5} decimales={1} etiquetas={mds}
                  puntos={dias.map((f, i) => ({ fecha: f, valor: prep[i].media, nota: `${prep[i].n} jugadores con dato` }))} />
              </div>
            </div>
            <div className="card table-wrap" style={{ padding: 0 }}>
              <table className="tbl">
                <thead><tr>
                  <th style={{ paddingLeft: 14 }}>Jugador</th><th>Esfuerzo total</th><th>Media 4 periodos anteriores</th><th>Días con esfuerzo</th><th>Preparación media</th>{gps && <><th>Volumen</th><th>Intensidad</th></>}
                </tr></thead>
                <tbody>
                  {js.map((j) => {
                    const t = totalJugador(j.id, dias);
                    const previos = [1, 2, 3, 4].map((k) => totalJugador(j.id, dias.map((f) => iso(sumarDias(desdeIso(f), -largo * k))))).filter((x) => x.total != null).map((x) => x.total as number);
                    const ref = resumen(previos);
                    const wAplica = dias.filter((f) => datos.dia(j.id, f).wAplica);
                    const wCon = wAplica.map((f) => datos.dia(j.id, f).preparacion).filter((v): v is number => v != null);
                    return (
                      <tr key={j.id} style={{ borderTop: '1px solid var(--line-soft)' }}>
                        <td style={{ paddingLeft: 14, fontWeight: 500 }}>{j.nombre}</td>
                        <td><Valor v={t.total} tono={semaforo(t.total, ref, 'esfuerzo')} ref={ref} d={0} minimo={2} /></td>
                        <td className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(ref.media, 0)}{ref.n < 4 && ref.n > 0 ? <span className="xs muted"> ({ref.n} de 4)</span> : ''}</td>
                        <td className="small">{t.n} de {largo}</td>
                        <td className="small">{fmt(resumen(wCon).media, 2)} <span className="xs muted">({wCon.length} de {wAplica.length})</span></td>
                        {gps && <><td className="muted">—</td><td className="muted">—</td></>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="xs muted" style={{ margin: 0 }}>
              El esfuerzo total suma solo los días con dato (un día sin dato no cuenta como cero). Se compara con la media de los 4 periodos anteriores del mismo largo: rojo si está más de 1 desvío por encima, azul si más de 1 por debajo.{gps ? ' Volumen e intensidad llegan cuando conectemos el GPS.' : ''}
            </p>
          </>
        );
      })()}
    </div>
  );
}

// ---------- Perfil: un jugador, tendencia de 90 días con media móvil de 28 ----------
export function PestanaPerfil() {
  const hoy = hoyIso();
  const desde = iso(sumarDias(desdeIso(hoy), -89));
  const { datos, error } = useDatos(desde, hoy);
  const [jugador, setJugador] = useState('');
  const dias = useMemo(() => diasEntre(desde, hoy), [desde, hoy]);
  const j = jugador || datos?.jugadores[0]?.id || '';
  const { fuerza } = useFuentes();

  const movil = (m: Metrica) => dias.map((f) => {
    const xs: number[] = [];
    for (let i = 0; i < VENTANA_MOVIL; i++) { const v = datos!.dia(j, iso(sumarDias(desdeIso(f), -i)))[m]; if (v != null) xs.push(v); }
    return resumen(xs).media;
  });

  return (
    <div className="stack">
      <div className="row" style={{ gap: 10 }}>
        {datos && (
          <label><span className="sr-only">Jugador</span>
            <select className="select" style={{ height: 40, width: 260 }} value={j} onChange={(e) => setJugador(e.target.value)}>
              {datos.jugadores.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
          </label>
        )}
        <span className="small muted">Últimos 90 días · línea: media móvil de {VENTANA_MOVIL} días</span>
      </div>
      {!datos ? <Cargando error={error} /> : !j ? <p className="muted">Todavía no hay jugadores.</p> : (
        <>
          <div className="card" style={{ padding: 14 }}>
            <Grafico titulo="Preparación" max={5} decimales={1}
              puntos={dias.map((f) => { const v = datos.dia(j, f).preparacion; return { fecha: f, valor: v, tono: semaforo(v, refMovil(datos, j, f, 'preparacion'), 'preparacion') }; })}
              linea={movil('preparacion')} lineaNombre={`media móvil ${VENTANA_MOVIL} días`} />
          </div>
          <div className="card" style={{ padding: 14 }}>
            <Grafico titulo="Esfuerzo (RPE × minutos)"
              puntos={dias.map((f) => ({ fecha: f, valor: datos.dia(j, f).esfuerzo }))}
              linea={movil('esfuerzo')} lineaNombre={`media móvil ${VENTANA_MOVIL} días`} />
          </div>
          {fuerza && <div className="card" style={{ padding: 16 }}>
            <strong>Tests</strong>
            <p className="small muted" style={{ margin: '6px 0 0' }}>Peso, altura de salto, 10 m y asimetría (cambio de dirección) se cargan cuando conectemos la plataforma de fuerza. Cada test se va a comparar con el anterior y con el mejor del jugador, marcando solo los cambios mayores que el cambio mínimo relevante.</p>
          </div>}
        </>
      )}
    </div>
  );
}
