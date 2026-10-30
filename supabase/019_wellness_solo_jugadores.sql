-- 019: el wellness y el RPE son solo para jugadores.
-- Antes, si un plan del Workout Builder tenía activado el cuestionario, se lo pedía también
-- al staff (preparador, cuerpo técnico). Ahora siempre exige que el rol sea de jugador.
-- Se puede correr más de una vez sin problema.

create or replace function public.estado_de(p_perfil uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_club uuid; c clubs; v_hoy date; v_ahora time; v_jugador boolean;
  v_hay_actividad boolean; v_fin time; v_desde time; w wellness; r rpe;
  v_aw boolean; v_ar boolean; v_espera interval;
begin
  select p.club_id, ro.es_jugador into v_club, v_jugador from perfiles p join roles ro on ro.id = p.rol_id
  where p.id = p_perfil and p.eliminado_en is null;
  if v_club is null then return null; end if;
  select * into c from clubs where id = v_club;
  v_hoy := hoy_club(v_club); v_ahora := ahora_club(v_club);
  v_espera := make_interval(mins => c.rpe_retraso_min);

  select exists (
    select 1 from actividades a
    where a.club_id = v_club and a.fecha = v_hoy and a.tipo = 'deportiva' and a.eliminado_en is null
      and p_perfil in (select personas_de_actividad(a.id))
  ) into v_hay_actividad;

  select max(case when a.todo_el_dia then null
                  when a.hora_fin is not null and a.hora_fin > a.hora_inicio then a.hora_fin
                  when a.hora_inicio > time '22:59' then time '23:59'
                  else a.hora_inicio + interval '60 minutes' end)
  into v_fin
  from actividades a
  where a.club_id = v_club and a.fecha = v_hoy and a.tipo = 'deportiva' and a.eliminado_en is null
    and p_perfil in (select personas_de_actividad(a.id));

  v_desde := case when v_fin is not null and v_fin + v_espera < v_fin then time '23:59'
                  when v_fin is not null then v_fin + v_espera
                  when v_hay_actividad then time '18:00'
                  else time '20:00' end;

  v_aw := aplica_cuestionario(p_perfil, v_hoy, 'wellness');
  v_ar := aplica_cuestionario(p_perfil, v_hoy, 'rpe');
  select * into w from wellness where perfil_id = p_perfil and fecha = v_hoy;
  select * into r from rpe where perfil_id = p_perfil and fecha = v_hoy;

  return jsonb_build_object(
    'fecha', v_hoy,
    'ahora', to_char(v_ahora, 'HH24:MI'),
    'es_jugador', coalesce(v_jugador, false),
    'wellness_toca', coalesce(v_jugador, false) and coalesce(v_aw, coalesce(v_jugador, false) and (c.wellness_modo = 'todos' or (c.wellness_modo = 'con_actividad' and v_hay_actividad))),
    'wellness_hecho', w.perfil_id is not null,
    'wellness_aviso', v_ahora >= c.hora_aviso_wellness,
    'preparacion', w.preparacion,
    'rpe_toca', coalesce(v_jugador, false) and coalesce(v_ar, coalesce(v_jugador, false) and (c.rpe_modo = 'todos' or (c.rpe_modo = 'con_actividad' and v_hay_actividad))),
    'rpe_desde', to_char(v_desde, 'HH24:MI'),
    'rpe_disponible', v_ahora >= v_desde,
    'rpe_hecho', r.perfil_id is not null,
    'rpe', r.valor
  );
end $$;
