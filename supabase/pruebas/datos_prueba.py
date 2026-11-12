# Arma dos clubes con datos usando los mismos caminos que la app (códigos, funciones).
import json, uuid, psycopg2, sys

DB = dict(host='localhost', port=5433, user='postgres', dbname=sys.argv[1] if len(sys.argv) > 1 else 'espejo2')
cx = psycopg2.connect(**DB); cx.autocommit = True
U = {k: str(uuid.uuid4()) for k in ['owner', 'adminA', 'jugA', 'jugA2', 'utileroA', 'pfA', 'adminB', 'jugB', 'nadie']}
EMAIL = {k: ('marianobein1993@gmail.com' if k == 'owner' else f'{k}@test.local') for k in U}

def q(sql, args=None, uid=None, role='authenticated', one=True):
    with cx.cursor() as c:
        c.execute('begin')
        if uid is not None or role == 'anon':
            c.execute("select set_config('test.uid', %s, true)", (uid or '',))
            c.execute(f'set local role {role}')
        try:
            c.execute(sql, args)
            r = c.fetchall() if c.description else None
            c.execute('commit')
        except Exception:
            c.execute('rollback'); raise
    return (r[0][0] if r and one and len(r[0]) == 1 else r[0] if r and one else r)

for k, u in U.items():
    q('insert into auth.users (id, email) values (%s, %s)', (u, EMAIL[k]))
q('update duenos_plataforma set user_id = %s where email = %s', (U['owner'], EMAIL['owner']))
clubA = q("select id from clubs where nombre = 'Casademont Zaragoza'")

# Club A: el dueño genera el código del primer admin
codA = q('select plataforma_nuevo_codigo_admin(%s)', (clubA,), uid=U['owner'])
q('select canjear_codigo(%s, %s)', (codA, 'Admin A'), uid=U['adminA'])
rol = lambda club, clave: q('select id from roles where club_id = %s and clave = %s', (club, clave))
q("update perfiles set es_admin = true where user_id = %s", (U['adminA'],))
for k, clave, nombre in [('jugA', 'jugador', 'Jugador A'), ('jugA2', 'jugador', 'Jugador A2'), ('utileroA', 'utilero', 'Utilero A'), ('pfA', 'pf', 'PF A')]:
    cod = q('select codigo from crear_codigo(%s)', (rol(clubA, clave),), uid=U['adminA'])
    q('select canjear_codigo(%s, %s)', (cod, nombre), uid=U[k])

# Club B: organización nueva creada por el dueño
clubB, codB = q("select * from plataforma_crear_organizacion('Fénix Rugby', 'club', 'prueba', 'Madrid', 'principal')", uid=U['owner'])
q('select canjear_codigo(%s, %s)', (codB, 'Admin B'), uid=U['adminB'])
cod = q('select codigo from crear_codigo(%s)', (rol(clubB, 'jugador'),), uid=U['adminB'])
q('select canjear_codigo(%s, %s)', (cod, 'Jugador B'), uid=U['jugB'])
q("insert into notas_plataforma (club_id, notas) values (%s, 'NOTA PRIVADA DEL DUEÑO'), (%s, 'NOTA PRIVADA DEL DUEÑO') on conflict (club_id) do update set notas = excluded.notas", (clubA, clubB))

P = lambda k: q('select id from perfiles where user_id = %s', (U[k],))
datos = {}
for club, adm, jug in [(clubA, 'adminA', 'jugA'), (clubB, 'adminB', 'jugB')]:
    s = club[:4]
    q('select guardar_wellness(4,2,2,2)', uid=U[jug])
    q('select guardar_rpe(7)', uid=U[jug])
    hoy = q('select hoy_club(%s)::text', (club,))
    act = q("select guardar_actividad(null, %s::jsonb, %s::jsonb)", (json.dumps({'nombre': f'Entreno {s}', 'tipo': 'deportiva', 'fecha': hoy, 'hora_inicio': '10:00'}), json.dumps([{'tipo': 'equipo'}])), uid=U[adm])
    prensa = q("select guardar_actividad(null, %s::jsonb, %s::jsonb)", (json.dumps({'nombre': f'Prensa {s}', 'tipo': 'prensa', 'fecha': hoy, 'hora_inicio': '12:00'}), json.dumps([{'tipo': 'persona', 'ref': P(jug)}])), uid=U[adm])
    item = str(uuid.uuid4())
    q("select guardar_dias(%s::jsonb)", (json.dumps([{'fecha': hoy, 'destinos': [{'tipo': 'persona', 'ref': P(jug)}], 'items': [{'id': item, 'tipo': 'ejercicio', 'nombre': 'Sentadilla', 'series': 3, 'reps': '6', 'detalle': [{'reps': '6', 'kg': 60}]}]}]),), uid=U[adm])
    q("select guardar_registro(%s, '[{\"reps\":\"6\",\"kg\":60}]'::jsonb, true, 5)", (item,), uid=U[jug])
    q("select guardar_ficha(%s, '{\"lesiones\":\"LESION SECRETA\"}'::jsonb)", (P(jug),), uid=U[adm])
    prog = q("select guardar_programa(null, 'Programa secreto', null, 1, '{}'::jsonb)", uid=U[adm])
    tok = q('select mi_token_calendario(false)', uid=U[jug])
    q("select registrar_adjunto(%s, %s, 'parte.pdf', 'application/pdf', 100)", (act, f'{club}/{act}/parte.pdf'), uid=U[adm])
    q("select guardar_suscripcion(%s, 'k', 'a')", (f'https://push.example/{s}',), uid=U[jug])
    grupo = q("select crear_grupo(%s)", (f'Grupo {s}',), uid=U[adm])
    q("select guardar_minutos(%s::date, 90, null)", (hoy,), uid=U[adm])
    regla = q("select guardar_alerta(null, 'Alerta secreta', true, 'todas', 1, %s::jsonb)", (json.dumps([{'metrica': 'sueno', 'comparador': 'mayor_igual', 'referencia': 'valor', 'valor': 1}]),), uid=U[adm])
    datos[club] = dict(regla=regla, act=act, prensa=prensa, item=item, prog=prog, tok=tok, grupo=grupo, hoy=hoy)

# El PF y el utilero de A activan los avisos; las alertas se revisan como lo haría el servidor
q("select guardar_suscripcion('https://push.example/pfA', 'k', 'a')", uid=U['pfA'])
q("select guardar_suscripcion('https://push.example/utileroA', 'k', 'a')", uid=U['utileroA'])
pushes = q("select endpoint from tomar_alertas()", one=False)
assert sorted(x[0] for x in pushes) == ['https://push.example/pfA'], pushes   # solo el staff deportivo
assert not q("select count(*) from tomar_alertas()"), 'se repite'
# Parte de fisio en A (lo carga el admin): le llega al PF, no al utilero; en B, uno para que A no lo vea
q("select guardar_parte(null, %s, current_date, 'Molestia isquio', 'restricciones', 'no', 'sin sprints', current_date + 2)", (PERF_A_JUG := q("select id from perfiles where user_id = %s", (U['jugA'],)),), uid=U['adminA'])
pp = q("select endpoint from tomar_partes()", one=False)
assert sorted(x[0] for x in pp) == ['https://push.example/pfA'], pp
q("select guardar_parte(null, %s, current_date, 'Esguince', 'no', 'no')", (q("select id from perfiles where user_id = %s", (U['jugB'],)),), uid=U['adminB'])
q("select marcar_asistencia(current_date, %s, false)", (q("select id from perfiles where user_id = %s", (U['jugB'],)),), uid=U['adminB'])

json.dump(dict(U=U, clubA=clubA, clubB=clubB, datos=datos, perf={k: P(k) for k in U if k not in ('owner', 'nadie')}), open(sys.argv[2] if len(sys.argv) > 2 else 'fixtures.json', 'w'), indent=1)
print('ok', clubA, clubB)
