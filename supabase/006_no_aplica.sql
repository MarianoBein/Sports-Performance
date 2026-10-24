-- =====================================================================
-- Wellness y RPE: «no aplica» por día (equipo o jugador), minutos de
-- espera del RPE configurables y ambos cuestionarios todos los días por defecto.
-- Pegar entero en Supabase → SQL Editor → Run (después del 005). Una sola vez.
-- =====================================================================

alter table public.clubs
  add column rpe_retraso_min smallint not null default 30 check (rpe_retraso_min between 0 and 120 and rpe_retraso_min % 5 = 0);
alter table public.clubs alter column rpe_modo set default 'todos';
update public.clubs set rpe_modo = 'todos' where rpe_modo = 'con_actividad';

-- perfil_id nulo = vale para todo el equipo; con jugador = excepción que manda sobre lo del equipo.
create table public.cuestionario_excepciones (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  fecha date not null,
  cuestionario text not null check (cuestionario in ('wellness', 'rpe')),
  perfil_id uuid references public.perfiles(id) on delete cascade,
  aplica boolean not null
);
create unique index cuestionario_excepciones_unica
  on public.cuestionario_excepciones (club_id, fecha, cuestionario, coalesce(perfil_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.cuestionario_excepciones enable row level security;
create policy excepciones_ver on public.cuestionario_excepciones for select
  using (club_id = public.mi_club() and (perfil_id is null or perfil_id = auth.uid() or public.ve_sports_science_club()));

-- ¿Aplica el cuestionario para esta persona ese día? null = sin excepciones (manda la frecuencia del club).
create or replace function public.aplica_cuestionario(p_perfil uuid, p_fecha date, p_cuestionario text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select aplica from cuestionario_excepciones where perfil_id = p_perfil and fecha = p_fecha and cuestionario = p_cuestionario),
    (select e.aplica from cuestionario_excepciones e join perfiles p on p.club_id = e.club_id
      where p.id = p_perfil and e.perfil_id is null and e.fecha = p_fecha and e.cuestionario = p_cuestionario))
$$;

create or replace function public.marcar_aplica(p_fecha date, p_cuestionario text, p_aplica boolean, p_perfil uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club();
begin
  if nivel_de(auth.uid(), 'sports_science') <> 'editar' then raise exception 'Solo quien edita el Sports Science Hub puede cambiar esto.'; end if;
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
end $$;

-- ---------- Estado del día: con «no aplica» y la espera configurable ----------

create or replace function public.estado_hoy() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_club uuid := mi_club(); c clubs; v_hoy date; v_ahora time; v_jugador boolean;
  v_hay_actividad boolean; v_fin time; v_desde time; w wellness; r rpe;
  v_aw boolean; v_ar boolean; v_espera interval;
begin
  if v_club is null then return null; end if;
  select * into c from clubs where id = v_club;
  v_hoy := hoy_club(v_club); v_ahora := ahora_club(v_club);
  v_espera := make_interval(mins => c.rpe_retraso_min);
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

  v_desde := case when v_fin is not null and v_fin + v_espera < v_fin then time '23:59'   -- pasaría de medianoche
                  when v_fin is not null then v_fin + v_espera
                  when v_hay_actividad then time '18:00'
                  else time '20:00' end;

  v_aw := aplica_cuestionario(auth.uid(), v_hoy, 'wellness');
  v_ar := aplica_cuestionario(auth.uid(), v_hoy, 'rpe');

  select * into w from wellness where perfil_id = auth.uid() and fecha = v_hoy;
  select * into r from rpe where perfil_id = auth.uid() and fecha = v_hoy;

  return jsonb_build_object(
    'fecha', v_hoy,
    'es_jugador', coalesce(v_jugador, false),
    'wellness_toca', coalesce(v_aw, coalesce(v_jugador, false) and (c.wellness_modo = 'todos' or (c.wellness_modo = 'con_actividad' and v_hay_actividad))),
    'wellness_hecho', w.perfil_id is not null,
    'preparacion', w.preparacion,
    'rpe_toca', coalesce(v_ar, coalesce(v_jugador, false) and (c.rpe_modo = 'todos' or (c.rpe_modo = 'con_actividad' and v_hay_actividad))),
    'rpe_desde', to_char(v_desde, 'HH24:MI'),
    'rpe_disponible', v_ahora >= v_desde,
    'rpe_hecho', r.perfil_id is not null,
    'rpe', r.valor
  );
end $$;

-- ---------- Respuestas del día: con «no aplica» ----------

drop function public.respuestas_dia(date);
create function public.respuestas_dia(p_fecha date)
returns table (perfil_id uuid, nombre text, sueno smallint, fatiga smallint, estres smallint, dolor smallint,
               preparacion numeric, rpe smallint, minutos smallint, minutos_propios boolean, srpe integer,
               wellness_aplica boolean, rpe_aplica boolean, wellness_excepcion boolean, rpe_excepcion boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_club uuid := mi_club(); c clubs;
begin
  if not ve_sports_science_club() then raise exception 'Sin acceso a estos datos.'; end if;
  select * into c from clubs where id = v_club;
  return query
  select p.id, p.nombre, w.sueno, w.fatiga, w.estres, w.dolor, w.preparacion, r.valor,
         coalesce(mj.minutos, me.minutos), mj.minutos is not null,
         case when r.valor is not null and coalesce(mj.minutos, me.minutos) is not null
              then (r.valor * coalesce(mj.minutos, me.minutos))::int end,
         coalesce(aplica_cuestionario(p.id, p_fecha, 'wellness'), c.wellness_modo <> 'no'),
         coalesce(aplica_cuestionario(p.id, p_fecha, 'rpe'), c.rpe_modo <> 'no'),
         exists (select 1 from cuestionario_excepciones e where e.perfil_id = p.id and e.fecha = p_fecha and e.cuestionario = 'wellness'),
         exists (select 1 from cuestionario_excepciones e where e.perfil_id = p.id and e.fecha = p_fecha and e.cuestionario = 'rpe')
  from perfiles p
  join roles ro on ro.id = p.rol_id and ro.es_jugador
  left join wellness w on w.perfil_id = p.id and w.fecha = p_fecha
  left join rpe r on r.perfil_id = p.id and r.fecha = p_fecha
  left join minutos_jugador mj on mj.perfil_id = p.id and mj.fecha = p_fecha
  left join minutos_equipo me on me.club_id = v_club and me.fecha = p_fecha
  where p.club_id = v_club and p.eliminado_en is null
  order by p.nombre;
end $$;

create or replace function public.actualizar_recurrencia(p_wellness text, p_rpe text, p_retraso int default 30) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); c clubs;
begin
  if not soy_admin() then raise exception 'Solo un administrador puede cambiar esto.'; end if;
  select * into c from clubs where id = v_club;
  update clubs set wellness_modo = p_wellness, rpe_modo = p_rpe, rpe_retraso_min = p_retraso where id = v_club;
  if c.wellness_modo is distinct from p_wellness or c.rpe_modo is distinct from p_rpe or c.rpe_retraso_min is distinct from p_retraso then
    perform _registrar(v_club, 'cambió los cuestionarios (wellness: ' || p_wellness || ', RPE: ' || p_rpe || ', RPE a los ' || p_retraso || ' min).');
  end if;
end $$;
drop function if exists public.actualizar_recurrencia(text, text);

grant execute on function public.aplica_cuestionario(uuid, date, text) to authenticated;
grant execute on function public.marcar_aplica(date, text, boolean, uuid) to authenticated;
grant execute on function public.respuestas_dia(date) to authenticated;
grant execute on function public.actualizar_recurrencia(text, text, int) to authenticated;
