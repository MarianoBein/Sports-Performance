-- =====================================================================
-- 020 · Una misma cuenta (mismo mail) en varias organizaciones
-- Pegar entero en Supabase → SQL Editor → Run (después del 019).
--
-- Antes: cada cuenta tenía UN perfil y quedaba atada a una sola organización.
-- Ahora: una cuenta puede tener un perfil en cada organización (con su rol, su
-- nombre de admin, sus grupos…), y elige arriba en cuál está trabajando.
-- Los datos de cada organización siguen separados: estando en una, no se ve
-- nada de la otra. El panel de Plataforma (dueño) no cambia.
--
-- Los perfiles que ya existen quedan igual (mismo id), así que no se pierde nada.
-- =====================================================================

begin;

-- ---------- 1. Cada perfil apunta a su cuenta ----------
alter table public.perfiles add column if not exists user_id uuid references auth.users(id) on delete cascade;
update public.perfiles set user_id = id where user_id is null;
alter table public.perfiles alter column user_id set not null;
alter table public.perfiles alter column id set default gen_random_uuid();
alter table public.perfiles drop constraint if exists perfiles_id_fkey;   -- el id del perfil ya no es el de la cuenta
create unique index if not exists perfiles_cuenta_club on public.perfiles (user_id, club_id) where eliminado_en is null;
create index if not exists perfiles_user_id on public.perfiles (user_id);

-- ---------- 2. En qué organización está trabajando cada cuenta ----------
create table if not exists public.perfil_activo (
  user_id uuid primary key references auth.users(id) on delete cascade,
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  cambiado_en timestamptz not null default now()
);
alter table public.perfil_activo enable row level security;  -- sin políticas: solo por las funciones de abajo

-- El perfil con el que está trabajando la cuenta ahora (reemplaza a auth.uid() en todo el sistema).
create or replace function public.yo() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.perfil_id from perfil_activo a join perfiles p on p.id = a.perfil_id
      where a.user_id = auth.uid() and p.user_id = auth.uid() and p.eliminado_en is null),
    (select p.id from perfiles p join clubs c on c.id = p.club_id
      where p.user_id = auth.uid() and p.eliminado_en is null
      order by (c.estado = 'activa') desc, p.creado_en limit 1))
$$;
revoke all on function public.yo() from public, anon;
grant execute on function public.yo() to authenticated;

-- Las organizaciones de mi cuenta (solo nombre y mi rol: nada de datos internos).
create or replace function public.mis_organizaciones()
returns table (perfil_id uuid, club_id uuid, club text, rol text, es_admin boolean, activa boolean)
language sql stable security definer set search_path = public as $$
  select p.id, c.id, c.nombre, r.nombre, p.es_admin, p.id = yo()
  from perfiles p join clubs c on c.id = p.club_id join roles r on r.id = p.rol_id
  where p.user_id = auth.uid() and p.eliminado_en is null and c.estado = 'activa'
  order by c.nombre
$$;
revoke all on function public.mis_organizaciones() from public, anon;
grant execute on function public.mis_organizaciones() to authenticated;

create or replace function public.cambiar_organizacion(p_perfil uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from perfiles p join clubs c on c.id = p.club_id
                 where p.id = p_perfil and p.user_id = auth.uid() and p.eliminado_en is null and c.estado = 'activa') then
    raise exception 'No sos parte de esa organización.';
  end if;
  insert into perfil_activo (user_id, perfil_id) values (auth.uid(), p_perfil)
  on conflict (user_id) do update set perfil_id = excluded.perfil_id, cambiado_en = now();
end $$;
revoke all on function public.cambiar_organizacion(uuid) from public, anon;
grant execute on function public.cambiar_organizacion(uuid) to authenticated;

-- ---------- 3. Alta con código: también para cuentas que ya existen ----------
create or replace function public.canjear_codigo(p_codigo text, p_nombre text)
returns void
language plpgsql security definer set search_path = public as $$
declare c codigos_alta; v_email text; v_rol text; v_id uuid; v_nombre text;
begin
  if auth.uid() is null then raise exception 'Tienes que crear la cuenta primero.'; end if;
  select * into c from codigos_alta where codigo = upper(trim(p_codigo)) for update;
  if not found or c.revocado or c.caduca_en < now() or (c.usos_max is not null and c.usos >= c.usos_max) then
    raise exception 'El código no es válido.';
  end if;
  if exists (select 1 from perfiles where user_id = auth.uid() and club_id = c.club_id and eliminado_en is null) then
    raise exception 'Ya sos parte de esta organización.';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  v_nombre := coalesce(nullif(trim(p_nombre), ''),
                       (select nombre from perfiles where user_id = auth.uid() order by creado_en limit 1));
  if v_nombre is null then raise exception 'Falta el nombre.'; end if;
  -- La primera vez el perfil usa el mismo id que la cuenta (como siempre); las siguientes, uno nuevo.
  v_id := case when exists (select 1 from perfiles where id = auth.uid()) then gen_random_uuid() else auth.uid() end;
  insert into perfiles (id, user_id, club_id, nombre, email, rol_id, es_admin, consentimiento_en)
  values (v_id, auth.uid(), c.club_id, v_nombre, v_email, c.rol_id, c.da_admin, now());
  if c.grupo_id is not null then
    insert into grupo_miembros (grupo_id, perfil_id) values (c.grupo_id, v_id);
  end if;
  update codigos_alta set usos = usos + 1 where id = c.id;
  -- Entra directo a la organización nueva.
  insert into perfil_activo (user_id, perfil_id) values (auth.uid(), v_id)
  on conflict (user_id) do update set perfil_id = excluded.perfil_id, cambiado_en = now();
  select nombre into v_rol from roles where id = c.rol_id;
  perform _registrar(c.club_id, 'se dio de alta con el código ' || c.codigo || ' como ' || v_rol
    || case when c.da_admin then ' (administrador)' else '' end || '.');
end $$;

-- ---------- 4. Contraseñas: la clave es de la cuenta, no del perfil ----------
create or replace function public.clave_cambiada() returns void
language sql security definer set search_path = public as $$
  update perfiles set debe_cambiar_clave = false where user_id = auth.uid();
$$;

-- Devuelve el id de la CUENTA a la que hay que ponerle la clave temporal.
-- Si esa cuenta también está en otra organización (o es el dueño de la plataforma),
-- un admin de este club no puede cambiarle la clave: le daría acceso a la otra.
create or replace function public.preparar_clave_temporal(p_perfil uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_nombre text; v_user uuid;
begin
  if not soy_admin() then raise exception 'Solo un administrador puede restablecer contraseñas.'; end if;
  select nombre, user_id into v_nombre, v_user from perfiles where id = p_perfil and club_id = v_club and eliminado_en is null;
  if v_nombre is null then raise exception 'Esa persona no está en el club.'; end if;
  if exists (select 1 from perfiles where user_id = v_user and club_id <> v_club and eliminado_en is null)
     or exists (select 1 from duenos_plataforma where user_id = v_user) then
    raise exception 'Esta persona usa la misma cuenta en otra organización: la contraseña la tiene que cambiar ella misma.';
  end if;
  update perfiles set debe_cambiar_clave = true where user_id = v_user;
  perform _registrar(v_club, 'restableció la contraseña de ' || v_nombre || '.');
  return v_user::text;
end $$;

-- ---------- 5. Todo lo demás: «yo» pasa a ser el perfil activo, no la cuenta ----------
-- (Generado automáticamente: mismas funciones y reglas de antes, cambiando
--  auth.uid() por yo(). No cambia ningún permiso.)

CREATE OR REPLACE FUNCTION public._registrar(p_club uuid, p_accion text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into registro_cambios (club_id, actor_id, actor_nombre, accion)
  values (p_club, (select public.yo()), (select nombre from perfiles where id = (select public.yo())), p_accion);
end $function$
;

CREATE OR REPLACE FUNCTION public.borrar_adjunto(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare x actividad_adjuntos;
begin
  select * into x from actividad_adjuntos where id = p_id and club_id = mi_club();
  if x.id is null then raise exception 'Ese archivo ya no existe.'; end if;
  if not puede_editar_actividad((select public.yo()), x.actividad_id) then raise exception 'No podés borrar este archivo.'; end if;
  delete from actividad_adjuntos where id = p_id;
  return x.ruta; -- la app borra el archivo de la carpeta
end $function$
;

CREATE OR REPLACE FUNCTION public.borrar_suscripcion(p_endpoint text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from push_suscripciones where endpoint = p_endpoint and perfil_id = (select public.yo());
$function$
;

CREATE OR REPLACE FUNCTION public.crear_codigo(p_rol uuid, p_grupo uuid DEFAULT NULL::uuid)
 RETURNS TABLE(codigo text, caduca_en timestamp with time zone, usos_max integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare v_club uuid := mi_club(); r roles; v_codigo text; v_prefijo text;
        v_alfabeto text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if not soy_admin() then raise exception 'Solo un administrador puede crear códigos.'; end if;
  select * into r from roles where id = p_rol and club_id = v_club;
  if not found then raise exception 'Rol no válido.'; end if;
  if p_grupo is not null and not exists (select 1 from grupos where id = p_grupo and club_id = v_club) then
    raise exception 'Grupo no válido.';
  end if;
  select upper(string_agg(left(w, 1), '')) into v_prefijo
    from (select w from regexp_split_to_table((select nombre from clubs where id = v_club), '\s+') w limit 2) x;
  loop
    v_codigo := coalesce(v_prefijo, 'CL') || '-';
    for i in 1..4 loop
      v_codigo := v_codigo || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    end loop;
    exit when not exists (select 1 from codigos_alta where codigos_alta.codigo = v_codigo);
  end loop;
  insert into codigos_alta (club_id, codigo, rol_id, grupo_id, usos_max, caduca_en, creado_por)
  values (v_club, v_codigo, r.id, case when r.es_jugador then p_grupo else null end,
          case when r.es_jugador then null else 1 end,
          now() + case when r.es_jugador then interval '7 days' else interval '48 hours' end,
          (select public.yo()));
  perform _registrar(v_club, 'creó el código de alta ' || v_codigo || ' para ' || r.nombre || '.');
  return query select a.codigo, a.caduca_en, a.usos_max from codigos_alta a where a.codigo = v_codigo;
end $function$
;

CREATE OR REPLACE FUNCTION public.eliminar_actividad(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a actividades; v_nivel text := nivel_de((select public.yo()), 'calendario');
begin
  select * into a from actividades where id = p_id and club_id = mi_club() and eliminado_en is null;
  if not found then raise exception 'Actividad no encontrada.'; end if;
  if not (v_nivel = 'editar' or (v_nivel = 'propio' and a.creado_por = (select public.yo()))) then
    raise exception 'No puedes eliminar esta actividad.';
  end if;
  update actividades set eliminado_en = now() where id = p_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.eliminar_dia(p_fecha date, p_destinos jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_club uuid := mi_club(); v_clave text;
begin
  if v_club is null or nivel_de((select public.yo()), 'workout_builder') <> 'editar' then
    raise exception 'Solo quien edita el Workout Builder puede armar sesiones.';
  end if;
  v_clave := _clave_destinos(v_club, p_destinos);
  delete from sesiones where club_id = v_club and fecha = p_fecha and destinos_clave = v_clave;
end $function$
;

CREATE OR REPLACE FUNCTION public.eliminar_ejercicio(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_club uuid := mi_club(); v_nombre text;
begin
  if v_club is null or nivel_de((select public.yo()), 'workout_builder') <> 'editar' then
    raise exception 'Solo quien edita el Workout Builder puede cambiar la biblioteca.';
  end if;
  update ejercicios set eliminado_en = now() where id = p_id and club_id = v_club and eliminado_en is null
  returning nombre into v_nombre;
  if v_nombre is null then raise exception 'Ese ejercicio ya no existe.'; end if;
  perform _registrar(v_club, 'eliminó el ejercicio «' || v_nombre || '».');
end $function$
;

CREATE OR REPLACE FUNCTION public.eliminar_lugar(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if nivel_de((select public.yo()), 'calendario') not in ('editar', 'propio') then raise exception 'Sin permiso.'; end if;
  delete from lugares where id = p_id and club_id = mi_club();
end $function$
;

CREATE OR REPLACE FUNCTION public.entreno_del_dia(p_fecha date, p_perfil uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_perfil uuid := coalesce(p_perfil, (select public.yo())); v_sesion uuid;
begin
  if not puede_ver_entreno(v_perfil) then raise exception 'Sin acceso a este entrenamiento.'; end if;
  v_sesion := _sesion_efectiva(v_perfil, p_fecha);
  if v_sesion is null then return jsonb_build_object('fecha', p_fecha, 'items', '[]'::jsonb); end if;
  return jsonb_build_object(
    'fecha', p_fecha,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'tipo', i.tipo, 'nombre', i.nombre, 'ejercicio_id', i.ejercicio_id, 'series', i.series, 'reps', i.reps,
        'cada_lado', i.cada_lado, 'detalle', i.detalle, 'descanso_seg', i.descanso_seg, 'nota', i.nota,
        'video_url', e.video_url, 'consignas', e.consignas, 'config', i.config,
        'hecho', r.hecho, 'completado_en', r.completado_en
      ) order by i.orden)
      from sesion_items i
      left join ejercicios e on e.id = i.ejercicio_id
      left join sesion_registros r on r.item_id = i.id and r.perfil_id = v_perfil
      where i.sesion_id = v_sesion and i.eliminado_en is null), '[]'::jsonb)
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.estado_hoy()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select estado_de((select public.yo()))
$function$
;

CREATE OR REPLACE FUNCTION public.guardar_actividad(p_id uuid, p_datos jsonb, p_destinos jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club uuid := mi_club(); v_nivel text := nivel_de((select public.yo()), 'calendario');
  a actividades; v_id uuid; v_cambio_horario boolean := false; d jsonb;
begin
  if v_club is null then raise exception 'Sin acceso.'; end if;
  if v_nivel not in ('editar', 'propio') then raise exception 'No tienes permiso para crear actividades.'; end if;
  if coalesce(trim(p_datos ->> 'nombre'), '') = '' then raise exception 'Falta el nombre.'; end if;

  if p_id is not null then
    select * into a from actividades where id = p_id and club_id = v_club and eliminado_en is null for update;
    if not found then raise exception 'Actividad no encontrada.'; end if;
    if v_nivel = 'propio' and a.creado_por is distinct from (select public.yo()) then
      raise exception 'Solo puedes editar las actividades que creaste tú.';
    end if;
    v_cambio_horario := a.fecha is distinct from (p_datos ->> 'fecha')::date
      or a.hora_inicio is distinct from nullif(p_datos ->> 'hora_inicio', '')::time
      or a.todo_el_dia is distinct from coalesce((p_datos ->> 'todo_el_dia')::boolean, false);
    update actividades set
      nombre = trim(p_datos ->> 'nombre'),
      tipo = p_datos ->> 'tipo',
      fecha = (p_datos ->> 'fecha')::date,
      todo_el_dia = coalesce((p_datos ->> 'todo_el_dia')::boolean, false),
      hora_inicio = case when coalesce((p_datos ->> 'todo_el_dia')::boolean, false) then null else nullif(p_datos ->> 'hora_inicio', '')::time end,
      hora_fin = case when coalesce((p_datos ->> 'todo_el_dia')::boolean, false) then null else nullif(p_datos ->> 'hora_fin', '')::time end,
      lugar = nullif(trim(p_datos ->> 'lugar'), ''),
      direccion = nullif(trim(p_datos ->> 'direccion'), ''),
      es_partido = coalesce((p_datos ->> 'es_partido')::boolean, false),
      rival = nullif(trim(p_datos ->> 'rival'), ''),
      fuera = coalesce((p_datos ->> 'fuera')::boolean, false),
      actualizado_en = now()
    where id = p_id;
    v_id := p_id;
  else
    insert into actividades (club_id, nombre, tipo, fecha, todo_el_dia, hora_inicio, hora_fin, lugar, direccion, es_partido, rival, fuera, creado_por)
    values (v_club, trim(p_datos ->> 'nombre'), p_datos ->> 'tipo', (p_datos ->> 'fecha')::date,
      coalesce((p_datos ->> 'todo_el_dia')::boolean, false),
      case when coalesce((p_datos ->> 'todo_el_dia')::boolean, false) then null else nullif(p_datos ->> 'hora_inicio', '')::time end,
      case when coalesce((p_datos ->> 'todo_el_dia')::boolean, false) then null else nullif(p_datos ->> 'hora_fin', '')::time end,
      nullif(trim(p_datos ->> 'lugar'), ''), nullif(trim(p_datos ->> 'direccion'), ''),
      coalesce((p_datos ->> 'es_partido')::boolean, false), nullif(trim(p_datos ->> 'rival'), ''),
      coalesce((p_datos ->> 'fuera')::boolean, false), (select public.yo()))
    returning id into v_id;
  end if;

  delete from actividad_destinos where actividad_id = v_id;
  for d in select * from jsonb_array_elements(coalesce(p_destinos, '[]'::jsonb)) loop
    insert into actividad_destinos (actividad_id, tipo, ref)
    values (v_id, d ->> 'tipo', nullif(d ->> 'ref', '')::uuid)
    on conflict do nothing;
  end loop;

  -- Prensa: confirmación de cada persona etiquetada.
  if p_datos ->> 'tipo' = 'prensa' then
    delete from actividad_confirmaciones
    where actividad_id = v_id and perfil_id not in (select personas_de_actividad(v_id));
    if v_cambio_horario then
      update actividad_confirmaciones set estado = 'pendiente', respondido_en = null where actividad_id = v_id;
    end if;
    insert into actividad_confirmaciones (actividad_id, perfil_id)
    select v_id, x from personas_de_actividad(v_id) x
    where x <> (select public.yo())
    on conflict do nothing;
  else
    delete from actividad_confirmaciones where actividad_id = v_id;
  end if;

  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.guardar_dia(p_fecha date, p_destinos jsonb, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club uuid := mi_club(); v_clave text; v_sesion uuid; it jsonb; i int := 0; v_ids uuid[] := '{}';
  v_id uuid; v_ej uuid; v_series int; v_nuevo boolean := false; v_tipo text;
begin
  if v_club is null or nivel_de((select public.yo()), 'workout_builder') <> 'editar' then
    raise exception 'Solo quien edita el Workout Builder puede armar sesiones.';
  end if;
  if p_fecha is null then raise exception 'Falta la fecha.'; end if;
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' or jsonb_array_length(coalesce(p_items, '[]')) > 60 then
    raise exception 'Demasiados ejercicios para un día (máximo 60).';
  end if;
  v_clave := _clave_destinos(v_club, p_destinos);

  select id into v_sesion from sesiones where club_id = v_club and fecha = p_fecha and destinos_clave = v_clave;
  if v_sesion is null then
    insert into sesiones (club_id, fecha, destinos, destinos_clave, creado_por)
    values (v_club, p_fecha, p_destinos, v_clave, (select public.yo())) returning id into v_sesion;
    v_nuevo := true;
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    v_id := (it ->> 'id')::uuid;
    v_ej := nullif(it ->> 'ejercicio_id', '')::uuid;
    v_tipo := coalesce(nullif(it ->> 'tipo', ''), 'ejercicio');
    if v_tipo not in ('ejercicio', 'break', 'nota', 'pregunta') then raise exception 'Elemento no válido.'; end if;
    v_series := case when v_tipo <> 'ejercicio' then null else (it ->> 'series')::int end;
    if v_tipo <> 'ejercicio' then v_ej := null; end if;
    if v_id is null then raise exception 'Falta el identificador de un ejercicio.'; end if;
    if exists (select 1 from sesion_items where id = v_id and sesion_id <> v_sesion) then
      -- Venía de otro día o de otro plan: se mueve aquí.
      if not exists (select 1 from sesion_items where id = v_id and club_id = v_club) then raise exception 'Ejercicio no válido.'; end if;
    end if;
    if v_ej is not null and not exists (select 1 from ejercicios where id = v_ej and club_id = v_club) then
      raise exception 'Ejercicio no válido.';
    end if;
    if btrim(coalesce(it ->> 'nombre', '')) = '' then raise exception 'Falta el nombre (del ejercicio o del session break).'; end if;
    if v_tipo = 'ejercicio' and (v_series is null or v_series < 1 or v_series > 20) then raise exception 'Las series van de 1 a 20.'; end if;
    if jsonb_typeof(coalesce(it -> 'config', '{}')) <> 'object' or length(coalesce(it -> 'config', '{}')::text) > 4000 then raise exception 'Configuración no válida.'; end if;
    insert into sesion_items (id, sesion_id, club_id, orden, tipo, bloque, ejercicio_id, nombre, series, reps, cada_lado, con_carga, detalle, descanso_seg, nota, origen_id, modificado, config, eliminado_en)
    values (v_id, v_sesion, v_club, i, v_tipo, 'Bloque principal', v_ej, btrim(it ->> 'nombre'),
            v_series, nullif(btrim(it ->> 'reps'), ''), coalesce((it ->> 'cada_lado')::boolean, false), coalesce((it ->> 'con_carga')::boolean, false),
            coalesce(it -> 'detalle', '[]'), nullif(it ->> 'descanso_seg', '')::int, nullif(btrim(it ->> 'nota'), ''),
            nullif(it ->> 'origen_id', '')::uuid, coalesce((it ->> 'modificado')::boolean, false), coalesce(it -> 'config', '{}'), null)
    on conflict (id) do update set
      sesion_id = excluded.sesion_id, orden = excluded.orden, tipo = excluded.tipo, ejercicio_id = excluded.ejercicio_id,
      nombre = excluded.nombre, series = excluded.series, reps = excluded.reps, cada_lado = excluded.cada_lado,
      con_carga = excluded.con_carga, detalle = excluded.detalle, descanso_seg = excluded.descanso_seg, nota = excluded.nota,
      origen_id = excluded.origen_id, modificado = excluded.modificado, config = excluded.config, eliminado_en = null
    where sesion_items.club_id = v_club;
    v_ids := v_ids || v_id;
    i := i + 1;
  end loop;

  update sesion_items set eliminado_en = now()
  where sesion_id = v_sesion and eliminado_en is null and not (id = any (v_ids));
  update sesiones set actualizado_en = now() where id = v_sesion;

  if v_nuevo then
    perform _registrar(v_club, 'armó una sesión para el ' || to_char(p_fecha, 'DD/MM/YYYY') || '.');
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.guardar_ejercicio(p_id uuid, p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club uuid := mi_club(); v_id uuid; v_nombre text := btrim(coalesce(p ->> 'nombre', ''));
  v_video text := nullif(btrim(coalesce(p ->> 'video_url', '')), ''); v_antes text;
begin
  if v_club is null or nivel_de((select public.yo()), 'workout_builder') <> 'editar' then
    raise exception 'Solo quien edita el Workout Builder puede cambiar la biblioteca.';
  end if;
  if v_nombre = '' then raise exception 'El ejercicio necesita un nombre.'; end if;
  if v_video is not null and v_video !~ '^https://' then raise exception 'El video tiene que ser un link que empiece con https://'; end if;
  if exists (select 1 from ejercicios where club_id = v_club and eliminado_en is null
             and lower(btrim(nombre)) = lower(v_nombre) and id is distinct from p_id) then
    raise exception 'Ya hay un ejercicio que se llama «%».', v_nombre;
  end if;

  if p_id is null then
    insert into ejercicios (club_id, nombre, categoria, implemento, lateralidad, contraccion, video_url, consignas, creado_por)
    values (v_club, v_nombre, nullif(btrim(p ->> 'categoria'), ''), nullif(btrim(p ->> 'implemento'), ''),
            nullif(p ->> 'lateralidad', ''), nullif(p ->> 'contraccion', ''), v_video, nullif(btrim(p ->> 'consignas'), ''), (select public.yo()))
    returning id into v_id;
    perform _registrar(v_club, 'creó el ejercicio «' || v_nombre || '».');
  else
    select nombre into v_antes from ejercicios where id = p_id and club_id = v_club and eliminado_en is null;
    if v_antes is null then raise exception 'Ese ejercicio ya no existe.'; end if;
    update ejercicios set nombre = v_nombre, categoria = nullif(btrim(p ->> 'categoria'), ''), implemento = nullif(btrim(p ->> 'implemento'), ''),
           lateralidad = nullif(p ->> 'lateralidad', ''), contraccion = nullif(p ->> 'contraccion', ''), video_url = v_video,
           consignas = nullif(btrim(p ->> 'consignas'), ''), actualizado_en = now()
    where id = p_id;
    v_id := p_id;
    perform _registrar(v_club, 'editó el ejercicio «' || v_nombre || '»' || case when v_antes <> v_nombre then ' (antes «' || v_antes || '»)' else '' end || '.');
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.guardar_lugar(p_nombre text, p_direccion text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if nivel_de((select public.yo()), 'calendario') not in ('editar', 'propio') then raise exception 'Sin permiso.'; end if;
  insert into lugares (club_id, nombre, direccion) values (mi_club(), trim(p_nombre), nullif(trim(p_direccion), ''))
  on conflict (club_id, nombre) do update set direccion = coalesce(excluded.direccion, lugares.direccion)
  returning id into v_id;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.guardar_minutos(p_fecha date, p_minutos integer, p_perfil uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_club uuid := mi_club();
begin
  if nivel_de((select public.yo()), 'sports_science') <> 'editar' then raise exception 'Solo quien edita el Sports Science Hub puede cargar minutos.'; end if;
  if p_perfil is null then
    if p_minutos is null then delete from minutos_equipo where club_id = v_club and fecha = p_fecha;
    else insert into minutos_equipo (club_id, fecha, minutos) values (v_club, p_fecha, p_minutos)
         on conflict (club_id, fecha) do update set minutos = excluded.minutos; end if;
  else
    if not exists (select 1 from perfiles where id = p_perfil and club_id = v_club) then raise exception 'Jugador no válido.'; end if;
    if p_minutos is null then delete from minutos_jugador where perfil_id = p_perfil and fecha = p_fecha;
    else insert into minutos_jugador (club_id, perfil_id, fecha, minutos) values (v_club, p_perfil, p_fecha, p_minutos)
         on conflict (perfil_id, fecha) do update set minutos = excluded.minutos; end if;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.guardar_registro(p_item uuid, p_hecho jsonb, p_completado boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_club uuid := mi_club(); i sesion_items; s sesiones;
begin
  select * into i from sesion_items where id = p_item and club_id = v_club and eliminado_en is null;
  if i.id is null or i.tipo not in ('ejercicio', 'pregunta') then raise exception 'Ese ejercicio ya no está en tu plan.'; end if;
  select * into s from sesiones where id = i.sesion_id;
  if _sesion_efectiva((select public.yo()), s.fecha) is distinct from s.id then raise exception 'Ese ejercicio no es de tu plan.'; end if;
  if jsonb_typeof(p_hecho) <> 'array' or jsonb_array_length(p_hecho) > 20 then raise exception 'Datos no válidos.'; end if;
  insert into sesion_registros (perfil_id, item_id, club_id, fecha, ejercicio_id, nombre, prescrito, hecho, completado_en, actualizado_en)
  values ((select public.yo()), i.id, v_club, s.fecha, i.ejercicio_id, i.nombre, i.detalle, p_hecho, case when p_completado then now() end, now())
  on conflict (perfil_id, item_id) do update set
    prescrito = excluded.prescrito, hecho = excluded.hecho, nombre = excluded.nombre, ejercicio_id = excluded.ejercicio_id,
    completado_en = case when p_completado then coalesce(sesion_registros.completado_en, now()) else null end,
    actualizado_en = now();
end $function$
;

CREATE OR REPLACE FUNCTION public.guardar_rpe(p_valor integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_club uuid := mi_club();
begin
  if v_club is null then raise exception 'Sin acceso.'; end if;
  if p_valor < 1 or p_valor > 10 then raise exception 'El RPE va de 1 a 10.'; end if;
  insert into rpe (club_id, perfil_id, fecha, valor) values (v_club, (select public.yo()), hoy_club(v_club), p_valor)
  on conflict (perfil_id, fecha) do update set valor = excluded.valor, actualizado_en = now();
end $function$
;

CREATE OR REPLACE FUNCTION public.guardar_suscripcion(p_endpoint text, p_p256dh text, p_auth text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if mi_club() is null then raise exception 'Sin sesión.'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Suscripción no válida.'; end if;
  insert into push_suscripciones (endpoint, perfil_id, club_id, p256dh, auth)
  values (p_endpoint, (select public.yo()), mi_club(), p_p256dh, p_auth)
  on conflict (endpoint) do update set perfil_id = excluded.perfil_id, club_id = excluded.club_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $function$
;

CREATE OR REPLACE FUNCTION public.guardar_wellness(p_sueno integer, p_fatiga integer, p_estres integer, p_dolor integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_club uuid := mi_club();
begin
  if v_club is null then raise exception 'Sin acceso.'; end if;
  if least(p_sueno, p_fatiga, p_estres, p_dolor) < 1 or greatest(p_sueno, p_fatiga, p_estres, p_dolor) > 5 then
    raise exception 'Valores fuera de escala.';
  end if;
  insert into wellness (club_id, perfil_id, fecha, sueno, fatiga, estres, dolor)
  values (v_club, (select public.yo()), hoy_club(v_club), p_sueno, 6 - p_fatiga, 6 - p_estres, 6 - p_dolor)
  on conflict (perfil_id, fecha) do update set
    sueno = excluded.sueno, fatiga = excluded.fatiga, estres = excluded.estres, dolor = excluded.dolor, actualizado_en = now();
end $function$
;

CREATE OR REPLACE FUNCTION public.historial_ejercicio(p_perfil uuid, p_ejercicio uuid, p_nombre text DEFAULT NULL::text)
 RETURNS TABLE(fecha date, nombre text, prescrito jsonb, hecho jsonb, completado boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if nivel_de((select public.yo()), 'workout_builder') not in ('ver', 'editar') then raise exception 'El historial es solo para el staff.'; end if;
  if not exists (select 1 from perfiles where id = p_perfil and club_id = mi_club()) then raise exception 'Jugador no válido.'; end if;
  return query
  select r.fecha, r.nombre, r.prescrito, r.hecho, r.completado_en is not null
  from sesion_registros r
  where r.perfil_id = p_perfil and r.club_id = mi_club()
    and ((p_ejercicio is not null and r.ejercicio_id = p_ejercicio) or (p_ejercicio is null and lower(r.nombre) = lower(p_nombre)))
  order by r.fecha desc, r.actualizado_en desc
  limit 12;
end $function$
;

CREATE OR REPLACE FUNCTION public.marcar_aplica(p_fecha date, p_cuestionario text, p_aplica boolean, p_perfil uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_club uuid := mi_club();
begin
  if nivel_de((select public.yo()), 'sports_science') <> 'editar' then raise exception 'Solo quien edita el Sports Science Hub puede cambiar esto.'; end if;
  if p_cuestionario not in ('wellness', 'rpe') then raise exception 'Cuestionario no válido.'; end if;
  if p_perfil is not null and not exists (select 1 from perfiles where id = p_perfil and club_id = v_club) then
    raise exception 'Jugador no válido.';
  end if;
  delete from cuestionario_excepciones
  where club_id = v_club and fecha = p_fecha and cuestionario = p_cuestionario and perfil_id is not distinct from p_perfil;
  if p_aplica is not null then
    insert into cuestionario_excepciones (club_id, fecha, cuestionario, perfil_id, aplica)
    values (v_club, p_fecha, p_cuestionario, p_perfil, p_aplica);
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.mi_club()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.club_id from perfiles p join clubs c on c.id = p.club_id
  where p.id = (select public.yo()) and p.eliminado_en is null and c.estado = 'activa'
$function$
;

CREATE OR REPLACE FUNCTION public.mi_token_calendario(p_regenerar boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v text;
begin
  if mi_club() is null then raise exception 'Sin acceso.'; end if;
  if p_regenerar then delete from calendario_tokens where perfil_id = (select public.yo()); end if;
  insert into calendario_tokens (perfil_id) values ((select public.yo())) on conflict (perfil_id) do nothing;
  select token into v from calendario_tokens where perfil_id = (select public.yo());
  return v;
end $function$
;

CREATE OR REPLACE FUNCTION public.puede_ver_entreno(p_perfil uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from perfiles p where p.id = p_perfil and p.club_id = mi_club() and p.eliminado_en is null)
     and (p_perfil = (select public.yo()) or nivel_de((select public.yo()), 'workout_builder') in ('ver', 'editar'))
$function$
;

CREATE OR REPLACE FUNCTION public.registrar_adjunto(p_actividad uuid, p_ruta text, p_nombre text, p_tipo text, p_bytes integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_club uuid := mi_club(); v_id uuid; v_act text;
begin
  if not puede_editar_actividad((select public.yo()), p_actividad) then raise exception 'No podés adjuntar archivos a esta actividad.'; end if;
  if p_ruta not like v_club || '/' || p_actividad || '/%' then raise exception 'Archivo no válido.'; end if;
  if p_tipo not in ('image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf') then raise exception 'Solo imágenes o PDF.'; end if;
  if (select count(*) from actividad_adjuntos where actividad_id = p_actividad) >= 10 then raise exception 'Máximo 10 archivos por actividad.'; end if;
  insert into actividad_adjuntos (actividad_id, club_id, ruta, nombre, tipo, bytes, subido_por)
  values (p_actividad, v_club, p_ruta, left(btrim(p_nombre), 200), p_tipo, p_bytes, (select public.yo())) returning id into v_id;
  select nombre into v_act from actividades where id = p_actividad;
  perform _registrar(v_club, 'adjuntó «' || left(btrim(p_nombre), 80) || '» a la actividad «' || v_act || '».');
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.responder_actividad(p_id uuid, p_estado text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_estado not in ('acepta', 'no_puede') then raise exception 'Respuesta no válida.'; end if;
  update actividad_confirmaciones set estado = p_estado, respondido_en = now()
  where actividad_id = p_id and perfil_id = (select public.yo());
  if not found then raise exception 'Esta actividad no te pide confirmación.'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.soy_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select es_admin from perfiles where id = (select public.yo()) and eliminado_en is null), false)
$function$
;

CREATE OR REPLACE FUNCTION public.ve_sesion(p_sesion uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from sesiones s
    where s.id = p_sesion and s.club_id = mi_club()
      and (nivel_de((select public.yo()), 'workout_builder') in ('ver', 'editar')
           or (nivel_de((select public.yo()), 'workout_builder') = 'propio' and (select public.yo()) in (select personas_de_sesion(s.id))))
  )
$function$
;

CREATE OR REPLACE FUNCTION public.ve_sports_science_club()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from perfiles p join roles r on r.id = p.rol_id
    where p.id = (select public.yo()) and p.eliminado_en is null
      and (p.es_admin or (not r.es_jugador and nivel_de(p.id, 'sports_science') in ('ver', 'editar')))
  )
$function$
;
drop policy if exists adjuntos_ver on public.actividad_adjuntos;
create policy adjuntos_ver on public.actividad_adjuntos as PERMISSIVE for SELECT to public using (((club_id = mi_club()) AND ve_actividad((select public.yo()), actividad_id)));
drop policy if exists confirmaciones_ver on public.actividad_confirmaciones;
create policy confirmaciones_ver on public.actividad_confirmaciones as PERMISSIVE for SELECT to public using (ve_actividad((select public.yo()), actividad_id));
drop policy if exists destinos_ver on public.actividad_destinos;
create policy destinos_ver on public.actividad_destinos as PERMISSIVE for SELECT to public using (ve_actividad((select public.yo()), actividad_id));
drop policy if exists actividades_ver on public.actividades;
create policy actividades_ver on public.actividades as PERMISSIVE for SELECT to public using (((club_id = mi_club()) AND ve_actividad((select public.yo()), id)));
drop policy if exists tokens_ver on public.calendario_tokens;
create policy tokens_ver on public.calendario_tokens as PERMISSIVE for SELECT to public using ((perfil_id = (select public.yo())));
drop policy if exists excepciones_ver on public.cuestionario_excepciones;
create policy excepciones_ver on public.cuestionario_excepciones as PERMISSIVE for SELECT to public using (((club_id = mi_club()) AND ((perfil_id IS NULL) OR (perfil_id = (select public.yo())) OR ve_sports_science_club())));
drop policy if exists ejercicios_ver on public.ejercicios;
create policy ejercicios_ver on public.ejercicios as PERMISSIVE for SELECT to public using (((club_id = mi_club()) AND (nivel_de((select public.yo()), 'workout_builder'::text) <> 'sin'::text)));
drop policy if exists minutos_jugador_ver on public.minutos_jugador;
create policy minutos_jugador_ver on public.minutos_jugador as PERMISSIVE for SELECT to public using (((club_id = mi_club()) AND ((perfil_id = (select public.yo())) OR ve_sports_science_club())));
drop policy if exists push_ver on public.push_suscripciones;
create policy push_ver on public.push_suscripciones as PERMISSIVE for SELECT to public using ((perfil_id = (select public.yo())));
drop policy if exists rpe_ver on public.rpe;
create policy rpe_ver on public.rpe as PERMISSIVE for SELECT to public using (((club_id = mi_club()) AND ((perfil_id = (select public.yo())) OR ve_sports_science_club())));
drop policy if exists registros_ver on public.sesion_registros;
create policy registros_ver on public.sesion_registros as PERMISSIVE for SELECT to public using (((club_id = mi_club()) AND ((perfil_id = (select public.yo())) OR (nivel_de((select public.yo()), 'workout_builder'::text) = ANY (ARRAY['ver'::text, 'editar'::text])))));
drop policy if exists wellness_ver on public.wellness;
create policy wellness_ver on public.wellness as PERMISSIVE for SELECT to public using (((club_id = mi_club()) AND ((perfil_id = (select public.yo())) OR ve_sports_science_club())));
drop policy if exists adjuntos_archivo_borrar on storage.objects;
create policy adjuntos_archivo_borrar on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'adjuntos'::text) AND ((storage.foldername(name))[1] = (mi_club())::text) AND puede_editar_actividad((select public.yo()), _uuid_o_nulo((storage.foldername(name))[2]))));
drop policy if exists adjuntos_archivo_subir on storage.objects;
create policy adjuntos_archivo_subir on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'adjuntos'::text) AND ((storage.foldername(name))[1] = (mi_club())::text) AND puede_editar_actividad((select public.yo()), _uuid_o_nulo((storage.foldername(name))[2]))));
drop policy if exists adjuntos_archivo_ver on storage.objects;
create policy adjuntos_archivo_ver on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'adjuntos'::text) AND ((storage.foldername(name))[1] = (mi_club())::text) AND ve_actividad((select public.yo()), _uuid_o_nulo((storage.foldername(name))[2]))));

commit;

-- Comprobación: tiene que mostrar tus organizaciones (por ahora, una sola).
select c.nombre as organizacion, r.nombre as rol, p.es_admin
from public.perfiles p join public.clubs c on c.id = p.club_id join public.roles r on r.id = p.rol_id
where p.user_id = (select user_id from public.duenos_plataforma limit 1) and p.eliminado_en is null;
