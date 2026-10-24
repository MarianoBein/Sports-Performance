-- =====================================================================
-- Módulo 1b · Capa de dueño de la plataforma y exportación del club
-- Pegar entero en Supabase → SQL Editor → Run (después del 001). Una sola vez.
-- El dueño ve cada organización por separado (nombre, plan, cantidad de
-- personas, actividad y contacto del administrador), nunca sus datos internos.
-- =====================================================================

-- ---------- Organizaciones: tipo, plan y estado ----------

alter table public.clubs
  add column tipo text not null default 'club' check (tipo in ('club', 'entrenamiento_online', 'otro')),
  add column plan text not null default 'prueba' check (plan in ('prueba', 'regalo', 'pago')),
  add column estado text not null default 'activa' check (estado in ('activa', 'suspendida', 'baja')),
  add column notas_dueno text;

-- Un club suspendido o dado de baja deja de tener acceso (sus datos se conservan).
create or replace function public.mi_club() returns uuid
language sql stable security definer set search_path = public as $$
  select p.club_id from perfiles p join clubs c on c.id = p.club_id
  where p.id = auth.uid() and p.eliminado_en is null and c.estado = 'activa'
$$;

-- ---------- Dueños de la plataforma ----------

create table public.duenos_plataforma (
  email text primary key,
  creado_en timestamptz not null default now()
);
alter table public.duenos_plataforma enable row level security;  -- sin políticas: nadie la lee desde la app

insert into public.duenos_plataforma (email) values ('marianobein1993@gmail.com');

create or replace function public.soy_dueno() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from duenos_plataforma d join auth.users u on lower(u.email) = lower(d.email)
    where u.id = auth.uid()
  )
$$;

-- ---------- Roles base (los mismos para cada organización nueva) ----------

create or replace function public._crear_roles_base(p_club uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  sin jsonb := '{"nivel":"sin","exporta":false}';
  ver jsonb := '{"nivel":"ver","exporta":false}';
  pro jsonb := '{"nivel":"propio","exporta":false}';
  edi jsonb := '{"nivel":"editar","exporta":false}';
begin
  insert into roles (club_id, clave, nombre, es_jugador, permisos) values
  (p_club, 'principal', 'Entrenador principal', false, jsonb_build_object('calendario', ver, 'sports_science', ver, 'workout_builder', sin, 'estadisticas', ver, 'usuarios', sin)),
  (p_club, 'ayudante',  'Entrenador ayudante',  false, jsonb_build_object('calendario', ver, 'sports_science', ver, 'workout_builder', sin, 'estadisticas', ver, 'usuarios', sin)),
  (p_club, 'skills',    'Entrenador de skills', false, jsonb_build_object('calendario', ver, 'sports_science', ver, 'workout_builder', sin, 'estadisticas', ver, 'usuarios', sin)),
  (p_club, 'pf',        'Preparador físico',    false, jsonb_build_object('calendario', pro, 'sports_science', edi, 'workout_builder', edi, 'estadisticas', sin, 'usuarios', sin)),
  (p_club, 'fisio',     'Fisioterapeuta',       false, jsonb_build_object('calendario', pro, 'sports_science', edi, 'workout_builder', edi, 'estadisticas', sin, 'usuarios', sin)),
  (p_club, 'delegado',  'Delegado',             false, jsonb_build_object('calendario', '{"nivel":"propio","exporta":true}'::jsonb, 'sports_science', sin, 'workout_builder', sin, 'estadisticas', sin, 'usuarios', sin)),
  (p_club, 'utilero',   'Utilero',              false, jsonb_build_object('calendario', ver, 'sports_science', sin, 'workout_builder', sin, 'estadisticas', sin, 'usuarios', sin)),
  (p_club, 'clevel',    'C-level',              false, jsonb_build_object('calendario', ver, 'sports_science', ver, 'workout_builder', sin, 'estadisticas', sin, 'usuarios', sin)),
  (p_club, 'prensa',    'Prensa y sponsors',    false, jsonb_build_object('calendario', pro, 'sports_science', sin, 'workout_builder', sin, 'estadisticas', sin, 'usuarios', sin)),
  (p_club, 'jugador',   'Jugador',              true,  jsonb_build_object('calendario', ver, 'sports_science', pro, 'workout_builder', pro, 'estadisticas', sin, 'usuarios', sin));
end $$;
revoke all on function public._crear_roles_base(uuid) from public, anon, authenticated;

-- ---------- Panel del dueño ----------

create or replace function public.plataforma_organizaciones()
returns table (
  id uuid, nombre text, tipo text, plan text, estado text, sede_local text, notas_dueno text,
  creado_en timestamptz, personas integer, jugadores integer,
  admins text, ultima_actividad timestamptz
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not soy_dueno() then raise exception 'Solo el dueño de la plataforma.'; end if;
  return query
  select c.id, c.nombre, c.tipo, c.plan, c.estado, c.sede_local, c.notas_dueno, c.creado_en,
    (select count(*)::int from perfiles p where p.club_id = c.id and p.eliminado_en is null),
    (select count(*)::int from perfiles p join roles r on r.id = p.rol_id
       where p.club_id = c.id and p.eliminado_en is null and r.es_jugador),
    (select string_agg(p.nombre || ' <' || p.email || '>', ', ') from perfiles p
       where p.club_id = c.id and p.es_admin and p.eliminado_en is null),
    greatest(
      (select max(rc.creado_en) from registro_cambios rc where rc.club_id = c.id),
      (select max(p.creado_en) from perfiles p where p.club_id = c.id),
      c.creado_en)
  from clubs c
  order by c.creado_en desc;
end $$;

create or replace function public._codigo_admin(p_club uuid, p_rol_clave text) returns text
language plpgsql security definer set search_path = public as $$
declare v_rol uuid; v_codigo text; v_prefijo text; v_alfabeto text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  select id into v_rol from roles where club_id = p_club and clave = coalesce(p_rol_clave, 'principal');
  if v_rol is null then select id into v_rol from roles where club_id = p_club and clave = 'principal'; end if;
  select upper(string_agg(left(w, 1), '')) into v_prefijo
    from (select w from regexp_split_to_table((select nombre from clubs where id = p_club), '\s+') w limit 2) x;
  loop
    v_codigo := coalesce(v_prefijo, 'CL') || '-ADMIN-';
    for i in 1..4 loop
      v_codigo := v_codigo || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    end loop;
    exit when not exists (select 1 from codigos_alta where codigo = v_codigo);
  end loop;
  insert into codigos_alta (club_id, codigo, rol_id, da_admin, usos_max, caduca_en)
  values (p_club, v_codigo, v_rol, true, 1, now() + interval '14 days');
  return v_codigo;
end $$;
revoke all on function public._codigo_admin(uuid, text) from public, anon, authenticated;

create or replace function public.plataforma_crear_organizacion(
  p_nombre text, p_tipo text, p_plan text, p_sede text, p_rol_admin text)
returns table (club_id uuid, codigo text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_club uuid; v_codigo text;
begin
  if not soy_dueno() then raise exception 'Solo el dueño de la plataforma.'; end if;
  insert into clubs (nombre, tipo, plan, sede_local, temporada)
  values (trim(p_nombre), p_tipo, p_plan, nullif(trim(p_sede), ''), null)
  returning id into v_club;
  perform _crear_roles_base(v_club);
  v_codigo := _codigo_admin(v_club, p_rol_admin);
  insert into registro_cambios (club_id, actor_nombre, accion)
  values (v_club, 'Plataforma', 'creó la organización y el código del primer administrador.');
  return query select v_club, v_codigo;
end $$;

create or replace function public.plataforma_nuevo_codigo_admin(p_club uuid, p_rol_admin text default 'principal')
returns text
language plpgsql security definer set search_path = public as $$
declare v_codigo text;
begin
  if not soy_dueno() then raise exception 'Solo el dueño de la plataforma.'; end if;
  if not exists (select 1 from clubs where id = p_club) then raise exception 'Organización no encontrada.'; end if;
  v_codigo := _codigo_admin(p_club, p_rol_admin);
  insert into registro_cambios (club_id, actor_nombre, accion)
  values (p_club, 'Plataforma', 'generó un código de administrador (' || v_codigo || ').');
  return v_codigo;
end $$;

create or replace function public.plataforma_actualizar_organizacion(
  p_club uuid, p_plan text, p_estado text, p_notas text)
returns void
language plpgsql security definer set search_path = public as $$
declare c clubs;
begin
  if not soy_dueno() then raise exception 'Solo el dueño de la plataforma.'; end if;
  select * into c from clubs where id = p_club;
  if not found then raise exception 'Organización no encontrada.'; end if;
  update clubs set plan = p_plan, estado = p_estado, notas_dueno = p_notas where id = p_club;
  if c.estado is distinct from p_estado then
    insert into registro_cambios (club_id, actor_nombre, accion)
    values (p_club, 'Plataforma', 'cambió el estado de la organización: ' || c.estado || ' → ' || p_estado || '.');
  end if;
  if c.plan is distinct from p_plan then
    insert into registro_cambios (club_id, actor_nombre, accion)
    values (p_club, 'Plataforma', 'cambió el plan: ' || c.plan || ' → ' || p_plan || '.');
  end if;
end $$;

-- ---------- Exportar todo el club (para su administrador) ----------
-- Cada módulo nuevo agregará aquí sus tablas.

create or replace function public.exportar_club() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v jsonb;
begin
  if not soy_admin() then raise exception 'Solo un administrador puede exportar los datos del club.'; end if;
  select jsonb_build_object(
    'exportado_en', now(),
    'club', (select to_jsonb(c) - 'notas_dueno' from clubs c where c.id = v_club),
    'roles', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from roles r where r.club_id = v_club),
    'personas', (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from perfiles p where p.club_id = v_club),
    'grupos', (select coalesce(jsonb_agg(to_jsonb(g)), '[]') from grupos g where g.club_id = v_club),
    'grupo_miembros', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from grupo_miembros m join grupos g on g.id = m.grupo_id where g.club_id = v_club),
    'registro_cambios', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from registro_cambios x where x.club_id = v_club)
  ) into v;
  perform _registrar(v_club, 'exportó todos los datos del club.');
  return v;
end $$;

-- ---------- Permisos de ejecución ----------

grant execute on function public.soy_dueno() to authenticated;
grant execute on function public.plataforma_organizaciones() to authenticated;
grant execute on function public.plataforma_crear_organizacion(text, text, text, text, text) to authenticated;
grant execute on function public.plataforma_nuevo_codigo_admin(uuid, text) to authenticated;
grant execute on function public.plataforma_actualizar_organizacion(uuid, text, text, text) to authenticated;
grant execute on function public.exportar_club() to authenticated;

update public.clubs set tipo = 'club', plan = 'prueba' where nombre = 'Casademont Zaragoza';
