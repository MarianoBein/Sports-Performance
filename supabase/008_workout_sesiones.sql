-- =====================================================================
-- Módulo 4 · Workout Builder (parte 2): armado de la semana.
-- Pegar entero en Supabase → SQL Editor → Run (después del 007). Una sola vez.
--
-- Una «sesión» = el trabajo de un día para un conjunto de destinatarios
-- (equipo, grupos o jugadores). Cada ejercicio de la sesión es un «item».
-- =====================================================================

create table public.sesiones (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  fecha date not null,
  destinos jsonb not null,                 -- [{"tipo":"equipo"} | {"tipo":"grupo","ref":uuid} | {"tipo":"persona","ref":uuid}]
  destinos_clave text not null,            -- forma canónica de destinos, para encontrar «el mismo plan»
  creado_por uuid references public.perfiles(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (club_id, fecha, destinos_clave)
);
create index sesiones_club_fecha on public.sesiones (club_id, fecha);

create table public.sesion_items (
  id uuid primary key,                     -- lo genera la app, para poder copiar, pegar y deshacer
  sesion_id uuid not null references public.sesiones(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  orden smallint not null default 0,
  bloque text not null default 'Bloque principal' check (length(bloque) between 1 and 60),
  ejercicio_id uuid references public.ejercicios(id),
  nombre text not null check (length(nombre) between 1 and 120),   -- copia del nombre al programarlo
  series smallint not null check (series between 1 and 20),
  reps text check (reps is null or length(reps) <= 20),            -- «8», «30 s», «8-10»…
  cada_lado boolean not null default false,
  con_carga boolean not null default false,
  detalle jsonb not null default '[]',      -- una fila por serie: [{"reps":"8","kg":60}] (kg vacío = null)
  descanso_seg smallint check (descanso_seg is null or descanso_seg between 0 and 3600),
  nota text check (nota is null or length(nota) <= 1000),
  eliminado_en timestamptz
);
create index sesion_items_sesion on public.sesion_items (sesion_id, orden) where eliminado_en is null;

-- ¿Quiénes reciben una sesión?
create or replace function public.personas_de_sesion(p_sesion uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct p.id
  from sesiones s
  cross join lateral jsonb_array_elements(s.destinos) d
  join perfiles p on p.club_id = s.club_id and p.eliminado_en is null
  join roles r on r.id = p.rol_id and r.es_jugador
  where s.id = p_sesion and (
       d ->> 'tipo' = 'equipo'
    or (d ->> 'tipo' = 'persona' and (d ->> 'ref')::uuid = p.id)
    or (d ->> 'tipo' = 'grupo' and exists (select 1 from grupo_miembros m where m.grupo_id = (d ->> 'ref')::uuid and m.perfil_id = p.id))
  )
$$;

create or replace function public.ve_sesion(p_sesion uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from sesiones s
    where s.id = p_sesion and s.club_id = mi_club()
      and (nivel_de(auth.uid(), 'workout_builder') in ('ver', 'editar')
           or (nivel_de(auth.uid(), 'workout_builder') = 'propio' and auth.uid() in (select personas_de_sesion(s.id))))
  )
$$;

alter table public.sesiones enable row level security;
alter table public.sesion_items enable row level security;
create policy sesiones_ver on public.sesiones for select using (club_id = public.mi_club() and public.ve_sesion(id));
create policy sesion_items_ver on public.sesion_items for select using (club_id = public.mi_club() and public.ve_sesion(sesion_id));

-- Valida los destinatarios y devuelve la clave canónica (o un error).
create or replace function public._clave_destinos(p_club uuid, p_destinos jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare d jsonb; partes text[] := '{}'; v_ref uuid;
begin
  if jsonb_typeof(p_destinos) <> 'array' or jsonb_array_length(p_destinos) = 0 then
    raise exception 'Elegí para quién es: equipo, grupo o jugador.';
  end if;
  for d in select * from jsonb_array_elements(p_destinos) loop
    if d ->> 'tipo' = 'equipo' then
      partes := array_append(partes, 'equipo');
    elsif d ->> 'tipo' = 'grupo' then
      v_ref := (d ->> 'ref')::uuid;
      if not exists (select 1 from grupos where id = v_ref and club_id = p_club) then raise exception 'Grupo no válido.'; end if;
      partes := array_append(partes, 'grupo:' || v_ref);
    elsif d ->> 'tipo' = 'persona' then
      v_ref := (d ->> 'ref')::uuid;
      if not exists (select 1 from perfiles p join roles r on r.id = p.rol_id
                     where p.id = v_ref and p.club_id = p_club and p.eliminado_en is null and r.es_jugador) then
        raise exception 'Jugador no válido.';
      end if;
      partes := array_append(partes, 'persona:' || v_ref);
    else
      raise exception 'Destino no válido.';
    end if;
  end loop;
  return (select string_agg(x, ',' order by x collate "C") from (select distinct unnest(partes) x) t);
end $$;

-- Guarda el día entero de un plan: lo que no venga en la lista se quita.
create or replace function public.guardar_dia(p_fecha date, p_destinos jsonb, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_club uuid := mi_club(); v_clave text; v_sesion uuid; it jsonb; i int := 0; v_ids uuid[] := '{}';
  v_id uuid; v_ej uuid; v_series int; v_nuevo boolean := false;
begin
  if v_club is null or nivel_de(auth.uid(), 'workout_builder') <> 'editar' then
    raise exception 'Solo quien edita el Workout Builder puede armar sesiones.';
  end if;
  if p_fecha is null then raise exception 'Falta la fecha.'; end if;
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' or jsonb_array_length(coalesce(p_items, '[]')) > 60 then
    raise exception 'Demasiados ejercicios para un día (máximo 60).';
  end if;
  v_clave := _clave_destinos(v_club, p_destinos);

  select id into v_sesion from sesiones where club_id = v_club and fecha = p_fecha and destinos_clave = v_clave;
  if v_sesion is null then
    if jsonb_array_length(coalesce(p_items, '[]')) = 0 then return; end if;
    insert into sesiones (club_id, fecha, destinos, destinos_clave, creado_por)
    values (v_club, p_fecha, p_destinos, v_clave, auth.uid()) returning id into v_sesion;
    v_nuevo := true;
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    v_id := (it ->> 'id')::uuid;
    v_ej := nullif(it ->> 'ejercicio_id', '')::uuid;
    v_series := (it ->> 'series')::int;
    if v_id is null then raise exception 'Falta el identificador de un ejercicio.'; end if;
    if exists (select 1 from sesion_items where id = v_id and sesion_id <> v_sesion) then
      -- Venía de otro día o de otro plan: se mueve aquí.
      if not exists (select 1 from sesion_items where id = v_id and club_id = v_club) then raise exception 'Ejercicio no válido.'; end if;
    end if;
    if v_ej is not null and not exists (select 1 from ejercicios where id = v_ej and club_id = v_club) then
      raise exception 'Ejercicio no válido.';
    end if;
    if v_series is null or v_series < 1 or v_series > 20 then raise exception 'Las series van de 1 a 20.'; end if;
    insert into sesion_items (id, sesion_id, club_id, orden, bloque, ejercicio_id, nombre, series, reps, cada_lado, con_carga, detalle, descanso_seg, nota, eliminado_en)
    values (v_id, v_sesion, v_club, i, coalesce(nullif(btrim(it ->> 'bloque'), ''), 'Bloque principal'), v_ej, btrim(it ->> 'nombre'),
            v_series, nullif(btrim(it ->> 'reps'), ''), coalesce((it ->> 'cada_lado')::boolean, false), coalesce((it ->> 'con_carga')::boolean, false),
            coalesce(it -> 'detalle', '[]'), nullif(it ->> 'descanso_seg', '')::int, nullif(btrim(it ->> 'nota'), ''), null)
    on conflict (id) do update set
      sesion_id = excluded.sesion_id, orden = excluded.orden, bloque = excluded.bloque, ejercicio_id = excluded.ejercicio_id,
      nombre = excluded.nombre, series = excluded.series, reps = excluded.reps, cada_lado = excluded.cada_lado,
      con_carga = excluded.con_carga, detalle = excluded.detalle, descanso_seg = excluded.descanso_seg, nota = excluded.nota,
      eliminado_en = null
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
end $$;

revoke all on function public.personas_de_sesion(uuid) from public, anon;
revoke all on function public.ve_sesion(uuid) from public, anon;
revoke all on function public._clave_destinos(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.guardar_dia(date, jsonb, jsonb) from public, anon;
grant execute on function public.personas_de_sesion(uuid) to authenticated;
grant execute on function public.ve_sesion(uuid) to authenticated;
grant execute on function public.guardar_dia(date, jsonb, jsonb) to authenticated;

-- ---------- Exportar club: con las sesiones ----------

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
    'wellness', (select coalesce(jsonb_agg(to_jsonb(w)), '[]') from wellness w where w.club_id = v_club),
    'rpe', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from rpe r where r.club_id = v_club),
    'minutos_equipo', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from minutos_equipo m where m.club_id = v_club),
    'minutos_jugador', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from minutos_jugador m where m.club_id = v_club),
    'cuestionario_excepciones', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from cuestionario_excepciones x where x.club_id = v_club),
    'ejercicios', (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from ejercicios e where e.club_id = v_club),
    'sesiones', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from sesiones s where s.club_id = v_club),
    'sesion_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from sesion_items i where i.club_id = v_club),
    'registro_cambios', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from registro_cambios x where x.club_id = v_club)
  ) into v;
  perform _registrar(v_club, 'exportó todos los datos del club.');
  return v;
end $$;
