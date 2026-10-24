-- =====================================================================
-- Módulo 2 · Calendario
-- Pegar entero en Supabase → SQL Editor → Run (después del 001 y 002). Una sola vez.
-- =====================================================================

alter table public.clubs add column zona_horaria text not null default 'Europe/Madrid';

-- ---------- Tablas ----------

create table public.lugares (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  nombre text not null,
  direccion text,
  creado_en timestamptz not null default now(),
  unique (club_id, nombre)
);

create table public.actividades (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  nombre text not null,
  tipo text not null check (tipo in ('deportiva', 'logistica', 'prensa')),
  fecha date not null,
  todo_el_dia boolean not null default false,
  hora_inicio time,
  hora_fin time,
  lugar text,
  direccion text,
  es_partido boolean not null default false,
  rival text,
  fuera boolean not null default false,
  creado_por uuid references public.perfiles(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  check (todo_el_dia or hora_inicio is not null)
);
create index actividades_club_fecha on public.actividades (club_id, fecha) where eliminado_en is null;

-- A quién va: etiquetas grandes, grupos o personas sueltas.
create table public.actividad_destinos (
  actividad_id uuid not null references public.actividades(id) on delete cascade,
  tipo text not null check (tipo in ('equipo', 'staff', 'clevel', 'prensa', 'grupo', 'persona')),
  ref uuid,
  unique (actividad_id, tipo, ref)
);

-- Solo para actividades de prensa: cada persona acepta o dice que no puede.
create table public.actividad_confirmaciones (
  actividad_id uuid not null references public.actividades(id) on delete cascade,
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'acepta', 'no_puede')),
  respondido_en timestamptz,
  primary key (actividad_id, perfil_id)
);

-- Enlace privado para suscribirse desde Google o Apple Calendar.
create table public.calendario_tokens (
  perfil_id uuid primary key references public.perfiles(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  creado_en timestamptz not null default now()
);

-- ---------- Ayudas ----------

-- Nivel efectivo de una persona en un módulo (admin = editar).
create or replace function public.nivel_de(p_perfil uuid, p_modulo text) returns text
language sql stable security definer set search_path = public as $$
  select case when p.es_admin then 'editar'
              else coalesce(p.permisos_ajustados -> p_modulo ->> 'nivel', r.permisos -> p_modulo ->> 'nivel', 'sin') end
  from perfiles p join roles r on r.id = p.rol_id
  where p.id = p_perfil and p.eliminado_en is null
$$;

create or replace function public.exporta_de(p_perfil uuid, p_modulo text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p.es_admin then true
              else coalesce((p.permisos_ajustados -> p_modulo ->> 'exporta')::boolean, (r.permisos -> p_modulo ->> 'exporta')::boolean, false) end
  from perfiles p join roles r on r.id = p.rol_id
  where p.id = p_perfil and p.eliminado_en is null
$$;

-- Personas a las que va una actividad.
create or replace function public.personas_de_actividad(p_act uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct p.id
  from actividades a
  join actividad_destinos d on d.actividad_id = a.id
  join perfiles p on p.club_id = a.club_id and p.eliminado_en is null
  join roles r on r.id = p.rol_id
  where a.id = p_act and (
       (d.tipo = 'equipo' and r.es_jugador)
    or (d.tipo = 'staff' and not r.es_jugador and r.clave not in ('clevel', 'prensa'))
    or (d.tipo = 'clevel' and r.clave = 'clevel')
    or (d.tipo = 'prensa' and r.clave = 'prensa')
    or (d.tipo = 'persona' and d.ref = p.id)
    or (d.tipo = 'grupo' and exists (select 1 from grupo_miembros m where m.grupo_id = d.ref and m.perfil_id = p.id))
  )
$$;

-- ¿Puede esta persona ver esta actividad?
-- Staff con acceso al calendario: ve todo. Jugadores: solo lo que va para ellos.
create or replace function public.ve_actividad(p_perfil uuid, p_act uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from actividades a
    join perfiles p on p.id = p_perfil and p.club_id = a.club_id and p.eliminado_en is null
    join roles r on r.id = p.rol_id
    where a.id = p_act and a.eliminado_en is null
      and nivel_de(p.id, 'calendario') <> 'sin'
      and (not r.es_jugador or p.es_admin or a.creado_por = p.id
           or p.id in (select personas_de_actividad(a.id)))
  )
$$;

-- ---------- Seguridad por filas ----------

alter table public.lugares enable row level security;
alter table public.actividades enable row level security;
alter table public.actividad_destinos enable row level security;
alter table public.actividad_confirmaciones enable row level security;
alter table public.calendario_tokens enable row level security;

create policy lugares_ver on public.lugares for select using (club_id = public.mi_club());
create policy actividades_ver on public.actividades for select
  using (club_id = public.mi_club() and public.ve_actividad(auth.uid(), id));
create policy destinos_ver on public.actividad_destinos for select
  using (public.ve_actividad(auth.uid(), actividad_id));
create policy confirmaciones_ver on public.actividad_confirmaciones for select
  using (public.ve_actividad(auth.uid(), actividad_id));
create policy tokens_ver on public.calendario_tokens for select using (perfil_id = auth.uid());

-- ---------- Escrituras ----------

create or replace function public.guardar_actividad(p_id uuid, p_datos jsonb, p_destinos jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_club uuid := mi_club(); v_nivel text := nivel_de(auth.uid(), 'calendario');
  a actividades; v_id uuid; v_cambio_horario boolean := false; d jsonb;
begin
  if v_club is null then raise exception 'Sin acceso.'; end if;
  if v_nivel not in ('editar', 'propio') then raise exception 'No tienes permiso para crear actividades.'; end if;
  if coalesce(trim(p_datos ->> 'nombre'), '') = '' then raise exception 'Falta el nombre.'; end if;

  if p_id is not null then
    select * into a from actividades where id = p_id and club_id = v_club and eliminado_en is null for update;
    if not found then raise exception 'Actividad no encontrada.'; end if;
    if v_nivel = 'propio' and a.creado_por is distinct from auth.uid() then
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
      coalesce((p_datos ->> 'fuera')::boolean, false), auth.uid())
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
    where x <> auth.uid()
    on conflict do nothing;
  else
    delete from actividad_confirmaciones where actividad_id = v_id;
  end if;

  return v_id;
end $$;

create or replace function public.eliminar_actividad(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a actividades; v_nivel text := nivel_de(auth.uid(), 'calendario');
begin
  select * into a from actividades where id = p_id and club_id = mi_club() and eliminado_en is null;
  if not found then raise exception 'Actividad no encontrada.'; end if;
  if not (v_nivel = 'editar' or (v_nivel = 'propio' and a.creado_por = auth.uid())) then
    raise exception 'No puedes eliminar esta actividad.';
  end if;
  update actividades set eliminado_en = now() where id = p_id;
end $$;

create or replace function public.responder_actividad(p_id uuid, p_estado text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_estado not in ('acepta', 'no_puede') then raise exception 'Respuesta no válida.'; end if;
  update actividad_confirmaciones set estado = p_estado, respondido_en = now()
  where actividad_id = p_id and perfil_id = auth.uid();
  if not found then raise exception 'Esta actividad no te pide confirmación.'; end if;
end $$;

create or replace function public.guardar_lugar(p_nombre text, p_direccion text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if nivel_de(auth.uid(), 'calendario') not in ('editar', 'propio') then raise exception 'Sin permiso.'; end if;
  insert into lugares (club_id, nombre, direccion) values (mi_club(), trim(p_nombre), nullif(trim(p_direccion), ''))
  on conflict (club_id, nombre) do update set direccion = coalesce(excluded.direccion, lugares.direccion)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.eliminar_lugar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if nivel_de(auth.uid(), 'calendario') not in ('editar', 'propio') then raise exception 'Sin permiso.'; end if;
  delete from lugares where id = p_id and club_id = mi_club();
end $$;

-- ---------- Suscripción a Google / Apple Calendar ----------

create or replace function public.mi_token_calendario(p_regenerar boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if mi_club() is null then raise exception 'Sin acceso.'; end if;
  if p_regenerar then delete from calendario_tokens where perfil_id = auth.uid(); end if;
  insert into calendario_tokens (perfil_id) values (auth.uid()) on conflict (perfil_id) do nothing;
  select token into v from calendario_tokens where perfil_id = auth.uid();
  return v;
end $$;

-- Lo llama el servidor de la app (sin sesión) con el token privado de la persona.
create or replace function public.ics_eventos(p_token text)
returns table (id uuid, nombre text, tipo text, fecha date, todo_el_dia boolean, hora_inicio time, hora_fin time,
               lugar text, direccion text, es_partido boolean, rival text, fuera boolean,
               actualizado_en timestamptz, zona_horaria text, club text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_perfil uuid;
begin
  select t.perfil_id into v_perfil from calendario_tokens t
  join perfiles p on p.id = t.perfil_id and p.eliminado_en is null
  join clubs c on c.id = p.club_id and c.estado = 'activa'
  where t.token = p_token;
  if v_perfil is null then return; end if;
  return query
  select a.id, a.nombre, a.tipo, a.fecha, a.todo_el_dia, a.hora_inicio, a.hora_fin, a.lugar, a.direccion,
         a.es_partido, a.rival, a.fuera, a.actualizado_en, c.zona_horaria, c.nombre
  from actividades a join clubs c on c.id = a.club_id
  where a.club_id = (select club_id from perfiles where id = v_perfil)
    and a.eliminado_en is null
    and a.fecha between current_date - 30 and current_date + 180
    and ve_actividad(v_perfil, a.id)
  order by a.fecha, a.hora_inicio;
end $$;

-- ---------- Permisos de ejecución ----------

revoke all on function public.nivel_de(uuid, text) from public, anon;
revoke all on function public.exporta_de(uuid, text) from public, anon;
revoke all on function public.personas_de_actividad(uuid) from public, anon;
revoke all on function public.ve_actividad(uuid, uuid) from public, anon;
grant execute on function public.nivel_de(uuid, text) to authenticated;
grant execute on function public.exporta_de(uuid, text) to authenticated;
grant execute on function public.personas_de_actividad(uuid) to authenticated;
grant execute on function public.ve_actividad(uuid, uuid) to authenticated;
grant execute on function public.guardar_actividad(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.eliminar_actividad(uuid) to authenticated;
grant execute on function public.responder_actividad(uuid, text) to authenticated;
grant execute on function public.guardar_lugar(text, text) to authenticated;
grant execute on function public.eliminar_lugar(uuid) to authenticated;
grant execute on function public.mi_token_calendario(boolean) to authenticated;
grant execute on function public.ics_eventos(text) to anon, authenticated;

-- ---------- Exportar club: incluir el calendario ----------

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
    'lugares', (select coalesce(jsonb_agg(to_jsonb(l)), '[]') from lugares l where l.club_id = v_club),
    'actividades', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from actividades a where a.club_id = v_club),
    'actividad_destinos', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from actividad_destinos d join actividades a on a.id = d.actividad_id where a.club_id = v_club),
    'actividad_confirmaciones', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from actividad_confirmaciones x join actividades a on a.id = x.actividad_id where a.club_id = v_club),
    'registro_cambios', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from registro_cambios x where x.club_id = v_club)
  ) into v;
  perform _registrar(v_club, 'exportó todos los datos del club.');
  return v;
end $$;

-- Lugar habitual del Casademont como primer lugar guardado.
insert into public.lugares (club_id, nombre)
select id, sede_local from public.clubs where sede_local is not null
on conflict do nothing;
