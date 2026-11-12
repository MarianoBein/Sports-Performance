# Ataques: cada intento corre en una transacción que se deshace al final.
import json, sys, uuid, psycopg2

DB = dict(host='localhost', port=5433, user='postgres', dbname=sys.argv[1] if len(sys.argv) > 1 else 'espejo2')
F = json.load(open(sys.argv[2] if len(sys.argv) > 2 else 'fixtures.json'))
U, PERF, A, B = F['U'], F['perf'], F['clubA'], F['clubB']
DA, DB_ = F['datos'][A], F['datos'][B]
cx = psycopg2.connect(**DB)
CLUB = {'adminA': A, 'jugA': A, 'jugA2': A, 'utileroA': A, 'pfA': A, 'adminB': B, 'jugB': B}
problemas = []

def correr(quien, sql, args=None, verif=None):
    """Devuelve (ok, resultado_o_error, verif)."""
    c = cx.cursor()
    try:
        c.execute('begin')
        rol = 'anon' if quien == 'anon' else 'authenticated'
        c.execute("select set_config('test.uid', %s, true)", ('' if quien == 'anon' else U[quien],))
        c.execute(f'set local role {rol}')
        try:
            c.execute(sql, args)
            res = c.fetchall() if c.description else f'filas={c.rowcount}'
            ok = True
        except Exception as e:
            res = str(e).split('\n')[0]; ok = False
            c.execute('rollback'); c.execute('begin')
        v = None
        if verif:
            c.execute('reset role'); c.execute(verif); v = c.fetchall()
        return ok, res, v
    finally:
        c.execute('rollback'); c.close()

def debe_fallar(quien, desc, sql, args=None, verif=None, cambio=None):
    ok, res, v = correr(quien, sql, args, verif)
    hubo_cambio = cambio(v) if (cambio and v is not None) else False
    if ok and res == 'filas=0' and not hubo_cambio:
        ok = False
    if ok and (cambio is None or hubo_cambio):
        problemas.append(f'[{quien}] {desc}: SE PUDO → {str(res)[:160]} {v if v else ""}')
        print(f'  ✗ {quien:9} {desc}: SE PUDO → {str(res)[:120]}')
    else:
        print(f'  ✓ {quien:9} {desc}: bloqueado ({str(res)[:70]})')

def debe_vacio(quien, desc, sql, args=None):
    ok, res, _ = correr(quien, sql, args)
    vacio = (not ok) or res in ([], [(None,)], [(False,)], [(0,)]) or (isinstance(res, list) and all(all(x in (None, False, 0, '[]', []) for x in fila) for fila in res))
    if vacio: print(f'  ✓ {quien:9} {desc}: nada ({str(res)[:70]})')
    else:
        problemas.append(f'[{quien}] {desc}: DEVUELVE → {str(res)[:200]}')
        print(f'  ✗ {quien:9} {desc}: DEVUELVE → {str(res)[:120]}')

# ---------- 1. Lectura directa de tablas ----------
print('\n== 1. Leer tablas directamente (como haría alguien con la clave pública)')
tablas = [r[0] for r in psycopg2.connect(**DB).cursor().__class__.__dict__ and []]
c0 = psycopg2.connect(**DB); k0 = c0.cursor()
k0.execute("select c.relname, exists(select 1 from information_schema.columns where table_schema='public' and table_name=c.relname and column_name='club_id') from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' order by 1")
tablas = k0.fetchall()
k0.execute("select id from roles where club_id = %s and clave = 'pf'", (A,)); ROL_PF_A = k0.fetchone()[0]
k0.execute("select id from ejercicios where club_id = %s limit 1", (A,)); EJ_A = k0.fetchone()[0]
k0.execute("select id from actividad_adjuntos where club_id = %s limit 1", (A,)); ADJ_A = k0.fetchone()[0]
k0.execute("select id from sesiones where club_id = %s limit 1", (A,)); SES_A = k0.fetchone()[0]
SENSIBLES = {'wellness', 'rpe', 'sesion_registros', 'fichas_cliente', 'decisiones_progresion', 'minutos_jugador'}
for quien in ['anon', 'nadie', 'jugA', 'utileroA', 'adminB', 'jugB']:
    for t, tiene_club in tablas:
        mio = CLUB.get(quien)
        ok, res, _ = correr(quien, f'select count(*) {", count(*) filter (where club_id is distinct from %s)" if tiene_club else ""} from public.{t}', (mio,) if tiene_club else None)
        if not ok:
            continue  # error = no puede leer
        total = res[0][0]; ajenas = res[0][1] if tiene_club else 0
        if ajenas:
            problemas.append(f'[{quien}] lee {ajenas} filas de OTRO club en {t}')
            print(f'  ✗ {quien:9} {t}: {ajenas} filas de otro club')
        elif quien in ('anon', 'nadie') and total:
            problemas.append(f'[{quien}] lee {total} filas de {t} sin ser de ningún club')
            print(f'  ✗ {quien:9} {t}: {total} filas sin ser de ningún club')
    print(f'  ✓ {quien:9} sin filas de otros clubes en ninguna tabla' if not any(p.startswith(f'[{quien}] lee') for p in problemas) else '')

print('\n== 1b. Dentro del mismo club: lo que no le corresponde')
debe_vacio('jugA', 'wellness de otro jugador', 'select * from wellness where perfil_id <> %s', (PERF['jugA'],))
debe_vacio('jugA', 'rpe de otro jugador', 'select * from rpe where perfil_id <> %s', (PERF['jugA'],))
debe_vacio('jugA', 'registros de otro jugador', 'select * from sesion_registros where perfil_id <> %s', (PERF['jugA'],))
debe_vacio('jugA', 'fichas (lesiones)', 'select lesiones from fichas_cliente')
debe_vacio('jugA', 'programas', 'select nombre from programas')
debe_vacio('jugA', 'códigos de alta', 'select codigo from codigos_alta')
debe_vacio('jugA', 'registro de cambios', 'select accion from registro_cambios')
debe_vacio('jugA', 'sesiones de otro jugador', "select destinos_clave from sesiones where destinos_clave like 'persona:%%' and destinos_clave <> %s", ('persona:' + PERF['jugA'],))
debe_vacio('jugA', 'tokens de calendario ajenos', 'select token from calendario_tokens where perfil_id <> %s', (PERF['jugA'],))
debe_vacio('jugA', 'suscripciones push ajenas', 'select endpoint from push_suscripciones where perfil_id <> %s', (PERF['jugA'],))
debe_vacio('jugA', 'notas privadas del dueño en clubs', "select notas_dueno from clubs where notas_dueno is not null")
debe_vacio('jugA', 'notas privadas del dueño (tabla nueva)', "select notas from notas_plataforma")
debe_vacio('adminA', 'notas privadas del dueño (admin del club)', "select notas from notas_plataforma")
debe_vacio('jugA', 'emails vía función (jugador)', "select email from emails_del_club()")
debe_vacio('jugA', 'emails de compañeros y staff', "select email from perfiles where id <> %s", (PERF['jugA'],))
debe_vacio('utileroA', 'wellness (sin permiso de Sports Science)', 'select * from wellness')
debe_vacio('utileroA', 'sesiones (sin permiso de Workout Builder)', 'select * from sesiones')
debe_vacio('utileroA', 'ejercicios (sin permiso de Workout Builder)', 'select * from ejercicios')
debe_vacio('jugA2', 'actividad de prensa de otro', 'select nombre from actividades where id = %s', (DA['prensa'],))

# ---------- 2. Escritura directa en tablas ----------
print('\n== 2. Escribir tablas directamente (sin pasar por las funciones)')
for quien in ['anon', 'nadie', 'jugA', 'adminA', 'adminB']:
    debe_fallar(quien, 'hacerse admin (update perfiles)', 'update perfiles set es_admin = true', verif='select count(*) from perfiles where es_admin', cambio=lambda v: v[0][0] > 3)
    debe_fallar(quien, 'insertar wellness ajeno', "insert into wellness (club_id, perfil_id, fecha, sueno, fatiga, estres, dolor) values (%s, %s, current_date - 3, 1,1,1,1)", (A, PERF['jugA2']))
    debe_fallar(quien, 'borrar wellness', 'delete from wellness', verif='select count(*) from wellness', cambio=lambda v: v[0][0] < 2)
    debe_fallar(quien, 'insertar perfil admin en club A (values)', "insert into perfiles (id, user_id, club_id, nombre, email, rol_id, es_admin) values (%s, %s, %s, 'X', 'x@x', %s, true)", (str(uuid.uuid4()), U['nadie'], A, ROL_PF_A))
    debe_fallar(quien, 'crear código directo (values)', "insert into codigos_alta (club_id, codigo, rol_id, da_admin, caduca_en) values (%s, 'HACK-2', %s, true, now() + interval '1 day')", (A, ROL_PF_A))
    debe_fallar(quien, 'insertar perfil en club A', "insert into perfiles (id, user_id, club_id, nombre, email, rol_id, es_admin) select %s, %s, %s, 'X', 'x@x', id, true from roles where club_id = %s limit 1", (str(uuid.uuid4()), U['nadie'], A, A))
    debe_fallar(quien, 'cambiar estado del club', "update clubs set estado = 'activa', plan = 'pago'", verif="select count(*) from clubs where plan = 'pago'", cambio=lambda v: v[0][0] > 0)
    debe_fallar(quien, 'crear código de alta directo', "insert into codigos_alta (club_id, codigo, rol_id, da_admin, caduca_en) select %s, 'HACK-1', id, true, now() + interval '1 day' from roles where club_id = %s limit 1", (A, A))
    debe_fallar(quien, 'activar perfil ajeno (perfil_activo)', 'insert into perfil_activo (user_id, perfil_id) values (%s, %s)', (U.get(quien, U['nadie']), PERF['adminA']))
    debe_fallar(quien, 'agregarse como dueño de la plataforma', "insert into duenos_plataforma (email, user_id) values ('x@x', %s)", (U.get(quien, U['nadie']),))
    debe_fallar(quien, 'borrar el registro de cambios', 'delete from registro_cambios', verif='select count(*) from registro_cambios', cambio=lambda v: v[0][0] == 0)
    debe_fallar(quien, 'leer ejercicios_base', 'select count(*) from ejercicios_base')

# ---------- 3. Funciones contra otro club ----------
print('\n== 3. Usar las funciones contra datos de OTRO club (atacante: admin de Fénix, con todos los permisos en su club)')
a = 'adminB'
debe_fallar(a, 'corregir wellness de un jugador de A', 'select corregir_wellness(%s, current_date, 1,1,1,1, null)', (PERF['jugA'],))
debe_fallar(a, 'corregir RPE de un jugador de A', 'select corregir_rpe(%s, current_date, 1, null)', (PERF['jugA'],))
debe_fallar(a, 'ver entreno de un jugador de A', 'select entreno_del_dia(%s::date, %s)', (DA['hoy'], PERF['jugA']))
debe_fallar(a, 'historial de un jugador de A', 'select * from historial_ejercicio(%s, null, %s)', (PERF['jugA'], 'Sentadilla'))
debe_fallar(a, 'escribir ficha de un jugador de A', "select guardar_ficha(%s, '{}'::jsonb)", (PERF['jugA'],))
debe_fallar(a, 'registrar decisiones de un jugador de A', "select registrar_decisiones(%s, '[]'::jsonb)", (PERF['jugA'],))
debe_fallar(a, 'cargar minutos a un jugador de A', 'select guardar_minutos(current_date, 10, %s)', (PERF['jugA'],))
debe_fallar(a, 'marcar excepción a un jugador de A', "select marcar_aplica(current_date, 'rpe', false, %s)", (PERF['jugA'],))
debe_fallar(a, 'restablecer contraseña de alguien de A', 'select preparar_clave_temporal(%s)', (PERF['adminA'],))
debe_fallar(a, 'cambiar rol/permisos de alguien de A', "select actualizar_miembro(%s, (select rol_id from perfiles where id = %s), true, null, null)", (PERF['jugA'], PERF['jugA']))
debe_fallar(a, 'eliminar a alguien de A', 'select eliminar_miembro(%s)', (PERF['jugA'],))
debe_fallar(a, 'entrar como perfil de A (cambiar_organizacion)', 'select cambiar_organizacion(%s)', (PERF['adminA'],))
debe_fallar(a, 'borrar actividad de A', 'select eliminar_actividad(%s)', (DA['act'],))
debe_fallar(a, 'editar actividad de A', "select guardar_actividad(%s, '{\"nombre\":\"x\",\"tipo\":\"deportiva\",\"fecha\":\"2026-11-02\",\"hora_inicio\":\"10:00\"}'::jsonb, '[]'::jsonb)", (DA['act'],))
debe_fallar(a, 'recuperar actividad de A', 'select restaurar_actividad(%s)', (DA['act'],))
debe_fallar(a, 'borrar adjunto de A', 'select borrar_adjunto(%s)', (ADJ_A,))
debe_fallar(a, 'adjuntar archivo a actividad de A', "select registrar_adjunto(%s, %s, 'x.pdf', 'application/pdf', 1)", (DA['act'], f"{B}/{DA['act']}/x.pdf"))
debe_fallar(a, 'robar ejercicio de un plan de A (guardar_dias con su id)', 'select guardar_dias(%s::jsonb)', (json.dumps([{'fecha': DB_['hoy'], 'destinos': [{'tipo': 'equipo'}], 'items': [{'id': DA['item'], 'tipo': 'ejercicio', 'nombre': 'HACK', 'series': 1, 'reps': '1'}]}]),),
            verif=f"select nombre from sesion_items where id = '{DA['item']}'", cambio=lambda v: v[0][0] != 'Sentadilla')
debe_fallar(a, 'plan con un jugador de A como destino', 'select guardar_dias(%s::jsonb)', (json.dumps([{'fecha': DB_['hoy'], 'destinos': [{'tipo': 'persona', 'ref': PERF['jugA']}], 'items': []}]),))
debe_fallar(a, 'plan con un grupo de A como destino', 'select guardar_dias(%s::jsonb)', (json.dumps([{'fecha': DB_['hoy'], 'destinos': [{'tipo': 'grupo', 'ref': DA['grupo']}], 'items': []}]),))
debe_fallar(a, 'editar programa de A', "select guardar_programa(%s, 'x', null, 1, '{}'::jsonb)", (DA['prog'],))
debe_fallar(a, 'borrar programa de A', 'select eliminar_programa(%s)', (DA['prog'],))
debe_fallar(a, 'editar ejercicio de la biblioteca de A', "select guardar_ejercicio(%s, '{\"nombre\":\"HACK\"}'::jsonb)", (EJ_A,))
debe_fallar(a, 'borrar ejercicio de la biblioteca de A', 'select eliminar_ejercicio(%s)', (EJ_A,))
debe_fallar(a, 'crear código con un rol de A', 'select * from crear_codigo(%s)', (ROL_PF_A,))
debe_fallar(a, 'responder una prensa de A', "select responder_actividad(%s, 'acepta')", (DA['prensa'],))
debe_fallar(a, 'asignación de programa de A', "select registrar_asignacion_programa(%s, 'x', current_date)", (DA['prog'],))
debe_fallar(a, 'ver organizaciones (solo dueño)', 'select * from plataforma_organizaciones()')
debe_fallar(a, 'cambiar plan/estado de A (solo dueño)', "select plataforma_actualizar_organizacion(%s, 'pago', 'baja', 'x')", (A,))
debe_fallar(a, 'código de admin para A (solo dueño)', 'select plataforma_nuevo_codigo_admin(%s)', (A,))
debe_fallar(a, 'crear organización (solo dueño)', "select * from plataforma_crear_organizacion('X', 'club', 'prueba', null, 'principal')")
debe_vacio(a, 'personas de una actividad de A', 'select * from personas_de_actividad(%s)', (DA['prensa'],))
debe_vacio(a, 'personas de una sesión de A', "select * from personas_de_sesion(%s)", (SES_A,))
debe_vacio(a, 'nivel de permisos de alguien de A', "select nivel_de(%s, 'sports_science') = 'editar'", (PERF['pfA'],))
debe_vacio(a, '¿alguien de A ve una actividad?', 'select ve_actividad(%s, %s)', (PERF['jugA'], DA['prensa']))
debe_vacio('anon', 'excepción de cuestionario de alguien de A', "select aplica_cuestionario(%s, current_date, 'rpe') is not null", (PERF['jugA'],))

# ---------- 4. Escalar dentro del propio club ----------
print('\n== 4. Subir de permisos dentro del propio club (jugador y utilero)')
for a in ['jugA', 'utileroA']:
    debe_fallar(a, 'hacerse admin (actualizar_miembro)', "select actualizar_miembro(%s, (select rol_id from perfiles where id = %s), true, null, null)", (PERF[a], PERF[a]))
    debe_fallar(a, 'crear rol', "select crear_rol('X', '{}'::jsonb, false)")
    debe_fallar(a, 'crear código de admin/staff', 'select * from crear_codigo((select id from roles where club_id = %s and clave = %s))', (A, 'pf'))
    debe_fallar(a, 'exportar todo el club', 'select exportar_club()')
    debe_fallar(a, 'respuestas de wellness del equipo', 'select * from respuestas_dia(current_date)')
    debe_fallar(a, 'corregir wellness de un compañero', 'select corregir_wellness(%s, current_date, 1,1,1,1, null)', (PERF['jugA2'],))
    debe_fallar(a, 'ver ficha/historial de un compañero', 'select * from historial_ejercicio(%s, null, %s)', (PERF['jugA2'], 'Sentadilla'))
    debe_fallar(a, 'ver entreno de un compañero', 'select entreno_del_dia(%s::date, %s)', (DA['hoy'], PERF['jugA2']))
    debe_fallar(a, 'armar planes', 'select guardar_dias(%s::jsonb)', (json.dumps([{'fecha': DA['hoy'], 'destinos': [{'tipo': 'equipo'}], 'items': []}]),))
    debe_fallar(a, 'escribir fichas', "select guardar_ficha(%s, '{}'::jsonb)", (PERF['jugA2'],))
    debe_fallar(a, 'cargar minutos', 'select guardar_minutos(current_date, 10, null)')
    debe_fallar(a, 'cambiar ajustes del club', 'select actualizar_fuentes(true, true)')
    debe_fallar(a, 'activar RPE por ejercicio', 'select activar_rpe_ejercicio(true)')
    debe_fallar(a, 'restablecer contraseña de otro', 'select preparar_clave_temporal(%s)', (PERF['adminA'],))
    debe_fallar(a, 'eliminar a otro', 'select eliminar_miembro(%s)', (PERF['jugA2'],))
    debe_fallar(a, 'crear actividad', "select guardar_actividad(null, '{\"nombre\":\"x\",\"tipo\":\"deportiva\",\"fecha\":\"2026-11-02\",\"hora_inicio\":\"10:00\"}'::jsonb, '[]'::jsonb)")
    debe_fallar(a, 'borrar actividad del club', 'select eliminar_actividad(%s)', (DA['act'],))
    debe_fallar(a, 'registrar en el plan de un compañero', "select guardar_registro(%s, '[]'::jsonb, true, 1)", (DA['item'],) if a != 'jugA' else (str(uuid.uuid4()),))
    debe_fallar(a, 'editar biblioteca', "select guardar_ejercicio(null, '{\"nombre\":\"HACK\"}'::jsonb)")
    debe_fallar(a, 'marcar excepciones', "select marcar_aplica(current_date, 'rpe', false, null)")
debe_fallar('jugA2', 'registrar en el plan personal de jugA', "select guardar_registro(%s, '[]'::jsonb, true, 1)", (DA['item'],))

# ---------- 5. Sin cuenta / cuenta sin club ----------
print('\n== 5. Sin sesión y con una cuenta recién creada sin club')
for a in ['anon', 'nadie']:
    debe_fallar(a, 'guardar wellness', 'select guardar_wellness(1,1,1,1)')
    debe_fallar(a, 'guardar rpe', 'select guardar_rpe(5)')
    debe_fallar(a, 'crear actividad', "select guardar_actividad(null, '{\"nombre\":\"x\",\"tipo\":\"deportiva\",\"fecha\":\"2026-11-02\",\"hora_inicio\":\"10:00\"}'::jsonb, '[]'::jsonb)")
    debe_fallar(a, 'token de calendario', 'select mi_token_calendario(false)')
    debe_fallar(a, 'suscribirse a avisos', "select guardar_suscripcion('https://x', 'k', 'a')")
    debe_fallar(a, 'tomar avisos (solo el servidor)', 'select * from tomar_avisos()')
    debe_fallar(a, 'quitar suscripción (solo el servidor)', "select quitar_suscripcion('https://push.example/x')")
    debe_fallar(a, 'organizaciones de la plataforma', 'select * from plataforma_organizaciones()')
    debe_fallar(a, 'exportar club', 'select exportar_club()')
    debe_vacio(a, 'estado de hoy', 'select estado_hoy()')
    debe_vacio(a, 'mi club', 'select mi_club()')
    debe_vacio(a, 'soy admin', 'select soy_admin()')
debe_fallar('anon', 'canjear código sin cuenta', 'select canjear_codigo(%s, %s)', ('X', 'Y'))

# ---------- 6. Calendario por token (lo único que funciona sin sesión) ----------
print('\n== 6. Calendario suscripto por token')
debe_vacio('anon', 'token inventado', "select * from ics_eventos('0000')")
ok, res, _ = correr('anon', 'select count(*), count(*) filter (where nombre like %s) from ics_eventos(%s)', ('Prensa%', DA['tok']))
print(f'  · anon con el token real de jugA ve {res[0][0]} actividades (prensa: {res[0][1]})')

# ---------- 7. Archivos adjuntos (Storage) ----------
print('\n== 7. Archivos adjuntos')
k0.execute("insert into storage.buckets (id, name, public) values ('adjuntos','adjuntos',false) on conflict do nothing")
k0.execute("insert into storage.objects (bucket_id, name) values ('adjuntos', %s), ('adjuntos', %s)", (f"{A}/{DA['act']}/parte.pdf", f"{A}/{DA['prensa']}/privado.pdf"))
c0.commit()
debe_vacio('adminB', 'ver archivos de A', "select name from storage.objects where bucket_id = 'adjuntos' and name like %s", (A + '%',))
debe_vacio('jugA2', 'ver adjunto de una prensa que no es suya', "select name from storage.objects where name like %s", (f"%{DA['prensa']}%",))
debe_vacio('utileroA', 'ver adjuntos (utilero sí ve el calendario: debería ver)', "select 0 where false")
debe_fallar('adminB', 'subir archivo a la carpeta de A', "insert into storage.objects (bucket_id, name) values ('adjuntos', %s)", (f"{A}/{DA['act']}/hack.pdf",))
debe_fallar('jugA', 'subir archivo a una actividad (jugador)', "insert into storage.objects (bucket_id, name) values ('adjuntos', %s)", (f"{A}/{DA['act']}/hack.pdf",))
debe_fallar('adminB', 'borrar archivo de A', "delete from storage.objects where name like %s", (A + '%',), verif=f"select count(*) from storage.objects where name like '{A}%'", cambio=lambda v: v[0][0] < 2)
ok, res, _ = correr('jugA', "select count(*) from storage.objects where bucket_id='adjuntos'")
print(f'  · jugA ve {res[0][0]} archivo(s) (el del entreno y el de su prensa: 2)')

# ---------- 8. Persona eliminada y club suspendido ----------
print('\n== 8. Persona eliminada y club suspendido')
k0.execute("update perfiles set eliminado_en = now() where id = %s", (PERF['jugA2'],)); c0.commit()
debe_fallar('jugA2', 'eliminado: guardar wellness', 'select guardar_wellness(3,3,3,3)')
debe_vacio('jugA2', 'eliminado: leer perfiles del club', 'select count(*) from perfiles')
debe_vacio('jugA2', 'eliminado: leer actividades', 'select count(*) from actividades')
k0.execute("update perfiles set eliminado_en = null where id = %s", (PERF['jugA2'],))
k0.execute("update clubs set estado = 'suspendida' where id = %s", (B,)); c0.commit()
debe_fallar('adminB', 'club suspendido: exportar', 'select exportar_club()')
debe_fallar('adminB', 'club suspendido: crear código', "select * from crear_codigo((select rol_id from perfiles where user_id = %s))", (U['adminB'],))
debe_vacio('adminB', 'club suspendido: leer wellness', 'select count(*) from wellness')
debe_fallar('jugB', 'club suspendido: guardar wellness', 'select guardar_wellness(3,3,3,3)')
k0.execute("update clubs set estado = 'activa' where id = %s", (B,)); c0.commit()

# ---------- 9. Lo que TIENE que seguir funcionando ----------
print('\n== 9. Lo legítimo sigue andando')
def debe_andar(quien, desc, sql, args=None, esperado=None):
    ok, res, _ = correr(quien, sql, args)
    bien = ok and (esperado is None or (res and res[0][0] == esperado))
    if bien: print(f'  ✓ {quien:9} {desc}: {str(res)[:60]}')
    else:
        problemas.append(f'[{quien}] ROTO: {desc} → {str(res)[:160]}')
        print(f'  ✗ {quien:9} ROTO: {desc} → {str(res)[:120]}')
debe_andar('jugA', 've su wellness', 'select count(*) from wellness', esperado=1)
debe_andar('jugA', 've sus 2 actividades', 'select count(*) from actividades', esperado=2)
debe_andar('jugA', 've su perfil (sin email)', 'select nombre from perfiles where id = %s', (PERF['jugA'],), esperado='Jugador A')
debe_andar('jugA', 've a sus compañeros (nombres)', 'select count(*) from perfiles', esperado=5)
debe_andar('jugA', 'su entreno del día', "select jsonb_array_length(entreno_del_dia(%s::date) -> 'items')", (DA['hoy'],), esperado=1)
debe_andar('jugA', 'registra su ejercicio', "select guardar_registro(%s, '[]'::jsonb, true, 4) ", (DA['item'],))
debe_andar('jugA', 'estado de hoy', "select (estado_hoy() ->> 'es_jugador')::boolean", esperado=True)
debe_andar('jugA', 'su token de calendario', 'select length(mi_token_calendario(false)) > 20', esperado=True)
debe_andar('jugA', 've los 2 adjuntos que le tocan', "select count(*) from storage.objects where bucket_id = 'adjuntos'", esperado=2)
debe_andar('utileroA', 've el calendario', 'select count(*) > 0 from actividades', esperado=True)
debe_andar('pfA', 've la biblioteca (465 + 0)', 'select count(*) from ejercicios', esperado=465)
debe_andar('pfA', 'respuestas del día del equipo', 'select count(*) from respuestas_dia(current_date)', esperado=2)
debe_andar('pfA', 'historial de un jugador', "select count(*) from historial_ejercicio(%s, null, 'Sentadilla')", (PERF['jugA'],), esperado=1)
debe_andar('pfA', 've el entreno de un jugador', "select jsonb_array_length(entreno_del_dia(%s::date, %s) -> 'items')", (DA['hoy'], PERF['jugA']), esperado=1)
debe_andar('pfA', 'corrige un wellness', 'select corregir_wellness(%s, current_date, 3,3,3,3, null)', (PERF['jugA'],))
debe_andar('adminA', 'emails del club (Usuarios)', 'select count(*) from emails_del_club()', esperado=5)
debe_andar('adminA', 'exporta el club', "select (exportar_club() -> 'club' ->> 'nombre')", esperado='Casademont Zaragoza')
debe_andar('adminA', 'crea un código de jugador', "select codigo ~ '^CZ-[A-Z0-9]{5}-[A-Z0-9]{5}$' from crear_codigo((select id from roles where club_id = %s and clave = 'jugador'))", (A,), esperado=True)
debe_andar('adminA', 'sube un adjunto a su actividad', "insert into storage.objects (bucket_id, name) values ('adjuntos', %s) returning 1", (f"{A}/{DA['act']}/nuevo.pdf",), esperado=1)
debe_andar('adminA', 've a toda la gente del club', 'select count(*) from perfiles', esperado=5)
debe_andar('owner', 'organizaciones con sus notas', "select count(*) from plataforma_organizaciones() where notas_dueno = 'NOTA PRIVADA DEL DUEÑO'", esperado=2)
debe_andar('owner', 'cambia plan y notas', "select plataforma_actualizar_organizacion(%s, 'regalo', 'activa', 'otra nota')", (B,))
debe_andar('anon', 'calendario por token', 'select count(*) from ics_eventos(%s)', (DA['tok'],), esperado=2)
k0.execute("select codigo from codigos_alta where not revocado and usos_max is null and club_id = %s order by creado_en desc limit 1", (A,)); r = k0.fetchone()
if r:
    debe_andar('anon', 'ver código escrito en minúscula y con espacios', 'select valido from ver_codigo(%s)', (r[0].lower().replace('-', ' '),), esperado=True)
debe_andar('anon', 'salud del servidor (código inventado)', "select valido from ver_codigo('SALUD-0000')", esperado=False)

# ---------- 10. Ficha (lesiones) solo con acceso al Sports Science Hub (026) ----------
print('\n== 10. Fichas con datos de salud')
k0.execute("""update perfiles set permisos_ajustados = '{"workout_builder": {"nivel": "editar", "exporta": false}, "sports_science": {"nivel": "sin", "exporta": false}}'::jsonb where id = %s""", (PERF['utileroA'],)); c0.commit()
debe_vacio('utileroA', 'Workout Builder sin Hub: leer lesiones', 'select lesiones from fichas_cliente')
debe_fallar('utileroA', 'Workout Builder sin Hub: cambiar una ficha', "select guardar_ficha(%s, '{}'::jsonb)", (PERF['jugA'],))
debe_andar('pfA', 'el PF (con Hub) ve la ficha', 'select count(*) from fichas_cliente', esperado=1)
k0.execute("update perfiles set permisos_ajustados = null where id = %s", (PERF['utileroA'],)); c0.commit()

# ---------- 11. Alertas y «Sumar persona» (027) ----------
print('\n== 11. Alertas del Hub y alta directa')
debe_vacio('jugA', 'reglas de alertas', 'select nombre from alertas_reglas')
debe_vacio('jugA', 'alertas disparadas', 'select detalle from alertas_disparadas')
debe_vacio('utileroA', 'alertas disparadas (sin Hub)', 'select detalle from alertas_disparadas')
debe_andar('pfA', 'el PF ve la alerta disparada', 'select count(*) from alertas_disparadas', esperado=1)
COND = json.dumps([{'metrica': 'sueno', 'comparador': 'menor', 'referencia': 'media', 'valor': -1}])
RARA = json.dumps([{'metrica': 'email', 'comparador': 'menor', 'referencia': 'valor', 'valor': 1}])
debe_fallar('jugA', 'crear una alerta', "select guardar_alerta(null, 'x', true, 'todas', 1, %s::jsonb)", (COND,))
debe_fallar('utileroA', 'crear una alerta (sin Hub)', "select guardar_alerta(null, 'x', true, 'todas', 1, %s::jsonb)", (COND,))
debe_fallar('adminB', 'cambiar una alerta de A', "select guardar_alerta(%s, 'x', false, 'todas', 1, %s::jsonb)", (DA['regla'], COND))
debe_fallar('adminB', 'borrar una alerta de A', 'select eliminar_alerta(%s)', (DA['regla'],))
debe_fallar('adminA', 'condición con campos raros', "select guardar_alerta(null, 'x', true, 'todas', 1, %s::jsonb)", (RARA,))
for quien in ['anon', 'jugA', 'adminA']:
    debe_fallar(quien, 'tomar_alertas (solo el servidor)', 'select * from tomar_alertas()')
debe_andar('pfA', 'el PF crea una alerta', "select guardar_alerta(null, 'Duerme mal', true, 'alguna', 2, %s::jsonb) is not null", (COND,), esperado=True)
# Alta directa: una cuenta recién creada, sin perfiles
NUEVA = str(uuid.uuid4())
k0.execute("insert into auth.users (id, email, raw_app_meta_data) values (%s, 'nueva@test.local', jsonb_build_object('sumado_en_club', %s::text))", (NUEVA, A)); c0.commit()
k0.execute("select id from roles where club_id = %s and clave = 'jugador'", (A,)); ROL_JUG_A = k0.fetchone()[0]
for quien in ['anon', 'jugA', 'pfA']:
    debe_fallar(quien, 'sumar persona (no admin)', "select sumar_persona(%s, 'nueva@test.local', 'X', %s)", (NUEVA, ROL_JUG_A))
debe_fallar('adminB', 'sumar persona con rol de otro club', "select sumar_persona(%s, 'nueva@test.local', 'X', %s)", (NUEVA, ROL_JUG_A))
debe_fallar('adminA', 'adoptar la cuenta de un jugador existente', "select sumar_persona(%s, 'jugB@test.local', 'X', %s)", (U['jugB'], ROL_JUG_A))
debe_fallar('adminA', 'adoptar una cuenta sin club (nadie)', "select sumar_persona(%s, 'nadie@test.local', 'X', %s)", (U['nadie'], ROL_JUG_A))
debe_fallar('adminA', 'sumar con email que no coincide', "select sumar_persona(%s, 'otro@test.local', 'X', %s)", (NUEVA, ROL_JUG_A))
debe_andar('adminA', 'suma a una persona nueva', "select sumar_persona(%s, 'nueva@test.local', 'Nueva', %s, %s) = %s::uuid", (NUEVA, ROL_JUG_A, DA['grupo'], NUEVA), esperado=True)
k0.execute("update auth.users set created_at = now() - interval '1 hour' where id = %s", (NUEVA,)); c0.commit()
debe_fallar('adminA', 'sumar una cuenta vieja', "select sumar_persona(%s, 'nueva@test.local', 'X', %s)", (NUEVA, ROL_JUG_A))
debe_andar('jugA', 'acepta el consentimiento', 'select aceptar_consentimiento() is null', esperado=True)

print('\n== 12. Eliminar una organización (solo el dueño)')
for quien in ['anon', 'jugA', 'adminA', 'adminB']:
    debe_fallar(quien, 'eliminar la organización A', "select plataforma_eliminar_organizacion(%s, 'Casademont Zaragoza')", (A,))
debe_fallar('owner', 'eliminar con el nombre equivocado', "select plataforma_eliminar_organizacion(%s, 'Otra')", (A,))
debe_andar('owner', 'elimina Fénix (se deshace al final)', "select 1 from (select plataforma_eliminar_organizacion(%s, 'Fénix Rugby')) x", (B,), esperado=1)
ok, res, v = correr('owner', "select plataforma_eliminar_organizacion(%s, 'Fénix Rugby')", (B,), verif="select (select count(*) from clubs where id = '%s') + (select count(*) from perfiles where club_id = '%s') + (select count(*) from wellness where club_id = '%s')" % (B, B, B))
if not (ok and v[0][0] == 0): problemas.append(f'[owner] eliminar no borró todo: {res} {v}')
else: print('  ✓ owner     no queda nada de Fénix (club, personas, wellness)')
k0.execute("select count(*) from clubs where id = %s", (B,)); assert k0.fetchone()[0] == 1   # se deshizo

print('\n== 13. Partes de fisio, asistencia y ficha (028)')
debe_vacio('jugA', 'partes de fisio', 'select motivo from partes_fisio')
debe_vacio('jugA', 'ausencias', 'select * from ausencias')
debe_vacio('utileroA', 'partes de fisio (sin Hub)', 'select motivo from partes_fisio')
debe_vacio('adminA', 'partes de otro club', 'select motivo from partes_fisio where club_id = %s', (B,))
debe_vacio('adminA', 'ausencias de otro club', 'select * from ausencias where club_id = %s', (B,))
debe_andar('pfA', 'el PF ve el parte', 'select count(*) from partes_fisio', esperado=1)
for quien in ['jugA', 'utileroA']:
    debe_fallar(quien, 'cargar un parte', "select guardar_parte(null, %s, current_date, 'x', 'si', 'si')", (PERF['jugA'],))
    debe_fallar(quien, 'marcar asistencia', 'select marcar_asistencia(current_date, %s, false)', (PERF['jugA'],))
    debe_fallar(quien, 'ver la ficha de un jugador', 'select ficha_jugador(%s, current_date - 30, current_date)', (PERF['jugA'],))
debe_fallar('adminA', 'parte de un jugador de otro club', "select guardar_parte(null, %s, current_date, 'x', 'si', 'si')", (PERF['jugB'],))
debe_fallar('adminA', 'parte de alguien que no es jugador', "select guardar_parte(null, %s, current_date, 'x', 'si', 'si')", (PERF['pfA'],))
debe_fallar('adminA', 'asistencia de un jugador de otro club', 'select marcar_asistencia(current_date, %s, false)', (PERF['jugB'],))
debe_fallar('adminA', 'ficha de un jugador de otro club', 'select ficha_jugador(%s, current_date - 30, current_date)', (PERF['jugB'],))
k0.execute('select id from partes_fisio where club_id = %s', (A,)); PARTE_A = k0.fetchone()[0]
debe_fallar('adminB', 'borrar un parte de A', 'select eliminar_parte(%s)', (PARTE_A,))
debe_fallar('adminB', 'cambiar un parte de A', "select guardar_parte(%s, %s, current_date, 'x', 'si', 'si')", (PARTE_A, PERF['jugB']))
for quien in ['anon', 'jugA', 'adminA']:
    debe_fallar(quien, 'tomar_partes (solo el servidor)', 'select * from tomar_partes()')
debe_andar('pfA', 'el PF marca una falta', 'select marcar_asistencia(current_date, %s, false) is null', (PERF['jugA'],), esperado=None)
debe_andar('adminB', 'la ficha cuenta la falta', "select ficha_jugador(%s, current_date - 30, current_date + 1) ->> 'faltas'", (PERF['jugB'],), esperado='1')
debe_andar('pfA', 'la ficha cuenta el entreno de campo', "select ficha_jugador(%s, current_date - 30, current_date + 1) ->> 'campo'", (PERF['jugA'],), esperado='1')

print('\n== RESUMEN:', len(problemas), 'problemas')
for p in problemas: print(' -', p)
