-- =====================================================================
-- 026 · La ficha del cliente (lesiones = datos de salud) solo con acceso al Sports Science Hub
-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr más de una vez.
-- Antes: la veía cualquiera con Workout Builder en «ver», aunque no tuviera el Hub.
-- Ahora: para verla hace falta Workout Builder (ver o editar) Y el Hub (cualquier nivel);
-- para cambiarla, Workout Builder en «editar» Y el Hub.
-- =====================================================================

drop policy if exists fichas_ver on public.fichas_cliente;
create policy fichas_ver on public.fichas_cliente for select
  using (club_id = (select public.mi_club())
    and public.nivel_de((select public.yo()), 'workout_builder') in ('ver', 'editar')
    and public.nivel_de((select public.yo()), 'sports_science') <> 'sin');

create or replace function public.guardar_ficha(p_perfil uuid, p_datos jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_nombre text;
begin
  if v_club is null or nivel_de(yo(), 'workout_builder') <> 'editar' then raise exception 'Solo quien edita el Workout Builder puede cambiar fichas.'; end if;
  -- La ficha tiene lesiones (datos de salud): sin acceso al Sports Science Hub no se ve ni se cambia.
  if nivel_de(yo(), 'sports_science') = 'sin' then raise exception 'La ficha tiene datos de salud: hace falta acceso al Sports Science Hub.'; end if;
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

-- Comprobación: tiene que decir true.
select exists (select 1 from pg_policies where tablename = 'fichas_cliente' and policyname = 'fichas_ver'
               and qual like '%sports_science%') as fichas_protegidas;
