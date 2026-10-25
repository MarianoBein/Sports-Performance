-- =====================================================================
-- Workout Builder: planes con herencia (equipo → grupo → jugador).
-- Pegar entero en Supabase → SQL Editor → Run (después del 009). Una sola vez.
--
-- El plan del equipo es la base. Un grupo o un jugador hereda el día de su
-- nivel superior hasta que lo cambiás: ahí se guarda una copia propia, que
-- manda para esos jugadores. Cada copia recuerda de qué ejercicio salió
-- (origen_id) y si la editaste (modificado), para bajar los cambios
-- de arriba sin pisar lo que personalizaste.
-- =====================================================================

alter table public.sesion_items
  add column origen_id uuid,
  add column modificado boolean not null default false;

-- Guardar un día de un plan (ahora también puede quedar vacío a propósito:
-- «este grupo no hace nada hoy»).
create or replace function public.guardar_dia(p_fecha date, p_destinos jsonb, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_club uuid := mi_club(); v_clave text; v_sesion uuid; it jsonb; i int := 0; v_ids uuid[] := '{}';
  v_id uuid; v_ej uuid; v_series int; v_nuevo boolean := false; v_tipo text;
begin
  if v_club is null or nivel_de(auth.uid(), 'workout_builder') <> 'editar' then
    raise exception 'Solo quien edita el Workout Builder puede armar sesiones.';
  end if;
  if p_fecha is null then raise exception 'Falta la fecha.'; end if;
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' or jsonb_array_length(coalesce(p_items, '[]')) > 60 then
    raise exception 'Demasiados ejercicios para un día (máximo 60).';
  end if;
  v_clave := _clave_destinos(v_club, p_destinos);

  select id into v_sesion from sesiones where club_id = v_club and fecha = p_fecha and destinos_clave = v_clave;
  if v_sesion is null then
    insert into sesiones (club_id, fecha, destinos, destinos_clave, creado_por)
    values (v_club, p_fecha, p_destinos, v_clave, auth.uid()) returning id into v_sesion;
    v_nuevo := true;
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    v_id := (it ->> 'id')::uuid;
    v_ej := nullif(it ->> 'ejercicio_id', '')::uuid;
    v_tipo := coalesce(nullif(it ->> 'tipo', ''), 'ejercicio');
    if v_tipo not in ('ejercicio', 'break') then raise exception 'Elemento no válido.'; end if;
    v_series := case when v_tipo = 'break' then null else (it ->> 'series')::int end;
    if v_tipo = 'break' then v_ej := null; end if;
    if v_id is null then raise exception 'Falta el identificador de un ejercicio.'; end if;
    if exists (select 1 from sesion_items where id = v_id and sesion_id <> v_sesion) then
      -- Venía de otro día o de otro plan: se mueve aquí.
      if not exists (select 1 from sesion_items where id = v_id and club_id = v_club) then raise exception 'Ejercicio no válido.'; end if;
    end if;
    if v_ej is not null and not exists (select 1 from ejercicios where id = v_ej and club_id = v_club) then
      raise exception 'Ejercicio no válido.';
    end if;
    if btrim(coalesce(it ->> 'nombre', '')) = '' then raise exception 'Falta el nombre (del ejercicio o del session break).'; end if;
    if v_tipo = 'ejercicio' and (v_series is null or v_series < 1 or v_series > 20) then raise exception 'Las series van de 1 a 20.'; end if;
    insert into sesion_items (id, sesion_id, club_id, orden, tipo, bloque, ejercicio_id, nombre, series, reps, cada_lado, con_carga, detalle, descanso_seg, nota, origen_id, modificado, eliminado_en)
    values (v_id, v_sesion, v_club, i, v_tipo, 'Bloque principal', v_ej, btrim(it ->> 'nombre'),
            v_series, nullif(btrim(it ->> 'reps'), ''), coalesce((it ->> 'cada_lado')::boolean, false), coalesce((it ->> 'con_carga')::boolean, false),
            coalesce(it -> 'detalle', '[]'), nullif(it ->> 'descanso_seg', '')::int, nullif(btrim(it ->> 'nota'), ''),
            nullif(it ->> 'origen_id', '')::uuid, coalesce((it ->> 'modificado')::boolean, false), null)
    on conflict (id) do update set
      sesion_id = excluded.sesion_id, orden = excluded.orden, tipo = excluded.tipo, ejercicio_id = excluded.ejercicio_id,
      nombre = excluded.nombre, series = excluded.series, reps = excluded.reps, cada_lado = excluded.cada_lado,
      con_carga = excluded.con_carga, detalle = excluded.detalle, descanso_seg = excluded.descanso_seg, nota = excluded.nota,
      origen_id = excluded.origen_id, modificado = excluded.modificado, eliminado_en = null
    where sesion_items.club_id = v_club;
    v_ids := v_ids || v_id;
    i := i + 1;
  end loop;

  update sesion_items set eliminado_en = now()
  where sesion_id = v_sesion and eliminado_en is null and not (id = any (v_ids));
  update sesiones set actualizado_en = now() where id = v_sesion;

  if v_nuevo then
    perform _registrar(v_club, 'armó una sesión para el ' || to_char(p_fecha, 'DD/MM/YYYY') || '.');
  end if;
end $$;


-- Quitar la personalización de un día: vuelve a heredar del nivel superior.
create or replace function public.eliminar_dia(p_fecha date, p_destinos jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_clave text;
begin
  if v_club is null or nivel_de(auth.uid(), 'workout_builder') <> 'editar' then
    raise exception 'Solo quien edita el Workout Builder puede armar sesiones.';
  end if;
  v_clave := _clave_destinos(v_club, p_destinos);
  delete from sesiones where club_id = v_club and fecha = p_fecha and destinos_clave = v_clave;
end $$;

-- Varios cambios de una vez (un cambio en el equipo baja a grupos y jugadores):
-- [{"fecha":"2026-10-27","destinos":[...],"items":[...]}, {"fecha":..., "destinos":[...], "borrar":true}]
create or replace function public.guardar_dias(p_cambios jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c jsonb;
begin
  if jsonb_typeof(p_cambios) <> 'array' or jsonb_array_length(p_cambios) > 400 then raise exception 'Cambios no válidos.'; end if;
  for c in select * from jsonb_array_elements(p_cambios) loop
    if coalesce((c ->> 'borrar')::boolean, false) then
      perform eliminar_dia((c ->> 'fecha')::date, c -> 'destinos');
    else
      perform guardar_dia((c ->> 'fecha')::date, c -> 'destinos', coalesce(c -> 'items', '[]'));
    end if;
  end loop;
end $$;

revoke all on function public.eliminar_dia(date, jsonb) from public, anon;
revoke all on function public.guardar_dias(jsonb) from public, anon;
grant execute on function public.eliminar_dia(date, jsonb) to authenticated;
grant execute on function public.guardar_dias(jsonb) to authenticated;
