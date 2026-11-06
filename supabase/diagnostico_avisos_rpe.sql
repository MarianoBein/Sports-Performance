-- =====================================================================
-- Diagnóstico (solo lectura, no cambia nada): ¿por qué salió cada aviso de RPE?
-- Pegar en Supabase → SQL Editor → Run, y mandarle a Claude el resultado.
-- Muestra los avisos de RPE de los últimos 14 días en organizaciones cuyo nombre
-- empieza con «Fénix» (cambiá el nombre abajo si querés otra).
-- =====================================================================
select
  to_char(av.fecha, 'Dy DD/MM') as dia,
  to_char(av.enviado_en at time zone c.zona_horaria, 'HH24:MI') as hora_envio,
  p.nombre as jugador,
  c.rpe_modo,
  -- Actividades deportivas de ese día donde está el jugador (lo que habilita el RPE con «solo con actividad»)
  coalesce((select string_agg(a.nombre || ' ' || coalesce(to_char(a.hora_inicio, 'HH24:MI'), 'todo el día'), '; ')
            from actividades a
            where a.club_id = c.id and a.fecha = av.fecha and a.tipo = 'deportiva' and a.eliminado_en is null
              and p.id in (select personas_de_actividad(a.id))), '—') as actividad_suya,
  -- Otras cosas de ese día (otro tipo, o de otro grupo)
  coalesce((select string_agg(a.nombre || ' (' || a.tipo || ')', '; ')
            from actividades a
            where a.club_id = c.id and a.fecha = av.fecha and a.eliminado_en is null
              and not (a.tipo = 'deportiva' and p.id in (select personas_de_actividad(a.id)))), '—') as otras_del_dia,
  -- Actividades de ese día que se borraron después
  coalesce((select string_agg(a.nombre || ' (borrada ' || to_char(a.eliminado_en at time zone c.zona_horaria, 'DD/MM HH24:MI') || ')', '; ')
            from actividades a where a.club_id = c.id and a.fecha = av.fecha and a.eliminado_en is not null), '—') as borradas,
  -- Excepciones marcadas a mano en el Sports Science Hub
  coalesce((select string_agg(case when e.perfil_id is null then 'equipo' else 'jugador' end || ': ' || case when e.aplica then 'sí' else 'no' end, '; ')
            from cuestionario_excepciones e
            where e.club_id = c.id and e.fecha = av.fecha and e.cuestionario = 'rpe' and (e.perfil_id is null or e.perfil_id = p.id)), '—') as excepcion_rpe,
  -- Cambios en el calendario ese día (por si se movió algo)
  coalesce((select string_agg(to_char(r.creado_en at time zone c.zona_horaria, 'HH24:MI') || ' ' || r.actor_nombre || ' ' || r.accion, ' | ')
            from registro_cambios r
            where r.club_id = c.id and (r.creado_en at time zone c.zona_horaria)::date = av.fecha
              and r.accion ilike '%actividad%'), '—') as cambios_calendario_ese_dia
from avisos_enviados av
join perfiles p on p.id = av.perfil_id
join clubs c on c.id = p.club_id
where av.tipo = 'rpe' and av.fecha >= current_date - 14
  and c.nombre ilike 'fénix%'
order by av.fecha desc, p.nombre;
