-- =====================================================================
-- Workout Builder (parte 3): el entrenamiento del jugador y el historial C/A.
-- Pegar entero en Supabase → SQL Editor → Run (después del 010). Una sola vez.
--
-- El jugador ve su plan del día (el suyo, si no el de su grupo, si no el del
-- equipo), puede cambiar kilos y reps de lo prescrito y marca cada ejercicio
-- como completado. Lo prescrito (C, coach) y lo hecho (A, atleta) quedan
-- guardados para el historial del PF.
-- =====================================================================

create table public.sesion_registros (
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  item_id uuid not null,                  -- sin FK: el registro sobrevive aunque el PF cambie el plan
  club_id uuid not null references public.clubs(id) on delete cascade,
  fecha date not null,
  ejercicio_id uuid references public.ejercicios(id),
  nombre text not null,
  prescrito jsonb not null default '[]',  -- C: [{"reps":"8","kg":60}]
  hecho jsonb not null default '[]',      -- A: lo que registró el jugador
  completado_en timestamptz,
  actualizado_en timestamptz not null default now(),
  primary key (perfil_id, item_id)
);
create index sesion_registros_historial on public.sesion_registros (perfil_id, ejercicio_id, fecha desc);

alter table public.sesion_registros enable row level security;
create policy registros_ver on public.sesion_registros for select
  using (club_id = public.mi_club() and (perfil_id = auth.uid() or public.nivel_de(auth.uid(), 'workout_builder') in ('ver', 'editar')));

-- La sesión que le toca a un jugador ese día: la suya; si no, la de su grupo
-- (el primero por nombre que tenga plan propio); si no, la del equipo.
create or replace function public._sesion_efectiva(p_perfil uuid, p_fecha date) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.id from sesiones s join perfiles p on p.club_id = s.club_id
      where p.id = p_perfil and s.fecha = p_fecha and s.destinos_clave = 'persona:' || p_perfil),
    (select s.id from grupo_miembros m join grupos g on g.id = m.grupo_id
       join sesiones s on s.club_id = g.club_id and s.fecha = p_fecha and s.destinos_clave = 'grupo:' || g.id
      where m.perfil_id = p_perfil order by g.nombre limit 1),
    (select s.id from sesiones s join perfiles p on p.club_id = s.club_id
      where p.id = p_perfil and s.fecha = p_fecha and s.destinos_clave = 'equipo')
  )
$$;

create or replace function public.puede_ver_entreno(p_perfil uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles p where p.id = p_perfil and p.club_id = mi_club() and p.eliminado_en is null)
     and (p_perfil = auth.uid() or nivel_de(auth.uid(), 'workout_builder') in ('ver', 'editar'))
$$;

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
        'video_url', e.video_url, 'consignas', e.consignas,
        'hecho', r.hecho, 'completado_en', r.completado_en
      ) order by i.orden)
      from sesion_items i
      left join ejercicios e on e.id = i.ejercicio_id
      left join sesion_registros r on r.item_id = i.id and r.perfil_id = v_perfil
      where i.sesion_id = v_sesion and i.eliminado_en is null), '[]'::jsonb)
  );
end $$;

-- El jugador guarda lo que hizo (y si lo completó). Solo para él y solo de su plan.
create or replace function public.guardar_registro(p_item uuid, p_hecho jsonb, p_completado boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); i sesion_items; s sesiones;
begin
  select * into i from sesion_items where id = p_item and club_id = v_club and eliminado_en is null;
  if i.id is null or i.tipo <> 'ejercicio' then raise exception 'Ese ejercicio ya no está en tu plan.'; end if;
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

-- Historial de un ejercicio para el PF: lo prescrito (C) y lo hecho (A), sesión por sesión.
create or replace function public.historial_ejercicio(p_perfil uuid, p_ejercicio uuid, p_nombre text default null)
returns table (fecha date, nombre text, prescrito jsonb, hecho jsonb, completado boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if nivel_de(auth.uid(), 'workout_builder') not in ('ver', 'editar') then raise exception 'El historial es solo para el staff.'; end if;
  if not exists (select 1 from perfiles where id = p_perfil and club_id = mi_club()) then raise exception 'Jugador no válido.'; end if;
  return query
  select r.fecha, r.nombre, r.prescrito, r.hecho, r.completado_en is not null
  from sesion_registros r
  where r.perfil_id = p_perfil and r.club_id = mi_club()
    and ((p_ejercicio is not null and r.ejercicio_id = p_ejercicio) or (p_ejercicio is null and lower(r.nombre) = lower(p_nombre)))
  order by r.fecha desc, r.actualizado_en desc
  limit 12;
end $$;

revoke all on function public._sesion_efectiva(uuid, date) from public, anon, authenticated;
revoke all on function public.puede_ver_entreno(uuid) from public, anon;
revoke all on function public.entreno_del_dia(date, uuid) from public, anon;
revoke all on function public.guardar_registro(uuid, jsonb, boolean) from public, anon;
revoke all on function public.historial_ejercicio(uuid, uuid, text) from public, anon;
grant execute on function public.puede_ver_entreno(uuid) to authenticated;
grant execute on function public.entreno_del_dia(date, uuid) to authenticated;
grant execute on function public.guardar_registro(uuid, jsonb, boolean) to authenticated;
grant execute on function public.historial_ejercicio(uuid, uuid, text) to authenticated;

-- ---------- Exportar club: con los registros ----------

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
    'cuestionario_excepciones', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from cuestionario_excepciones x where x.club_id = v_club),
    'ejercicios', (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from ejercicios e where e.club_id = v_club),
    'sesiones', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from sesiones s where s.club_id = v_club),
    'sesion_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from sesion_items i where i.club_id = v_club),
    'sesion_registros', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from sesion_registros r where r.club_id = v_club),
    'registro_cambios', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from registro_cambios x where x.club_id = v_club)
  ) into v;
  perform _registrar(v_club, 'exportó todos los datos del club.');
  return v;
end $$;
