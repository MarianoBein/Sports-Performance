-- =====================================================================
-- 028 · Partes de fisio + asistencia + ficha del jugador (Sports Science Hub)
-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
-- 1) Parte de fisio: jugador, fecha, motivo, ¿entrena? y ¿pesas? (sí / no / con restricciones),
--    y si hay que volver a verlo, la fecha del rechequeo. Al guardarlo le llega un aviso al
--    staff deportivo; el día del rechequeo, un recordatorio a quien lo cargó y a los fisios.
--    Lo ve todo el que tiene acceso al Hub (también C-level). Los jugadores, nunca.
-- 2) Asistencia: en la pestaña Día se destilda a quien no vino al entrenamiento.
-- 3) Ficha del jugador: entrenamientos de campo, partidos, sesiones de pesas, faltas y partes.
-- =====================================================================

-- ---------- 1. Partes de fisio ----------
create table if not exists public.partes_fisio (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  perfil_id uuid not null references public.perfiles (id) on delete cascade,
  fecha date not null,
  motivo text not null check (length(motivo) between 1 and 2000),
  entrena text not null check (entrena in ('si', 'no', 'restricciones')),
  pesas text not null check (pesas in ('si', 'no', 'restricciones')),
  restricciones text check (restricciones is null or length(restricciones) <= 1000),
  fecha_rechequeo date,
  creado_por uuid references public.perfiles (id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  avisado_en timestamptz,
  rechequeo_avisado_en timestamptz
);
create index if not exists partes_fisio_club_fecha on public.partes_fisio (club_id, fecha);
create index if not exists partes_fisio_perfil on public.partes_fisio (perfil_id, fecha);
alter table public.partes_fisio enable row level security;
drop policy if exists partes_fisio_ver on public.partes_fisio;
create policy partes_fisio_ver on public.partes_fisio for select to authenticated
  using (club_id = (select public.mi_club()) and (select public.ve_sports_science_club()));

-- ---------- 2. Asistencia (solo se guardan las faltas) ----------
create table if not exists public.ausencias (
  club_id uuid not null references public.clubs (id) on delete cascade,
  perfil_id uuid not null references public.perfiles (id) on delete cascade,
  fecha date not null,
  creado_por uuid references public.perfiles (id) on delete set null,
  creado_en timestamptz not null default now(),
  primary key (perfil_id, fecha)
);
create index if not exists ausencias_club_fecha on public.ausencias (club_id, fecha);
alter table public.ausencias enable row level security;
drop policy if exists ausencias_ver on public.ausencias;
create policy ausencias_ver on public.ausencias for select to authenticated
  using (club_id = (select public.mi_club()) and (select public.ve_sports_science_club()));

revoke all on public.partes_fisio, public.ausencias from anon;
revoke insert, update, delete, truncate on public.partes_fisio, public.ausencias from authenticated;
grant select on public.partes_fisio, public.ausencias to authenticated;

-- ¿Puede cargar partes y asistencia? Quien edita el Sports Science Hub (fisio, PF) o un admin.
create or replace function public._edita_ssh() returns boolean
language sql stable security definer set search_path = public as $$
  select soy_admin() or nivel_de(yo(), 'sports_science') = 'editar'
$$;

-- Guardar un parte (nuevo si p_id es null).
create or replace function public.guardar_parte(p_id uuid, p_perfil uuid, p_fecha date, p_motivo text, p_entrena text, p_pesas text,
  p_restricciones text default null, p_fecha_rechequeo date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_id uuid; v_nombre text; v_antes date;
begin
  if v_club is null then raise exception 'Sin sesión.'; end if;
  if not _edita_ssh() then raise exception 'Hace falta permiso para editar el Sports Science Hub.'; end if;
  select p.nombre into v_nombre from perfiles p join roles r on r.id = p.rol_id
    where p.id = p_perfil and p.club_id = v_club and p.eliminado_en is null and r.es_jugador;
  if v_nombre is null then raise exception 'Jugador no válido.'; end if;
  if p_fecha is null or p_fecha > hoy_club(v_club) + 1 then raise exception 'Fecha no válida.'; end if;
  p_motivo := trim(coalesce(p_motivo, ''));
  if p_motivo = '' or length(p_motivo) > 2000 then raise exception 'Escribí el motivo (hasta 2000 letras).'; end if;
  if p_entrena not in ('si', 'no', 'restricciones') or p_pesas not in ('si', 'no', 'restricciones') then raise exception 'Respuesta no válida.'; end if;
  p_restricciones := nullif(trim(coalesce(p_restricciones, '')), '');
  if length(p_restricciones) > 1000 then raise exception 'Las restricciones son muy largas.'; end if;
  if p_fecha_rechequeo is not null and p_fecha_rechequeo < p_fecha then raise exception 'El rechequeo tiene que ser después del parte.'; end if;
  if p_id is null then
    insert into partes_fisio (club_id, perfil_id, fecha, motivo, entrena, pesas, restricciones, fecha_rechequeo, creado_por)
    values (v_club, p_perfil, p_fecha, p_motivo, p_entrena, p_pesas, p_restricciones, p_fecha_rechequeo, yo())
    returning id into v_id;
    perform _registrar(v_club, 'cargó un parte de fisio de ' || v_nombre || '.');
  else
    select fecha_rechequeo into v_antes from partes_fisio where id = p_id and club_id = v_club;
    update partes_fisio set perfil_id = p_perfil, fecha = p_fecha, motivo = p_motivo, entrena = p_entrena, pesas = p_pesas,
      restricciones = p_restricciones, fecha_rechequeo = p_fecha_rechequeo, actualizado_en = now(),
      rechequeo_avisado_en = case when p_fecha_rechequeo is distinct from v_antes then null else rechequeo_avisado_en end
    where id = p_id and club_id = v_club returning id into v_id;
    if v_id is null then raise exception 'Ese parte no existe.'; end if;
    perform _registrar(v_club, 'cambió un parte de fisio de ' || v_nombre || '.');
  end if;
  return v_id;
end $$;

create or replace function public.eliminar_parte(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_perfil uuid;
begin
  if v_club is null then raise exception 'Sin sesión.'; end if;
  if not _edita_ssh() then raise exception 'Hace falta permiso para editar el Sports Science Hub.'; end if;
  delete from partes_fisio where id = p_id and club_id = v_club returning perfil_id into v_perfil;
  if v_perfil is null then raise exception 'Ese parte no existe.'; end if;
  perform _registrar(v_club, 'borró un parte de fisio de ' || (select nombre from perfiles where id = v_perfil) || '.');
end $$;

-- Marcar si un jugador vino o no un día.
create or replace function public.marcar_asistencia(p_fecha date, p_perfil uuid, p_presente boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club();
begin
  if v_club is null then raise exception 'Sin sesión.'; end if;
  if not _edita_ssh() then raise exception 'Hace falta permiso para editar el Sports Science Hub.'; end if;
  if not exists (select 1 from perfiles p join roles r on r.id = p.rol_id where p.id = p_perfil and p.club_id = v_club and r.es_jugador) then
    raise exception 'Jugador no válido.';
  end if;
  if p_fecha is null or p_fecha > hoy_club(v_club) + 1 then raise exception 'Fecha no válida.'; end if;
  if p_presente then
    delete from ausencias where perfil_id = p_perfil and fecha = p_fecha;
  else
    insert into ausencias (club_id, perfil_id, fecha, creado_por) values (v_club, p_perfil, p_fecha, yo())
    on conflict (perfil_id, fecha) do nothing;
  end if;
end $$;

-- ---------- 3. Ficha del jugador ----------
-- Entrenamientos de campo y partidos: días con actividad deportiva del jugador (hasta hoy), sin las faltas.
-- Pesas: días en que completó al menos un ejercicio de su entreno.
create or replace function public.ficha_jugador(p_perfil uuid, p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_hasta date; r jsonb;
begin
  if v_club is null or not ve_sports_science_club() then raise exception 'Sin acceso al Sports Science Hub.'; end if;
  if not exists (select 1 from perfiles where id = p_perfil and club_id = v_club) then raise exception 'Jugador no válido.'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then raise exception 'Período no válido.'; end if;
  v_hasta := least(p_hasta, hoy_club(v_club));
  with acts as (
    select distinct a.fecha, a.es_partido, a.nombre
    from actividades a
    where a.club_id = v_club and a.tipo = 'deportiva' and a.eliminado_en is null
      and a.fecha between p_desde and v_hasta
      and p_perfil in (select personas_de_actividad(a.id))
  ), dias as (
    select fecha, bool_or(es_partido) as partido, bool_or(not es_partido) as campo,
           exists (select 1 from ausencias au where au.perfil_id = p_perfil and au.fecha = acts.fecha) as falto,
           string_agg(nombre, ' · ' order by nombre) as nombres
    from acts group by fecha
  ), pesas as (
    select fecha, count(*) filter (where completado_en is not null) as hechos, count(*) as total
    from sesion_registros where perfil_id = p_perfil and club_id = v_club and fecha between p_desde and v_hasta
    group by fecha having count(*) filter (where completado_en is not null) > 0
  )
  select jsonb_build_object(
    'campo', (select count(*) from dias where campo and not falto),
    'partidos', (select count(*) from dias where partido and not falto),
    'faltas', (select count(*) from dias where falto),
    'pesas', (select count(*) from pesas),
    'dias', coalesce((select jsonb_agg(jsonb_build_object('fecha', fecha, 'partido', partido, 'falto', falto, 'nombre', nombres) order by fecha desc) from dias), '[]'::jsonb),
    'dias_pesas', coalesce((select jsonb_agg(jsonb_build_object('fecha', fecha, 'hechos', hechos, 'total', total) order by fecha desc) from pesas), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- ---------- 4. Avisos (los manda el servidor cada 5 minutos) ----------
-- Parte nuevo → al staff deportivo (menos a quien lo cargó). Día del rechequeo (desde las 9) → a quien lo cargó y a los fisios.
create or replace function public.tomar_partes()
returns table (endpoint text, p256dh text, auth text, titulo text, cuerpo text, url text, tag text, fecha date)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare p record; v_txt text;
  est constant jsonb := '{"si": "sí", "no": "no", "restricciones": "con restricciones"}';
begin
  -- Partes nuevos (de los últimos 3 días, para no mandar avisos viejos)
  for p in update partes_fisio pf set avisado_en = now()
           from perfiles j, clubs c
           where pf.avisado_en is null and j.id = pf.perfil_id and c.id = pf.club_id and c.estado = 'activa'
             and pf.creado_en > now() - interval '3 days'
           returning pf.*, j.nombre as jugador loop
    v_txt := 'Entrena: ' || (est ->> p.entrena) || ' · Pesas: ' || (est ->> p.pesas)
             || case when p.fecha_rechequeo is not null then ' · Rechequeo ' || to_char(p.fecha_rechequeo, 'DD/MM') else '' end;
    return query
      select s.endpoint, s.p256dh, s.auth, ('🩺 Parte de fisio: ' || p.jugador)::text, v_txt, '/sports-science?pestana=fisio'::text,
             ('parte-' || p.id::text)::text, hoy_club(p.club_id)
      from push_suscripciones s
      join perfiles st on st.id = s.perfil_id
      join roles rs on rs.id = st.rol_id
      where st.club_id = p.club_id and st.eliminado_en is null and st.id is distinct from p.creado_por
        and rs.clave in ('principal', 'ayudante', 'skills', 'pf', 'fisio')
        and nivel_de(st.id, 'sports_science') <> 'sin';
  end loop;
  -- Recordatorio del rechequeo
  for p in update partes_fisio pf set rechequeo_avisado_en = now()
           from perfiles j, clubs c
           where pf.rechequeo_avisado_en is null and pf.fecha_rechequeo is not null and j.id = pf.perfil_id and c.id = pf.club_id
             and c.estado = 'activa' and pf.fecha_rechequeo = hoy_club(c.id)
             and (now() at time zone coalesce(c.zona_horaria, 'Europe/Madrid'))::time >= time '09:00'
           returning pf.*, j.nombre as jugador loop
    return query
      select s.endpoint, s.p256dh, s.auth, ('Rechequeo hoy: ' || p.jugador)::text, left(p.motivo, 140), '/sports-science?pestana=fisio'::text,
             ('rechequeo-' || p.id::text)::text, p.fecha_rechequeo
      from push_suscripciones s
      join perfiles st on st.id = s.perfil_id
      join roles rs on rs.id = st.rol_id
      where st.club_id = p.club_id and st.eliminado_en is null
        and (st.id = p.creado_por or rs.clave = 'fisio')
        and nivel_de(st.id, 'sports_science') <> 'sin';
  end loop;
end $$;

-- ---------- Permisos de las funciones ----------
revoke all on function public._edita_ssh() from public, anon, authenticated;
revoke all on function public.guardar_parte(uuid, uuid, date, text, text, text, text, date) from public, anon;
revoke all on function public.eliminar_parte(uuid) from public, anon;
revoke all on function public.marcar_asistencia(date, uuid, boolean) from public, anon;
revoke all on function public.ficha_jugador(uuid, date, date) from public, anon;
revoke all on function public.tomar_partes() from public, anon, authenticated;
grant execute on function public.guardar_parte(uuid, uuid, date, text, text, text, text, date) to authenticated;
grant execute on function public.eliminar_parte(uuid) to authenticated;
grant execute on function public.marcar_asistencia(date, uuid, boolean) to authenticated;
grant execute on function public.ficha_jugador(uuid, date, date) to authenticated;
grant execute on function public.tomar_partes() to service_role;

-- Comprobación: tiene que mostrar 2 | 0 (dos tablas nuevas con RLS; ninguna función nueva abierta sin sesión).
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename in ('partes_fisio', 'ausencias') and rowsecurity) as tablas_con_rls,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('_edita_ssh', 'guardar_parte', 'eliminar_parte', 'marcar_asistencia', 'ficha_jugador', 'tomar_partes')
     and has_function_privilege('anon', oid, 'execute')) as abiertas_sin_sesion;
