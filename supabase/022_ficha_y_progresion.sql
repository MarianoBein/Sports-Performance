-- =====================================================================
-- 022 · Ficha del cliente, RPE por ejercicio y progresión asistida
-- Pegar entero en Supabase → SQL Editor → Run (después del 021).
-- Se puede correr más de una vez sin problema.
--
-- 1. El jugador, al completar un ejercicio, marca qué tan duro le resultó (RPE 1–10).
-- 2. Ficha del cliente: objetivo, deporte, días, lesiones, nivel, descansos y
--    el salto mínimo de carga del lugar (barra, mancuernas…).
-- 3. «Proponer semana siguiente»: queda guardado qué propuso la app y qué
--    elegiste vos, para que aprenda cómo responde cada persona.
-- =====================================================================

-- ---------- 1. RPE por ejercicio ----------
alter table public.sesion_registros add column if not exists rpe smallint check (rpe is null or rpe between 1 and 10);

drop function if exists public.guardar_registro(uuid, jsonb, boolean);
create or replace function public.guardar_registro(p_item uuid, p_hecho jsonb, p_completado boolean, p_rpe int default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); i sesion_items; s sesiones;
begin
  select * into i from sesion_items where id = p_item and club_id = v_club and eliminado_en is null;
  if i.id is null or i.tipo not in ('ejercicio', 'pregunta') then raise exception 'Ese ejercicio ya no está en tu plan.'; end if;
  select * into s from sesiones where id = i.sesion_id;
  if _sesion_efectiva(yo(), s.fecha) is distinct from s.id then raise exception 'Ese ejercicio no es de tu plan.'; end if;
  if jsonb_typeof(p_hecho) <> 'array' or jsonb_array_length(p_hecho) > 20 then raise exception 'Datos no válidos.'; end if;
  if p_rpe is not null and (p_rpe < 1 or p_rpe > 10) then raise exception 'El RPE va de 1 a 10.'; end if;
  insert into sesion_registros (perfil_id, item_id, club_id, fecha, ejercicio_id, nombre, prescrito, hecho, completado_en, actualizado_en, rpe)
  values (yo(), i.id, v_club, s.fecha, i.ejercicio_id, i.nombre, i.detalle, p_hecho, case when p_completado then now() end, now(), p_rpe)
  on conflict (perfil_id, item_id) do update set
    prescrito = excluded.prescrito, hecho = excluded.hecho, nombre = excluded.nombre, ejercicio_id = excluded.ejercicio_id,
    completado_en = case when p_completado then coalesce(sesion_registros.completado_en, now()) else null end,
    rpe = coalesce(excluded.rpe, sesion_registros.rpe),
    actualizado_en = now();
end $$;
revoke all on function public.guardar_registro(uuid, jsonb, boolean, int) from public, anon;
grant execute on function public.guardar_registro(uuid, jsonb, boolean, int) to authenticated;

-- Interruptor por club: la pregunta «¿Qué tan duro te pareció?» arranca apagada.
alter table public.clubs add column if not exists rpe_ejercicio boolean not null default false;
create or replace function public.activar_rpe_ejercicio(p_activo boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club();
begin
  if not soy_admin() then raise exception 'Solo un administrador puede cambiar los ajustes del club.'; end if;
  update clubs set rpe_ejercicio = coalesce(p_activo, false) where id = v_club;
  perform _registrar(v_club, case when p_activo then 'activó' else 'desactivó' end || ' la pregunta de RPE en cada ejercicio.');
end $$;
revoke all on function public.activar_rpe_ejercicio(boolean) from public, anon;
grant execute on function public.activar_rpe_ejercicio(boolean) to authenticated;

-- El plan del día ahora también devuelve el RPE que marcó el jugador.
create or replace function public.entreno_del_dia(p_fecha date, p_perfil uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_perfil uuid := coalesce(p_perfil, yo()); v_sesion uuid;
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
        'hecho', r.hecho, 'completado_en', r.completado_en, 'rpe', r.rpe
      ) order by i.orden)
      from sesion_items i
      left join ejercicios e on e.id = i.ejercicio_id
      left join sesion_registros r on r.item_id = i.id and r.perfil_id = v_perfil
      where i.sesion_id = v_sesion and i.eliminado_en is null), '[]'::jsonb)
  );
end $$;

-- ---------- 2. Ficha del cliente ----------
create table if not exists public.fichas_cliente (
  perfil_id uuid primary key references public.perfiles(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  objetivo text check (objetivo in ('salud', 'futbol', 'rugby', 'basquet', 'mantenimiento')),
  deporte text check (deporte is null or length(deporte) <= 60),
  dias_semana smallint check (dias_semana is null or dias_semana between 1 and 7),
  lesiones text check (lesiones is null or length(lesiones) <= 1000),
  nivel smallint check (nivel is null or nivel between 1 and 3),           -- 1 inicial · 2 intermedio · 3 avanzado
  descansos boolean not null default true,
  salto_barra numeric(4,2) not null default 5,       -- kg totales (2,5 por lado)
  salto_mancuerna numeric(4,2) not null default 2.5, -- kg por mancuerna
  salto_maquina numeric(4,2) not null default 5,
  notas text check (notas is null or length(notas) <= 2000),
  actualizado_en timestamptz not null default now()
);
alter table public.fichas_cliente enable row level security;
revoke all on public.fichas_cliente from anon;
grant select on public.fichas_cliente to authenticated;
drop policy if exists fichas_ver on public.fichas_cliente;
create policy fichas_ver on public.fichas_cliente for select
  using (club_id = public.mi_club() and public.nivel_de(public.yo(), 'workout_builder') in ('ver', 'editar'));

create or replace function public.guardar_ficha(p_perfil uuid, p_datos jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_nombre text;
begin
  if v_club is null or nivel_de(yo(), 'workout_builder') <> 'editar' then raise exception 'Solo quien edita el Workout Builder puede cambiar fichas.'; end if;
  select nombre into v_nombre from perfiles where id = p_perfil and club_id = v_club and eliminado_en is null;
  if v_nombre is null then raise exception 'Esa persona no está en el club.'; end if;
  insert into fichas_cliente (perfil_id, club_id, objetivo, deporte, dias_semana, lesiones, nivel, descansos, salto_barra, salto_mancuerna, salto_maquina, notas, actualizado_en)
  values (p_perfil, v_club,
    nullif(p_datos ->> 'objetivo', ''), nullif(btrim(coalesce(p_datos ->> 'deporte', '')), ''),
    nullif(p_datos ->> 'dias_semana', '')::smallint, nullif(btrim(coalesce(p_datos ->> 'lesiones', '')), ''),
    nullif(p_datos ->> 'nivel', '')::smallint, coalesce((p_datos ->> 'descansos')::boolean, true),
    coalesce(nullif(p_datos ->> 'salto_barra', '')::numeric, 5), coalesce(nullif(p_datos ->> 'salto_mancuerna', '')::numeric, 2.5),
    coalesce(nullif(p_datos ->> 'salto_maquina', '')::numeric, 5), nullif(btrim(coalesce(p_datos ->> 'notas', '')), ''), now())
  on conflict (perfil_id) do update set
    objetivo = excluded.objetivo, deporte = excluded.deporte, dias_semana = excluded.dias_semana, lesiones = excluded.lesiones,
    nivel = excluded.nivel, descansos = excluded.descansos, salto_barra = excluded.salto_barra,
    salto_mancuerna = excluded.salto_mancuerna, salto_maquina = excluded.salto_maquina, notas = excluded.notas, actualizado_en = now();
  perform _registrar(v_club, 'actualizó la ficha de ' || v_nombre || '.');
end $$;
revoke all on function public.guardar_ficha(uuid, jsonb) from public, anon;
grant execute on function public.guardar_ficha(uuid, jsonb) to authenticated;

-- ---------- 3. Decisiones de progresión (para aprender de cada persona) ----------
create table if not exists public.decisiones_progresion (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  fecha date not null,                 -- día de la semana propuesta
  ejercicio text not null,
  rpe smallint,
  propuesta text not null check (propuesta in ('subir', 'mantener', 'bajar')),
  elegida text not null check (elegida in ('subir', 'mantener', 'bajar')),
  creado_por uuid references public.perfiles(id) on delete set null,
  creado_en timestamptz not null default now()
);
create index if not exists decisiones_progresion_perfil on public.decisiones_progresion (perfil_id, creado_en desc);
alter table public.decisiones_progresion enable row level security;
revoke all on public.decisiones_progresion from anon;
grant select on public.decisiones_progresion to authenticated;
drop policy if exists decisiones_ver on public.decisiones_progresion;
create policy decisiones_ver on public.decisiones_progresion for select
  using (club_id = public.mi_club() and public.nivel_de(public.yo(), 'workout_builder') in ('ver', 'editar'));

create or replace function public.registrar_decisiones(p_perfil uuid, p_decisiones jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); d jsonb; v_nombre text; n int := 0;
begin
  if v_club is null or nivel_de(yo(), 'workout_builder') <> 'editar' then raise exception 'Sin permiso.'; end if;
  select nombre into v_nombre from perfiles where id = p_perfil and club_id = v_club;
  if v_nombre is null then raise exception 'Esa persona no está en el club.'; end if;
  if jsonb_typeof(p_decisiones) <> 'array' or jsonb_array_length(p_decisiones) > 200 then raise exception 'Datos no válidos.'; end if;
  for d in select * from jsonb_array_elements(p_decisiones) loop
    insert into decisiones_progresion (club_id, perfil_id, fecha, ejercicio, rpe, propuesta, elegida, creado_por)
    values (v_club, p_perfil, (d ->> 'fecha')::date, left(d ->> 'ejercicio', 120), nullif(d ->> 'rpe', '')::smallint, d ->> 'propuesta', d ->> 'elegida', yo());
    n := n + 1;
  end loop;
  perform _registrar(v_club, 'aplicó la progresión de la semana a ' || v_nombre || ' (' || n || ' ejercicios).');
end $$;
revoke all on function public.registrar_decisiones(uuid, jsonb) from public, anon;
grant execute on function public.registrar_decisiones(uuid, jsonb) to authenticated;

-- Comprobación: tiene que decir «true» tres veces.
select
  exists (select 1 from information_schema.columns where table_name = 'sesion_registros' and column_name = 'rpe') as rpe_por_ejercicio,
  exists (select 1 from information_schema.tables where table_name = 'fichas_cliente') as fichas,
  exists (select 1 from information_schema.tables where table_name = 'decisiones_progresion') as decisiones;
