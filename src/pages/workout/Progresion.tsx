import { useEffect, useMemo, useState } from 'react';
import { supabase, mensajeError } from '../../lib/supabase';
import { DIAS_CORTOS, desdeIso, diaSemana, iso, sumarDias } from '../../lib/calendario';
import { claveDestinos, itemDesdeDb, nuevoId, progresaBloque, type Destino, type Ejercicio, type Item, type Serie } from '../../lib/workout';
import { destinosDe, efectivo, llave, marcarModificados, materializar, type Ctx, type Mapa } from '../../lib/planes';
import { FICHA_VACIA, aplicar, aprendido, prescritas, proponer, salto, textoDosis, type Antecedente, type Decision, type Ficha } from '../../lib/progresion';
import Dialogo from '../../components/Dialogo';

const kg = (n: number) => String(n).replace('.', ',');
const leerNum = (t: string) => { const n = Number(t.replace(',', '.')); return Number.isFinite(n) && n > 0 && n <= 50 ? n : null; };
const fechaCorta = (f: string) => { const d = desdeIso(f); return `${DIAS_CORTOS[diaSemana(d)]} ${d.getDate()}/${d.getMonth() + 1}`; };

export async function cargarFicha(perfilId: string): Promise<Ficha> {
  const { data, error } = await supabase.from('fichas_cliente').select('*').eq('perfil_id', perfilId).maybeSingle();
  if (error) throw new Error(/fichas_cliente/.test(error.message) ? 'Falta correr el SQL 022 en Supabase.' : mensajeError(error));
  if (!data) return { ...FICHA_VACIA };
  const d = data as Record<string, unknown>;
  return { ...FICHA_VACIA, ...d, salto_barra: Number(d.salto_barra), salto_mancuerna: Number(d.salto_mancuerna), salto_maquina: Number(d.salto_maquina) } as Ficha;
}

const OBJ: [string, string][] = [['salud', 'Salud'], ['futbol', 'Fútbol'], ['rugby', 'Rugby'], ['basquet', 'Básquet'], ['mantenimiento', 'Mantenimiento']];

// ---------- Ficha del cliente ----------
export function DialogoFicha({ perfilId, nombre, onCerrar }: { perfilId: string; nombre: string; onCerrar: (cambio?: boolean) => void }) {
  const [f, setF] = useState<Ficha | null>(null);
  const [saltos, setSaltos] = useState({ barra: '5', mancuerna: '2,5', maquina: '5' });
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    cargarFicha(perfilId).then((x) => { setF(x); setSaltos({ barra: kg(x.salto_barra), mancuerna: kg(x.salto_mancuerna), maquina: kg(x.salto_maquina) }); })
      .catch((e: Error) => { setError(e.message); setF({ ...FICHA_VACIA }); });
  }, [perfilId]);

  async function guardar() {
    if (!f) return;
    const b = leerNum(saltos.barra), m = leerNum(saltos.mancuerna), q = leerNum(saltos.maquina);
    if (b == null || m == null || q == null) { setError('Los saltos de carga tienen que ser números mayores que 0 (por ejemplo, 2,5).'); return; }
    setOcupado(true); setError('');
    const { error } = await supabase.rpc('guardar_ficha', { p_perfil: perfilId, p_datos: {
      objetivo: f.objetivo ?? '', deporte: f.deporte ?? '', dias_semana: f.dias_semana ?? '', lesiones: f.lesiones ?? '', nivel: f.nivel ?? '',
      descansos: f.descansos, salto_barra: b, salto_mancuerna: m, salto_maquina: q, notas: f.notas ?? '',
    } });
    setOcupado(false);
    if (error) { setError(mensajeError(error)); return; }
    onCerrar(true);
  }

  return (
    <Dialogo titulo={`Ficha · ${nombre}`} onCerrar={() => onCerrar()} ancho={540}
      pie={<>
        <button type="button" className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={!f || ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
      </>}>
      {!f ? <p className="muted">Cargando…</p> : (
        <div className="stack" style={{ gap: 14 }}>
          <div className="field"><span>Objetivo</span>
            <div className="row" role="group" aria-label="Objetivo" style={{ gap: 6 }}>
              {OBJ.map(([k, t]) => <button key={k} type="button" className="chip" aria-pressed={f.objetivo === k} onClick={() => setF({ ...f, objetivo: f.objetivo === k ? null : k })}>{t}</button>)}
            </div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <label className="field" style={{ flex: 2, minWidth: 160 }}><span>Deporte / actividad</span>
              <input className="input" maxLength={60} value={f.deporte ?? ''} placeholder="Ej.: fútbol amateur, pádel" onChange={(e) => setF({ ...f, deporte: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 120 }}><span>Días por semana</span>
              <select className="select" value={f.dias_semana ?? ''} onChange={(e) => setF({ ...f, dias_semana: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <div className="field"><span>Nivel de partida</span>
            <div className="row" role="group" aria-label="Nivel" style={{ gap: 6 }}>
              {([[1, 'Inicial'], [2, 'Intermedio'], [3, 'Avanzado']] as const).map(([k, t]) => <button key={k} type="button" className="chip" aria-pressed={f.nivel === k} onClick={() => setF({ ...f, nivel: f.nivel === k ? null : k })}>{t}</button>)}
            </div>
          </div>
          <label className="field"><span>Lesiones u operaciones</span>
            <textarea className="input" rows={2} maxLength={1000} value={f.lesiones ?? ''} placeholder="Ej.: desgarro de cuádriceps derecho (oct 2026)" onChange={(e) => setF({ ...f, lesiones: e.target.value })} />
          </label>
          <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.descansos} onChange={(e) => setF({ ...f, descansos: e.target.checked })} style={{ width: 20, height: 20, accentColor: '#16181D' }} />
            <span className="small">Lleva tiempos de descanso</span>
          </label>
          <div className="field"><span>Salto mínimo de carga (el material del lugar)</span>
            <div className="row" style={{ gap: 10 }}>
              {([['barra', 'Barra (total)'], ['mancuerna', 'Mancuerna / Kb (c/u)'], ['maquina', 'Máquina / otro']] as const).map(([k, t]) => (
                <label key={k} className="field" style={{ flex: 1, minWidth: 110 }}><span className="xs">{t}</span>
                  <input className="input" inputMode="decimal" value={saltos[k]} onChange={(e) => setSaltos({ ...saltos, [k]: e.target.value })} />
                </label>
              ))}
            </div>
          </div>
          <label className="field"><span>Notas</span>
            <textarea className="input" rows={2} maxLength={2000} value={f.notas ?? ''} onChange={(e) => setF({ ...f, notas: e.target.value })} />
          </label>
          {error && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p>}
        </div>
      )}
    </Dialogo>
  );
}

// ---------- Proponer semana siguiente ----------
type Registro = { item_id: string; fecha: string; nombre: string; ejercicio_id: string | null; hecho: Serie[] | null; rpe: number | null; completado_en: string | null };
type Fila = {
  key: string; fecha: string; item: Item; reg: Registro | null; propuesta: Decision; motivo: string; paso: number;
};

export function DialogoProgresion({ perfilId, nombre, lunes, biblioteca, ctx, onCerrar, onAplicado }: {
  perfilId: string; nombre: string; lunes: string; biblioteca: Ejercicio[]; ctx: Ctx;
  onCerrar: () => void; onAplicado: (msg: string, lunesSiguiente: string) => void;
}) {
  const clave = `persona:${perfilId}`;
  const siguiente = iso(sumarDias(desdeIso(lunes), 7));
  const [datos, setDatos] = useState<{ m: Mapa; filas: Fila[]; ficha: Ficha; aprendidos: [number, Decision][]; fijos: number } | null>(null);
  const [elegida, setElegida] = useState<Record<string, Decision>>({});
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [verFicha, setVerFicha] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const porId = useMemo(() => new Map(biblioteca.map((e) => [e.id, e])), [biblioteca]);

  useEffect(() => {
    (async () => {
      setDatos(null); setError('');
      const hasta = iso(sumarDias(desdeIso(lunes), 13)); const finSemana = iso(sumarDias(desdeIso(lunes), 6));
      const [ses, regs, dec] = await Promise.all([
        supabase.from('sesiones')
          .select('id,fecha,destinos,sesion_items(id,orden,tipo,bloque,ejercicio_id,nombre,series,reps,cada_lado,con_carga,detalle,descanso_seg,nota,origen_id,modificado,config,eliminado_en)')
          .gte('fecha', lunes).lte('fecha', hasta),
        supabase.from('sesion_registros').select('item_id,fecha,nombre,ejercicio_id,hecho,rpe,completado_en').eq('perfil_id', perfilId).gte('fecha', lunes).lte('fecha', finSemana),
        supabase.from('decisiones_progresion').select('rpe,propuesta,elegida').eq('perfil_id', perfilId).order('creado_en', { ascending: false }).limit(300),
      ]);
      let ficha: Ficha;
      try { ficha = await cargarFicha(perfilId); } catch (e) { setError((e as Error).message); return; }
      if (ses.error || regs.error) { setError(mensajeError(ses.error ?? regs.error!)); return; }
      const m: Mapa = {};
      for (const r of (ses.data ?? []) as Record<string, unknown>[]) {
        const ds = r.destinos as Destino[];
        if (!Array.isArray(ds) || ds.length !== 1) continue;
        m[llave(claveDestinos(ds), r.fecha as string)] = ((r.sesion_items as Record<string, unknown>[]) ?? [])
          .filter((i) => !i.eliminado_en).sort((a, b) => Number(a.orden) - Number(b.orden)).map(itemDesdeDb);
      }
      const registros = (regs.data ?? []) as Registro[];
      const ap = aprendido((dec.data ?? []) as Antecedente[]);
      const filas: Fila[] = [];
      let fijos = 0;
      for (let i = 0; i < 7; i++) {
        const f = iso(sumarDias(desdeIso(lunes), i));
        let bloque: Item | null = null;
        for (const it of efectivo(clave, f, m, ctx).items) {
          if (it.tipo === 'break') { bloque = it; continue; }
          if (it.tipo !== 'ejercicio') continue;
          if (!progresaBloque(bloque)) { fijos++; continue; } // entrada en calor: se copia igual
          const reg = registros.find((r) => r.item_id === it.id)
            ?? registros.find((r) => r.fecha === f && (it.ejercicio_id ? r.ejercicio_id === it.ejercicio_id : r.nombre === it.nombre)) ?? null;
          const p = proponer(reg?.rpe, !!reg, ap);
          filas.push({ key: `${f}|${it.id}`, fecha: f, item: it, reg, propuesta: p.decision, motivo: p.motivo, paso: salto(it.ejercicio_id ? porId.get(it.ejercicio_id) : undefined, it.nombre, ficha).kg });
        }
      }
      setElegida(Object.fromEntries(filas.map((x) => [x.key, x.propuesta])));
      setDatos({ m, filas, ficha, aprendidos: [...ap].map(([r, a]) => [r, a.decision]), fijos });
    })();
  }, [perfilId, lunes, ctx, clave, porId, recarga]);

  async function aplicarTodo() {
    if (!datos) return;
    setOcupado(true); setError('');
    const m: Mapa = { ...datos.m };
    const antes: Mapa = { ...datos.m };
    const fechas = [...new Set(datos.filas.map((x) => x.fecha))];
    for (const f of fechas) {
      const destino = iso(sumarDias(desdeIso(f), 7));
      const k = llave(clave, destino);
      const deEsteDia = datos.filas.filter((x) => x.fecha === f);
      let viejo = materializar(clave, destino, m, ctx);
      if (!viejo.length) {
        // La semana siguiente está vacía: se copia este día entero (títulos y notas incluidos).
        viejo = efectivo(clave, f, datos.m, ctx).items.map((it) => ({ ...it, id: nuevoId(), origen_id: null, modificado: false, detalle: it.detalle.map((s) => ({ ...s })), config: { ...(it.config ?? {}) } }));
        m[k] = viejo;
      }
      const usadas = new Set<string>();
      const nuevo = viejo.map((it) => {
        if (it.tipo !== 'ejercicio') return it;
        const fila = deEsteDia.find((x) => !usadas.has(x.key) && (it.ejercicio_id ? x.item.ejercicio_id === it.ejercicio_id : x.item.nombre === it.nombre));
        if (!fila) return it;
        usadas.add(fila.key);
        const r = aplicar(fila.item, fila.reg?.hecho, elegida[fila.key] ?? fila.propuesta, fila.paso);
        return { ...it, series: r.detalle.length, reps: r.detalle[0]?.reps ?? it.reps, detalle: r.detalle };
      });
      m[k] = marcarModificados(clave, viejo, nuevo);
    }
    const cambios = Object.keys(m).filter((k) => m[k] !== antes[k]).map((k) => {
      const [c, fecha] = k.split('|');
      return { fecha, destinos: destinosDe(c), items: m[k].map((it) => ({ ...it, reps: it.reps || null, nota: it.nota || null })) };
    });
    const { error } = await supabase.rpc('guardar_dias', { p_cambios: cambios });
    if (error) { setOcupado(false); setError(mensajeError(error)); return; }
    const decisiones = datos.filas.filter((x) => x.reg).map((x) => ({ fecha: iso(sumarDias(desdeIso(x.fecha), 7)), ejercicio: x.item.nombre, rpe: x.reg?.rpe ?? '', propuesta: x.propuesta, elegida: elegida[x.key] ?? x.propuesta }));
    if (decisiones.length) await supabase.rpc('registrar_decisiones', { p_perfil: perfilId, p_decisiones: decisiones });
    setOcupado(false);
    const suben = datos.filas.filter((x) => (elegida[x.key] ?? x.propuesta) === 'subir').length;
    onAplicado(`Semana del ${fechaCorta(siguiente)} lista para ${nombre}: ${suben} ejercicio${suben === 1 ? '' : 's'} suben, el resto se mantiene.`, siguiente);
  }

  const sinRegistro = datos ? datos.filas.filter((x) => !x.reg).length : 0;
  return (
    <>
      <Dialogo titulo={`Proponer semana siguiente · ${nombre}`} onCerrar={onCerrar} ancho={720}
        pie={<>
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={!datos || !datos.filas.length || ocupado} onClick={aplicarTodo}>
            {ocupado ? 'Aplicando…' : `Aplicar a la semana del ${fechaCorta(siguiente)}`}
          </button>
        </>}>
        {error ? <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{error}</p> : !datos ? <p className="muted">Cargando…</p> : (
          <div className="stack" style={{ gap: 12 }}>
            <p className="small muted" style={{ margin: 0 }}>
              Parte de lo que {nombre} cargó esta semana y de su RPE: con 1–5 sube lo mínimo, con 6–8 mantiene, con 9–10 mantiene. Tocá otra opción para corregir; la app aprende de tus correcciones.
            </p>
            <div className="row xs" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="muted">Saltos: barra +{kg(datos.ficha.salto_barra)} · mancuerna +{kg(datos.ficha.salto_mancuerna)} · otro +{kg(datos.ficha.salto_maquina)} kg</span>
              <button type="button" className="btn btn-sm btn-ghost" style={{ height: 26 }} onClick={() => setVerFicha(true)}>Editar ficha</button>
            </div>
            {datos.aprendidos.length > 0 && (
              <p className="xs" style={{ margin: 0, background: '#EEF3FF', color: '#1E3A8A', borderRadius: 8, padding: '6px 10px' }}>
                Aprendido de tus correcciones: {datos.aprendidos.map(([r, d]) => `con RPE ${r}, ${d}`).join(' · ')}.
              </p>
            )}
            {!datos.filas.length ? <p className="notice" style={{ margin: 0 }}>Esta semana no tiene ejercicios en su plan.</p> : (
              <div className="prog-tabla" role="table" aria-label="Propuesta por ejercicio">
                {datos.filas.map((x, i) => {
                  const d = elegida[x.key] ?? x.propuesta;
                  const seg = x.item.config?.unidad === 'seg';
                  const r = aplicar(x.item, x.reg?.hecho, d, x.paso);
                  const nuevoDia = i === 0 || datos.filas[i - 1].fecha !== x.fecha;
                  return (
                    <div key={x.key} role="row" className="prog-fila" style={{ borderTop: nuevoDia && i ? '2px solid var(--line, #DDD9D0)' : undefined }}>
                      <div role="cell" style={{ minWidth: 0 }}>
                        <span className="xs muted">{nuevoDia ? fechaCorta(x.fecha) : ''}</span>
                        <strong style={{ display: 'block', overflowWrap: 'anywhere', fontSize: 14 }}>{x.item.nombre}</strong>
                        <span className="xs muted">
                          Hizo {x.reg?.hecho ? textoDosis(x.reg.hecho.map((s, j) => ({ reps: s.reps || prescritas(x.item)[j]?.reps || '', kg: s.kg })), seg) : '—'}
                          {' · '}<span style={{ fontWeight: 700, color: x.reg?.rpe == null ? undefined : x.reg.rpe <= 5 ? '#1E9E4A' : x.reg.rpe >= 9 ? '#B3122E' : '#6B4E00' }}>{x.motivo}</span>
                        </span>
                      </div>
                      <div role="cell" className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        {(['subir', 'mantener', 'bajar'] as Decision[]).map((o) => (
                          <button key={o} type="button" className="chip" aria-pressed={d === o} style={{ height: 30, padding: '0 10px' }}
                            onClick={() => setElegida({ ...elegida, [x.key]: o })}>{o === 'subir' ? '↑ Subir' : o === 'bajar' ? '↓ Bajar' : '= Igual'}</button>
                        ))}
                      </div>
                      <div role="cell" style={{ textAlign: 'right' }}>
                        <strong style={{ display: 'block', fontSize: 14 }}>{textoDosis(r.detalle, seg)}</strong>
                        <span className="xs" style={{ color: d === 'subir' ? '#1E9E4A' : d === 'bajar' ? '#B3122E' : 'var(--muted)' }}>{r.nota || 'igual'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {datos.fijos > 0 && <p className="xs muted" style={{ margin: 0 }}>{datos.fijos} ejercicio{datos.fijos === 1 ? '' : 's'} de bloques que no progresan (entrada en calor) se copian igual. Se cambia con la casilla «Progresa» de cada session break.</p>}
            {sinRegistro > 0 && <p className="xs muted" style={{ margin: 0 }}>{sinRegistro} ejercicio{sinRegistro === 1 ? '' : 's'} sin registro: se mantienen con lo que estaba escrito.</p>}
            <p className="xs muted" style={{ margin: 0 }}>Si la semana siguiente está vacía, se copia esta semana con la nueva dosis. Si ya tiene plan, solo cambian series, reps y kilos de los ejercicios que coinciden.</p>
          </div>
        )}
      </Dialogo>
      {verFicha && <DialogoFicha perfilId={perfilId} nombre={nombre} onCerrar={(c) => { setVerFicha(false); if (c) setRecarga((n) => n + 1); }} />}
    </>
  );
}
