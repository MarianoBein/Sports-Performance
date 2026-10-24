-- =====================================================================
-- Módulo 3 · Wellness y RPE
-- Pegar entero en Supabase → SQL Editor → Run (después del 004). Una sola vez.
--
-- Escalas guardadas (como el Looker del PF):
--   sueño 1-5  → 5 = dormí muy bien
--   fatiga, estrés, dolor muscular 1-5 → 5 = muy mal
-- En pantalla el jugador siempre ve 5 = mejor; la app lo traduce.
-- Preparación (score) = promedio de las 4 con el mismo sentido (5 = mejor).
-- Un dato que falta nunca cuenta como cero.
-- =====================================================================

alter table public.clubs
  add column wellness_modo text not null default 'todos' check (wellness_modo in ('todos', 'con_actividad', 'no')),
  add column rpe_modo text not null default 'con_actividad' check (rpe_modo in ('todos', 'con_actividad', 'no'));

create table public.wellness (
  club_id uuid not null references public.clubs(id) on delete cascade,
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  fecha date not null,
  sueno smallint not null check (sueno between 1 and 5),
  fatiga smallint not null check (fatiga between 1 and 5),
  estres smallint not null check (estres between 1 and 5),
  dolor smallint not null check (dolor between 1 and 5),
  preparacion numeric(3,2) generated always as ((sueno + (6 - fatiga) + (6 - estres) + (6 - dolor)) / 4.0) stored,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (perfil_id, fecha)
);

create table public.rpe (
  club_id uuid not null references public.clubs(id) on delete cascade,
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  fecha date not null,
  valor smallint not null check (valor between 1 and 10),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (perfil_id, fecha)
);

-- Minutos de entrenamiento que carga el PF: uno para el equipo y, si hace falta, uno distinto por jugador.
create table public.minutos_equipo (
  club_id uuid not null references public.clubs(id) on delete cascade,
  fecha date not null,
  minutos smallint not null check (minutos between 0 and 600),
  primary key (club_id, fecha)
);
create table public.minutos_jugador (
  club_id uuid not null references public.clubs(id) on delete cascade,
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  fecha date not null,
  minutos smallint not null check (minutos between 0 and 600),
  primary key (perfil_id, fecha)
);

-- ---------- Ayudas ----------

create or replace function public.hoy_club(p_club uuid) returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select zona_horaria from clubs where id = p_club), 'Europe/Madrid'))::date
$$;

create or replace function public.ahora_club(p_club uuid) returns time
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select zona_horaria from clubs where id = p_club), 'Europe/Madrid'))::time
$$;

-- ¿Puede ver los datos de wellness/RPE del club? (staff con acceso al Sports Science Hub)
create or replace function public.ve_sports_science_club() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfiles p join roles r on r.id = p.rol_id
    where p.id = auth.uid() and p.eliminado_en is null
      and (p.es_admin or (not r.es_jugador and nivel_de(p.id, 'sports_science') in ('ver', 'editar')))
  )
$$;

-- ---------- Seguridad por filas ----------

alter table public.wellness enable row level security;
alter table public.rpe enable row level security;
alter table public.minutos_equipo enable row level security;
alter table public.minutos_jugador enable row level security;

create policy wellness_ver on public.wellness for select
  using (club_id = public.mi_club() and (perfil_id = auth.uid() or public.ve_sports_science_club()));
create policy rpe_ver on public.rpe for select
  using (club_id = public.mi_club() and (perfil_id = auth.uid() or public.ve_sports_science_club()));
create policy minutos_equipo_ver on public.minutos_equipo for select using (club_id = public.mi_club());
create policy minutos_jugador_ver on public.minutos_jugador for select
  using (club_id = public.mi_club() and (perfil_id = auth.uid() or public.ve_sports_science_club()));

-- ---------- Estado del día para la persona (qué le toca contestar) ----------

create or replace function public.estado_hoy() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_club uuid := mi_club(); c clubs; v_hoy date; v_ahora time; v_jugador boolean;
  v_hay_actividad boolean; v_fin time; v_desde time; w wellness; r rpe;
begin
  if v_club is null then return null; end if;
  select * into c from clubs where id = v_club;
  v_hoy := hoy_club(v_club); v_ahora := ahora_club(v_club);
  select r2.es_jugador into v_jugador from perfiles p join roles r2 on r2.id = p.rol_id where p.id = auth.uid();

  select exists (
    select 1 from actividades a
    where a.club_id = v_club and a.fecha = v_hoy and a.tipo = 'deportiva' and a.eliminado_en is null
      and auth.uid() in (select personas_de_actividad(a.id))
  ) into v_hay_actividad;

  select max(case when a.todo_el_dia then null
                  when a.hora_fin is not null and a.hora_fin > a.hora_inicio then a.hora_fin
                  when a.hora_inicio > time '22:59' then time '23:59'
                  else a.hora_inicio + interval '60 minutes' end)
  into v_fin
  from actividades a
  where a.club_id = v_club and a.fecha = v_hoy and a.tipo = 'deportiva' and a.eliminado_en is null
    and auth.uid() in (select personas_de_actividad(a.id));

  -- El RPE se habilita 30 minutos después de terminar la última actividad deportiva del día.
  v_desde := case when v_fin is not null and v_fin > time '23:29' then time '23:59'
                  when v_fin is not null then v_fin + interval '30 minutes'
                  when v_hay_actividad then time '18:00'   -- solo actividades de todo el día
                  else time '20:00' end;

  select * into w from wellness where perfil_id = auth.uid() and fecha = v_hoy;
  select * into r from rpe where perfil_id = auth.uid() and fecha = v_hoy;

  return jsonb_build_object(
    'fecha', v_hoy,
    'es_jugador', coalesce(v_jugador, false),
    'wellness_toca', coalesce(v_jugador, false) and (c.wellness_modo = 'todos' or (c.wellness_modo = 'con_actividad' and v_hay_actividad)),
    'wellness_hecho', w.perfil_id is not null,
    'preparacion', w.preparacion,
    'rpe_toca', coalesce(v_jugador, false) and (c.rpe_modo = 'todos' or (c.rpe_modo = 'con_actividad' and v_hay_actividad)),
    'rpe_desde', to_char(v_desde, 'HH24:MI'),
    'rpe_disponible', v_ahora >= v_desde,
    'rpe_hecho', r.perfil_id is not null,
    'rpe', r.valor
  );
end $$;

-- ---------- Respuestas del jugador ----------

-- Recibe los valores como los ve el jugador (5 = mejor en todo) y los guarda en la escala del PF.
create or replace function public.guardar_wellness(p_sueno int, p_fatiga int, p_estres int, p_dolor int) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club();
begin
  if v_club is null then raise exception 'Sin acceso.'; end if;
  if least(p_sueno, p_fatiga, p_estres, p_dolor) < 1 or greatest(p_sueno, p_fatiga, p_estres, p_dolor) > 5 then
    raise exception 'Valores fuera de escala.';
  end if;
  insert into wellness (club_id, perfil_id, fecha, sueno, fatiga, estres, dolor)
  values (v_club, auth.uid(), hoy_club(v_club), p_sueno, 6 - p_fatiga, 6 - p_estres, 6 - p_dolor)
  on conflict (perfil_id, fecha) do update set
    sueno = excluded.sueno, fatiga = excluded.fatiga, estres = excluded.estres, dolor = excluded.dolor, actualizado_en = now();
end $$;

create or replace function public.guardar_rpe(p_valor int) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club();
begin
  if v_club is null then raise exception 'Sin acceso.'; end if;
  if p_valor < 1 or p_valor > 10 then raise exception 'El RPE va de 1 a 10.'; end if;
  insert into rpe (club_id, perfil_id, fecha, valor) values (v_club, auth.uid(), hoy_club(v_club), p_valor)
  on conflict (perfil_id, fecha) do update set valor = excluded.valor, actualizado_en = now();
end $$;

-- ---------- Staff: minutos y respuestas del día ----------

create or replace function public.guardar_minutos(p_fecha date, p_minutos int, p_perfil uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club();
begin
  if nivel_de(auth.uid(), 'sports_science') <> 'editar' then raise exception 'Solo quien edita el Sports Science Hub puede cargar minutos.'; end if;
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
end $$;

create or replace function public.respuestas_dia(p_fecha date)
returns table (perfil_id uuid, nombre text, sueno smallint, fatiga smallint, estres smallint, dolor smallint,
               preparacion numeric, rpe smallint, minutos smallint, minutos_propios boolean, srpe integer)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_club uuid := mi_club();
begin
  if not ve_sports_science_club() then raise exception 'Sin acceso a estos datos.'; end if;
  return query
  select p.id, p.nombre, w.sueno, w.fatiga, w.estres, w.dolor, w.preparacion, r.valor,
         coalesce(mj.minutos, me.minutos), mj.minutos is not null,
         case when r.valor is not null and coalesce(mj.minutos, me.minutos) is not null
              then (r.valor * coalesce(mj.minutos, me.minutos))::int end
  from perfiles p
  join roles ro on ro.id = p.rol_id and ro.es_jugador
  left join wellness w on w.perfil_id = p.id and w.fecha = p_fecha
  left join rpe r on r.perfil_id = p.id and r.fecha = p_fecha
  left join minutos_jugador mj on mj.perfil_id = p.id and mj.fecha = p_fecha
  left join minutos_equipo me on me.club_id = v_club and me.fecha = p_fecha
  where p.club_id = v_club and p.eliminado_en is null
  order by p.nombre;
end $$;

create or replace function public.actualizar_recurrencia(p_wellness text, p_rpe text) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); c clubs;
begin
  if not soy_admin() then raise exception 'Solo un administrador puede cambiar esto.'; end if;
  select * into c from clubs where id = v_club;
  update clubs set wellness_modo = p_wellness, rpe_modo = p_rpe where id = v_club;
  if c.wellness_modo is distinct from p_wellness or c.rpe_modo is distinct from p_rpe then
    perform _registrar(v_club, 'cambió la frecuencia de los cuestionarios (wellness: ' || p_wellness || ', RPE: ' || p_rpe || ').');
  end if;
end $$;

-- ---------- Permisos de ejecución ----------

revoke all on function public.hoy_club(uuid) from public, anon;
revoke all on function public.ahora_club(uuid) from public, anon;
grant execute on function public.hoy_club(uuid) to authenticated;
grant execute on function public.ahora_club(uuid) to authenticated;
grant execute on function public.ve_sports_science_club() to authenticated;
grant execute on function public.estado_hoy() to authenticated;
grant execute on function public.guardar_wellness(int, int, int, int) to authenticated;
grant execute on function public.guardar_rpe(int) to authenticated;
grant execute on function public.guardar_minutos(date, int, uuid) to authenticated;
grant execute on function public.respuestas_dia(date) to authenticated;
grant execute on function public.actualizar_recurrencia(text, text) to authenticated;

-- ---------- Exportar club: incluir wellness y RPE ----------

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
    'registro_cambios', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from registro_cambios x where x.club_id = v_club)
  ) into v;
  perform _registrar(v_club, 'exportó todos los datos del club.');
  return v;
end $$;
