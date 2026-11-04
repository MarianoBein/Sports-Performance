-- =====================================================================
-- 025 · El código de alta de jugador dura 24 horas (antes, 7 días)
-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr más de una vez.
-- Staff (un uso, 48 horas) y administrador (un uso, 14 días) quedan igual.
-- Los códigos de jugador que ya estaban activos también pasan a vencer a las 24 horas de creados.
-- =====================================================================

create or replace function public.crear_codigo(p_rol uuid, p_grupo uuid default null)
returns table (codigo text, caduca_en timestamptz, usos_max integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_club uuid := mi_club(); r roles; v_codigo text;
begin
  if not soy_admin() then raise exception 'Solo un administrador puede crear códigos.'; end if;
  select * into r from roles where id = p_rol and club_id = v_club;
  if not found then raise exception 'Rol no válido.'; end if;
  if p_grupo is not null and not exists (select 1 from grupos where id = p_grupo and club_id = v_club) then
    raise exception 'Grupo no válido.';
  end if;
  v_codigo := _codigo_nuevo(v_club, false);
  insert into codigos_alta (club_id, codigo, rol_id, grupo_id, usos_max, caduca_en, creado_por)
  values (v_club, v_codigo, r.id, case when r.es_jugador then p_grupo else null end,
          case when r.es_jugador then null else 1 end,
          now() + case when r.es_jugador then interval '24 hours' else interval '48 hours' end,
          (select public.yo()));
  perform _registrar(v_club, 'creó el código de alta ' || v_codigo || ' para ' || r.nombre || '.');
  return query select a.codigo, a.caduca_en, a.usos_max from codigos_alta a where a.codigo = v_codigo;
end $$;

update public.codigos_alta a set caduca_en = a.creado_en + interval '24 hours'
from public.roles r
where r.id = a.rol_id and r.es_jugador and not a.revocado and a.caduca_en > a.creado_en + interval '24 hours';

-- Comprobación: tiene que decir 0.
select count(*) as codigos_de_jugador_de_mas_de_24h
from public.codigos_alta a join public.roles r on r.id = a.rol_id
where r.es_jugador and not a.revocado and a.caduca_en > a.creado_en + interval '24 hours';
