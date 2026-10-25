-- =====================================================================
-- Workout Builder: «session break» en lugar de elegir bloque.
-- Pegar entero en Supabase → SQL Editor → Run (después del 008). Una sola vez.
--
-- Un session break es una fila con el nombre que quieras (Bloque principal,
-- Main block, Accessories, un comentario…). Todo lo que queda debajo le
-- pertenece hasta el siguiente break.
-- =====================================================================

alter table public.sesion_items
  add column tipo text not null default 'ejercicio' check (tipo in ('ejercicio', 'break'));
alter table public.sesion_items alter column series drop not null;
alter table public.sesion_items drop constraint if exists sesion_items_series_check;
alter table public.sesion_items
  add constraint sesion_items_series_check check (tipo = 'break' or series between 1 and 20);

-- La columna «bloque» queda sin uso (se conserva para no perder nada).
comment on column public.sesion_items.bloque is 'Sin uso desde el 009: los bloques son filas tipo break.';

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
    if jsonb_array_length(coalesce(p_items, '[]')) = 0 then return; end if;
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
    insert into sesion_items (id, sesion_id, club_id, orden, tipo, bloque, ejercicio_id, nombre, series, reps, cada_lado, con_carga, detalle, descanso_seg, nota, eliminado_en)
    values (v_id, v_sesion, v_club, i, v_tipo, 'Bloque principal', v_ej, btrim(it ->> 'nombre'),
            v_series, nullif(btrim(it ->> 'reps'), ''), coalesce((it ->> 'cada_lado')::boolean, false), coalesce((it ->> 'con_carga')::boolean, false),
            coalesce(it -> 'detalle', '[]'), nullif(it ->> 'descanso_seg', '')::int, nullif(btrim(it ->> 'nota'), ''), null)
    on conflict (id) do update set
      sesion_id = excluded.sesion_id, orden = excluded.orden, tipo = excluded.tipo, ejercicio_id = excluded.ejercicio_id,
      nombre = excluded.nombre, series = excluded.series, reps = excluded.reps, cada_lado = excluded.cada_lado,
      con_carga = excluded.con_carga, detalle = excluded.detalle, descanso_seg = excluded.descanso_seg, nota = excluded.nota,
      eliminado_en = null
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

