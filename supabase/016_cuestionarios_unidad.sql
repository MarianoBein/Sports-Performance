-- =====================================================================
-- Workout Builder: cuestionarios dentro del plan y reps o segundos.
-- Pegar entero en Supabase → SQL Editor → Run (después del 015). Una sola vez.
--
-- config (por ejercicio): {"unidad": "reps" | "seg"}
-- config (por cuestionario): {"formato": "escala" | "opciones" | "texto", "opciones": [...], "min": 0, "max": 10}
-- La respuesta del jugador se guarda como un registro más: [{"valor": 7}] o [{"texto": "..."}].
-- =====================================================================

alter table public.sesion_items add column if not exists config jsonb not null default '{}';
alter table public.sesion_items drop constraint if exists sesion_items_tipo_check;
alter table public.sesion_items add constraint sesion_items_tipo_check check (tipo in ('ejercicio', 'break', 'nota', 'pregunta'));

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
    if v_tipo not in ('ejercicio', 'break', 'nota', 'pregunta') then raise exception 'Elemento no válido.'; end if;
    v_series := case when v_tipo <> 'ejercicio' then null else (it ->> 'series')::int end;
    if v_tipo <> 'ejercicio' then v_ej := null; end if;
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
    if jsonb_typeof(coalesce(it -> 'config', '{}')) <> 'object' or length(coalesce(it -> 'config', '{}')::text) > 4000 then raise exception 'Configuración no válida.'; end if;
    insert into sesion_items (id, sesion_id, club_id, orden, tipo, bloque, ejercicio_id, nombre, series, reps, cada_lado, con_carga, detalle, descanso_seg, nota, origen_id, modificado, config, eliminado_en)
    values (v_id, v_sesion, v_club, i, v_tipo, 'Bloque principal', v_ej, btrim(it ->> 'nombre'),
            v_series, nullif(btrim(it ->> 'reps'), ''), coalesce((it ->> 'cada_lado')::boolean, false), coalesce((it ->> 'con_carga')::boolean, false),
            coalesce(it -> 'detalle', '[]'), nullif(it ->> 'descanso_seg', '')::int, nullif(btrim(it ->> 'nota'), ''),
            nullif(it ->> 'origen_id', '')::uuid, coalesce((it ->> 'modificado')::boolean, false), coalesce(it -> 'config', '{}'), null)
    on conflict (id) do update set
      sesion_id = excluded.sesion_id, orden = excluded.orden, tipo = excluded.tipo, ejercicio_id = excluded.ejercicio_id,
      nombre = excluded.nombre, series = excluded.series, reps = excluded.reps, cada_lado = excluded.cada_lado,
      con_carga = excluded.con_carga, detalle = excluded.detalle, descanso_seg = excluded.descanso_seg, nota = excluded.nota,
      origen_id = excluded.origen_id, modificado = excluded.modificado, config = excluded.config, eliminado_en = null
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


create or replace function public.entreno_del_dia(p_fecha date, p_perfil uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_perfil uuid := coalesce(p_perfil, auth.uid()); v_sesion uuid;
begin
  if not puede_ver_entreno(v_perfil) then raise exception 'Sin acceso a este entrenamiento.'; end if;
  v_sesion := _sesion_efectiva(v_perfil, p_fecha);
  if v_sesion is null then return jsonb_build_object('fecha', p_fecha, 'items', '[]'::jsonb); end if;
  return jsonb_build_object(
    'fecha', p_fecha,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'tipo', i.tipo, 'nombre', i.nombre, 'ejercicio_id', i.ejercicio_id, 'series', i.series, 'reps', i.reps,
        'cada_lado', i.cada_lado, 'detalle', i.detalle, 'descanso_seg', i.descanso_seg, 'nota', i.nota,
        'video_url', e.video_url, 'consignas', e.consignas, 'config', i.config,
        'hecho', r.hecho, 'completado_en', r.completado_en
      ) order by i.orden)
      from sesion_items i
      left join ejercicios e on e.id = i.ejercicio_id
      left join sesion_registros r on r.item_id = i.id and r.perfil_id = v_perfil
      where i.sesion_id = v_sesion and i.eliminado_en is null), '[]'::jsonb)
  );
end $$;

create or replace function public.guardar_registro(p_item uuid, p_hecho jsonb, p_completado boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); i sesion_items; s sesiones;
begin
  select * into i from sesion_items where id = p_item and club_id = v_club and eliminado_en is null;
  if i.id is null or i.tipo not in ('ejercicio', 'pregunta') then raise exception 'Ese ejercicio ya no está en tu plan.'; end if;
  select * into s from sesiones where id = i.sesion_id;
  if _sesion_efectiva(auth.uid(), s.fecha) is distinct from s.id then raise exception 'Ese ejercicio no es de tu plan.'; end if;
  if jsonb_typeof(p_hecho) <> 'array' or jsonb_array_length(p_hecho) > 20 then raise exception 'Datos no válidos.'; end if;
  insert into sesion_registros (perfil_id, item_id, club_id, fecha, ejercicio_id, nombre, prescrito, hecho, completado_en, actualizado_en)
  values (auth.uid(), i.id, v_club, s.fecha, i.ejercicio_id, i.nombre, i.detalle, p_hecho, case when p_completado then now() end, now())
  on conflict (perfil_id, item_id) do update set
    prescrito = excluded.prescrito, hecho = excluded.hecho, nombre = excluded.nombre, ejercicio_id = excluded.ejercicio_id,
    completado_en = case when p_completado then coalesce(sesion_registros.completado_en, now()) else null end,
    actualizado_en = now();
end $$;
