-- =====================================================================
-- 021 · Fuentes de datos, corrección de respuestas y programas plantilla
-- Pegar entero en Supabase → SQL Editor → Run (después del 020).
-- Se puede correr más de una vez sin problema.
--
-- 1. Cada organización elige si tiene GPS y plataforma de fuerza. Si no,
--    esas partes no aparecen en el Sports Science Hub.
-- 2. Quien edita el Sports Science Hub puede corregir o borrar el wellness o
--    el RPE de un jugador en un día. Cada cambio queda en el registro, con
--    los valores de antes y de después.
-- 3. Calendario: deshacer un borrado (⌘Z).
-- 4. Programas plantilla del Workout Builder (por ejemplo, «Esguince de
--    tobillo · 3 semanas»): semanas y días sin fecha, guardados para usarlos
--    con distintos jugadores o grupos.
-- =====================================================================

-- ---------- 1. Fuentes de datos ----------
alter table public.clubs add column if not exists fuentes jsonb not null default '{"gps": false, "fuerza": false}';

create or replace function public.actualizar_fuentes(p_gps boolean, p_fuerza boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_antes jsonb; v_cambios text[] := '{}';
begin
  if not soy_admin() then raise exception 'Solo un administrador puede cambiar los ajustes del club.'; end if;
  select fuentes into v_antes from clubs where id = v_club;
  if coalesce((v_antes ->> 'gps')::boolean, false) <> coalesce(p_gps, false) then
    v_cambios := v_cambios || (case when p_gps then 'activó' else 'desactivó' end || ' el GPS');
  end if;
  if coalesce((v_antes ->> 'fuerza')::boolean, false) <> coalesce(p_fuerza, false) then
    v_cambios := v_cambios || (case when p_fuerza then 'activó' else 'desactivó' end || ' la plataforma de fuerza');
  end if;
  update clubs set fuentes = jsonb_build_object('gps', coalesce(p_gps, false), 'fuerza', coalesce(p_fuerza, false)) where id = v_club;
  if array_length(v_cambios, 1) > 0 then
    perform _registrar(v_club, array_to_string(v_cambios, ' y ') || ' en las fuentes de datos.');
  end if;
end $$;
revoke all on function public.actualizar_fuentes(boolean, boolean) from public, anon;
grant execute on function public.actualizar_fuentes(boolean, boolean) to authenticated;

-- ---------- 2. Corregir o borrar respuestas (solo quien edita el Sports Science Hub) ----------
create or replace function public._jugador_del_club_para_corregir(p_perfil uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_nombre text;
begin
  if nivel_de(yo(), 'sports_science') <> 'editar' then
    raise exception 'Solo quien edita el Sports Science Hub puede corregir respuestas.';
  end if;
  select p.nombre into v_nombre from perfiles p join roles r on r.id = p.rol_id
  where p.id = p_perfil and p.club_id = mi_club() and p.eliminado_en is null and r.es_jugador;
  if v_nombre is null then raise exception 'Ese jugador no está en el club.'; end if;
  return v_nombre;
end $$;
revoke all on function public._jugador_del_club_para_corregir(uuid) from public, anon, authenticated;

-- Valores en la misma escala que se ven en el Hub: sueño 5 = bien; fatiga, estrés y dolor 5 = mal.
-- Los cuatro vacíos = borrar el wellness de ese día.
create or replace function public.corregir_wellness(
  p_perfil uuid, p_fecha date, p_sueno int, p_fatiga int, p_estres int, p_dolor int, p_motivo text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_club uuid := mi_club(); v_nombre text; w wellness; v_borrar boolean; v_cambios text[] := '{}';
  v_motivo text := nullif(left(btrim(coalesce(p_motivo, '')), 200), '');
begin
  v_nombre := _jugador_del_club_para_corregir(p_perfil);
  if p_fecha > hoy_club(v_club) then raise exception 'No se puede cargar un día que todavía no pasó.'; end if;
  v_borrar := p_sueno is null and p_fatiga is null and p_estres is null and p_dolor is null;
  if not v_borrar and (p_sueno is null or p_fatiga is null or p_estres is null or p_dolor is null) then
    raise exception 'Completá las cuatro respuestas (o dejá las cuatro vacías para borrar el wellness de ese día).';
  end if;
  if not v_borrar and (least(p_sueno, p_fatiga, p_estres, p_dolor) < 1 or greatest(p_sueno, p_fatiga, p_estres, p_dolor) > 5) then
    raise exception 'Los valores van de 1 a 5.';
  end if;
  select * into w from wellness where perfil_id = p_perfil and fecha = p_fecha;

  if v_borrar then
    if w.perfil_id is null then return; end if;
    delete from wellness where perfil_id = p_perfil and fecha = p_fecha;
    perform _registrar(v_club, 'borró el wellness de ' || v_nombre || ' del ' || to_char(p_fecha, 'DD/MM/YYYY')
      || ' (era: sueño ' || w.sueno || ', fatiga ' || w.fatiga || ', estrés ' || w.estres || ', dolor ' || w.dolor || ')'
      || coalesce('. Motivo: ' || v_motivo, '') || '.');
    return;
  end if;

  if w.perfil_id is null then
    insert into wellness (club_id, perfil_id, fecha, sueno, fatiga, estres, dolor)
    values (v_club, p_perfil, p_fecha, p_sueno, p_fatiga, p_estres, p_dolor);
    perform _registrar(v_club, 'cargó el wellness de ' || v_nombre || ' del ' || to_char(p_fecha, 'DD/MM/YYYY')
      || ': sueño ' || p_sueno || ', fatiga ' || p_fatiga || ', estrés ' || p_estres || ', dolor ' || p_dolor
      || coalesce('. Motivo: ' || v_motivo, '') || '.');
    return;
  end if;

  if w.sueno <> p_sueno then v_cambios := v_cambios || ('sueño ' || w.sueno || ' → ' || p_sueno); end if;
  if w.fatiga <> p_fatiga then v_cambios := v_cambios || ('fatiga ' || w.fatiga || ' → ' || p_fatiga); end if;
  if w.estres <> p_estres then v_cambios := v_cambios || ('estrés ' || w.estres || ' → ' || p_estres); end if;
  if w.dolor <> p_dolor then v_cambios := v_cambios || ('dolor ' || w.dolor || ' → ' || p_dolor); end if;
  if array_length(v_cambios, 1) is null then return; end if;
  update wellness set sueno = p_sueno, fatiga = p_fatiga, estres = p_estres, dolor = p_dolor, actualizado_en = now()
  where perfil_id = p_perfil and fecha = p_fecha;
  perform _registrar(v_club, 'corrigió el wellness de ' || v_nombre || ' del ' || to_char(p_fecha, 'DD/MM/YYYY')
    || ': ' || array_to_string(v_cambios, ', ') || coalesce('. Motivo: ' || v_motivo, '') || '.');
end $$;
revoke all on function public.corregir_wellness(uuid, date, int, int, int, int, text) from public, anon;
grant execute on function public.corregir_wellness(uuid, date, int, int, int, int, text) to authenticated;

-- RPE vacío = borrar el RPE de ese día.
create or replace function public.corregir_rpe(p_perfil uuid, p_fecha date, p_valor int, p_motivo text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_club uuid := mi_club(); v_nombre text; v_antes int;
  v_motivo text := nullif(left(btrim(coalesce(p_motivo, '')), 200), '');
begin
  v_nombre := _jugador_del_club_para_corregir(p_perfil);
  if p_fecha > hoy_club(v_club) then raise exception 'No se puede cargar un día que todavía no pasó.'; end if;
  if p_valor is not null and (p_valor < 1 or p_valor > 10) then raise exception 'El RPE va de 1 a 10.'; end if;
  select valor into v_antes from rpe where perfil_id = p_perfil and fecha = p_fecha;
  if v_antes is not distinct from p_valor then return; end if;
  if p_valor is null then
    delete from rpe where perfil_id = p_perfil and fecha = p_fecha;
    perform _registrar(v_club, 'borró el RPE de ' || v_nombre || ' del ' || to_char(p_fecha, 'DD/MM/YYYY')
      || ' (era ' || v_antes || ')' || coalesce('. Motivo: ' || v_motivo, '') || '.');
  else
    insert into rpe (club_id, perfil_id, fecha, valor) values (v_club, p_perfil, p_fecha, p_valor)
    on conflict (perfil_id, fecha) do update set valor = excluded.valor, actualizado_en = now();
    perform _registrar(v_club, case when v_antes is null then 'cargó' else 'corrigió' end || ' el RPE de ' || v_nombre
      || ' del ' || to_char(p_fecha, 'DD/MM/YYYY') || ': ' || coalesce(v_antes::text || ' → ', '') || p_valor
      || coalesce('. Motivo: ' || v_motivo, '') || '.');
  end if;
end $$;
revoke all on function public.corregir_rpe(uuid, date, int, text) from public, anon;
grant execute on function public.corregir_rpe(uuid, date, int, text) to authenticated;

-- ---------- 2b. Calendario: deshacer un borrado ----------
create or replace function public.restaurar_actividad(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a actividades; v_nivel text := nivel_de(yo(), 'calendario');
begin
  select * into a from actividades where id = p_id and club_id = mi_club() and eliminado_en is not null;
  if not found then raise exception 'Esa actividad no se puede recuperar.'; end if;
  if not (v_nivel = 'editar' or (v_nivel = 'propio' and a.creado_por = yo())) then
    raise exception 'No puedes recuperar esta actividad.';
  end if;
  update actividades set eliminado_en = null where id = p_id;
end $$;
revoke all on function public.restaurar_actividad(uuid) from public, anon;
grant execute on function public.restaurar_actividad(uuid) to authenticated;

-- ---------- 3. Programas plantilla ----------
create table if not exists public.programas (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  nombre text not null check (length(nombre) between 1 and 120),
  descripcion text check (descripcion is null or length(descripcion) <= 1000),
  semanas int not null default 3 check (semanas between 1 and 16),
  dias jsonb not null default '{}',   -- {"1-0": [ejercicios…]} = semana 1, lunes (0) … domingo (6)
  creado_por uuid references public.perfiles(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz
);
create index if not exists programas_club on public.programas (club_id);
alter table public.programas enable row level security;
drop policy if exists programas_ver on public.programas;
create policy programas_ver on public.programas for select
  using (club_id = public.mi_club() and eliminado_en is null and public.nivel_de(public.yo(), 'workout_builder') in ('ver', 'editar'));

create or replace function public.guardar_programa(p_id uuid, p_nombre text, p_descripcion text, p_semanas int, p_dias jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_id uuid; v_nombre text := left(btrim(coalesce(p_nombre, '')), 120);
begin
  if v_club is null or nivel_de(yo(), 'workout_builder') <> 'editar' then
    raise exception 'Solo quien edita el Workout Builder puede guardar programas.';
  end if;
  if v_nombre = '' then raise exception 'Ponele un nombre al programa.'; end if;
  if p_semanas is null or p_semanas < 1 or p_semanas > 16 then raise exception 'El programa tiene que durar entre 1 y 16 semanas.'; end if;
  if jsonb_typeof(coalesce(p_dias, '{}')) <> 'object' or pg_column_size(p_dias) > 400000 then raise exception 'Programa no válido.'; end if;
  if p_id is not null then
    update programas set nombre = v_nombre, descripcion = nullif(btrim(coalesce(p_descripcion, '')), ''), semanas = p_semanas,
      dias = coalesce(p_dias, '{}'), actualizado_en = now()
    where id = p_id and club_id = v_club and eliminado_en is null
    returning id into v_id;
    if v_id is null then raise exception 'Ese programa ya no existe.'; end if;
    perform _registrar(v_club, 'editó el programa «' || v_nombre || '».');
  else
    insert into programas (club_id, nombre, descripcion, semanas, dias, creado_por)
    values (v_club, v_nombre, nullif(btrim(coalesce(p_descripcion, '')), ''), p_semanas, coalesce(p_dias, '{}'), yo())
    returning id into v_id;
    perform _registrar(v_club, 'creó el programa «' || v_nombre || '».');
  end if;
  return v_id;
end $$;

create or replace function public.eliminar_programa(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_nombre text;
begin
  if v_club is null or nivel_de(yo(), 'workout_builder') <> 'editar' then
    raise exception 'Solo quien edita el Workout Builder puede borrar programas.';
  end if;
  update programas set eliminado_en = now() where id = p_id and club_id = v_club and eliminado_en is null returning nombre into v_nombre;
  if v_nombre is null then raise exception 'Ese programa ya no existe.'; end if;
  perform _registrar(v_club, 'borró el programa «' || v_nombre || '» (lo ya asignado a los jugadores queda).');
end $$;

-- Deja constancia de a quién se le asignó (los ejercicios se guardan con guardar_dias).
create or replace function public.registrar_asignacion_programa(p_id uuid, p_para text, p_desde date) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_nombre text;
begin
  if v_club is null or nivel_de(yo(), 'workout_builder') <> 'editar' then raise exception 'Sin permiso.'; end if;
  select nombre into v_nombre from programas where id = p_id and club_id = v_club;
  if v_nombre is null then raise exception 'Ese programa ya no existe.'; end if;
  perform _registrar(v_club, 'asignó el programa «' || v_nombre || '» a ' || left(coalesce(p_para, '¿?'), 120)
    || ' desde el ' || to_char(p_desde, 'DD/MM/YYYY') || '.');
end $$;

revoke all on function public.guardar_programa(uuid, text, text, int, jsonb) from public, anon;
revoke all on function public.eliminar_programa(uuid) from public, anon;
revoke all on function public.registrar_asignacion_programa(uuid, text, date) from public, anon;
grant execute on function public.guardar_programa(uuid, text, text, int, jsonb) to authenticated;
grant execute on function public.eliminar_programa(uuid) to authenticated;
grant execute on function public.registrar_asignacion_programa(uuid, text, date) to authenticated;

-- Comprobación: tiene que decir «true» tres veces.
select
  exists (select 1 from information_schema.columns where table_name = 'clubs' and column_name = 'fuentes') as fuentes,
  exists (select 1 from pg_proc where proname = 'corregir_wellness') as correcciones,
  exists (select 1 from information_schema.tables where table_name = 'programas') as programas;
