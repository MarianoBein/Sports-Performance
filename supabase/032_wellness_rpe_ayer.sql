-- 032 · El jugador puede cargar o corregir el wellness y el RPE de hoy y de ayer.
-- Lo de hace dos días o más ya no (eso lo sigue corrigiendo el staff desde el Hub).
-- Pegar entero en el SQL Editor de Supabase.

drop function if exists public.guardar_wellness(integer, integer, integer, integer);
create or replace function public.guardar_wellness(p_sueno integer, p_fatiga integer, p_estres integer, p_dolor integer, p_fecha date default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_hoy date;
begin
  if v_club is null then raise exception 'Sin acceso.'; end if;
  v_hoy := hoy_club(v_club);
  p_fecha := coalesce(p_fecha, v_hoy);
  if p_fecha not in (v_hoy, v_hoy - 1) then raise exception 'Solo se puede cargar lo de hoy o lo de ayer.'; end if;
  if least(p_sueno, p_fatiga, p_estres, p_dolor) < 1 or greatest(p_sueno, p_fatiga, p_estres, p_dolor) > 5 then
    raise exception 'Valores fuera de escala.';
  end if;
  insert into wellness (club_id, perfil_id, fecha, sueno, fatiga, estres, dolor)
  values (v_club, (select public.yo()), p_fecha, p_sueno, 6 - p_fatiga, 6 - p_estres, 6 - p_dolor)
  on conflict (perfil_id, fecha) do update set
    sueno = excluded.sueno, fatiga = excluded.fatiga, estres = excluded.estres, dolor = excluded.dolor, actualizado_en = now();
end $$;

drop function if exists public.guardar_rpe(integer);
create or replace function public.guardar_rpe(p_valor integer, p_fecha date default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_hoy date;
begin
  if v_club is null then raise exception 'Sin acceso.'; end if;
  v_hoy := hoy_club(v_club);
  p_fecha := coalesce(p_fecha, v_hoy);
  if p_fecha not in (v_hoy, v_hoy - 1) then raise exception 'Solo se puede cargar lo de hoy o lo de ayer.'; end if;
  if p_valor < 1 or p_valor > 10 then raise exception 'El RPE va de 1 a 10.'; end if;
  insert into rpe (club_id, perfil_id, fecha, valor) values (v_club, (select public.yo()), p_fecha, p_valor)
  on conflict (perfil_id, fecha) do update set valor = excluded.valor, actualizado_en = now();
end $$;

revoke all on function public.guardar_wellness(integer, integer, integer, integer, date) from public, anon;
revoke all on function public.guardar_rpe(integer, date) from public, anon;
grant execute on function public.guardar_wellness(integer, integer, integer, integer, date) to authenticated;
grant execute on function public.guardar_rpe(integer, date) to authenticated;

-- Comprobación: tiene que mostrar 2 | 0.
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('guardar_wellness', 'guardar_rpe') and pronargs in (2, 5)) as listo,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('guardar_wellness', 'guardar_rpe')
     and has_function_privilege('anon', oid, 'execute')) as abiertas_sin_sesion;
