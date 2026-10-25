-- =====================================================================
-- Avisos al celular (notificaciones push) para wellness y RPE.
-- Pegar entero en Supabase → SQL Editor → Run (después del 013). Una sola vez.
--
-- Cada 5 minutos, Supabase llama a la app (/api/avisos). La app pregunta acá
-- a quién le toca un aviso (wellness a la hora elegida del club; RPE cuando
-- se habilita después de la última actividad) y se lo manda al celular.
-- Cada aviso se manda una sola vez por día.
-- =====================================================================

alter table public.clubs add column hora_aviso_wellness time not null default '09:00';

create table public.push_suscripciones (
  endpoint text primary key,
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  creado_en timestamptz not null default now()
);
create index push_suscripciones_perfil on public.push_suscripciones (perfil_id);
alter table public.push_suscripciones enable row level security;
create policy push_ver on public.push_suscripciones for select using (perfil_id = auth.uid());

create table public.avisos_enviados (
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  fecha date not null,
  tipo text not null check (tipo in ('wellness', 'rpe')),
  enviado_en timestamptz not null default now(),
  primary key (perfil_id, fecha, tipo)
);
alter table public.avisos_enviados enable row level security;  -- nadie la lee desde la app

create or replace function public.guardar_suscripcion(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if mi_club() is null then raise exception 'Sin sesión.'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Suscripción no válida.'; end if;
  insert into push_suscripciones (endpoint, perfil_id, club_id, p256dh, auth)
  values (p_endpoint, auth.uid(), mi_club(), p_p256dh, p_auth)
  on conflict (endpoint) do update set perfil_id = excluded.perfil_id, club_id = excluded.club_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create or replace function public.borrar_suscripcion(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_suscripciones where endpoint = p_endpoint and perfil_id = auth.uid();
$$;

-- ---------- El estado del día de cualquier jugador (lo que antes era solo «estado_hoy») ----------
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
    'wellness_toca', coalesce(v_aw, coalesce(v_jugador, false) and (c.wellness_modo = 'todos' or (c.wellness_modo = 'con_actividad' and v_hay_actividad))),
    'wellness_hecho', w.perfil_id is not null,
    'wellness_aviso', v_ahora >= c.hora_aviso_wellness,
    'preparacion', w.preparacion,
    'rpe_toca', coalesce(v_ar, coalesce(v_jugador, false) and (c.rpe_modo = 'todos' or (c.rpe_modo = 'con_actividad' and v_hay_actividad))),
    'rpe_desde', to_char(v_desde, 'HH24:MI'),
    'rpe_disponible', v_ahora >= v_desde,
    'rpe_hecho', r.perfil_id is not null,
    'rpe', r.valor
  );
end $$;

create or replace function public.estado_hoy() returns jsonb
language sql stable security definer set search_path = public as $$
  select estado_de(auth.uid())
$$;

-- ---------- Avisos que tocan ahora (solo la app, con la clave secreta) ----------
-- Los marca como enviados en el mismo paso, así nunca salen dos veces.
create or replace function public.tomar_avisos() returns table (perfil_id uuid, tipo text, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare j record; e jsonb;
begin
  for j in select distinct s.perfil_id from push_suscripciones s join perfiles p on p.id = s.perfil_id
           join clubs c on c.id = p.club_id where p.eliminado_en is null and c.estado = 'activa' loop
    e := estado_de(j.perfil_id);
    if e is null or not (e ->> 'es_jugador')::boolean then continue; end if;
    if (e ->> 'wellness_toca')::boolean and not (e ->> 'wellness_hecho')::boolean and (e ->> 'wellness_aviso')::boolean then
      insert into avisos_enviados (perfil_id, fecha, tipo) values (j.perfil_id, (e ->> 'fecha')::date, 'wellness') on conflict do nothing;
      if found then
        return query select s.perfil_id, 'wellness'::text, s.endpoint, s.p256dh, s.auth from push_suscripciones s where s.perfil_id = j.perfil_id;
      end if;
    end if;
    if (e ->> 'rpe_toca')::boolean and not (e ->> 'rpe_hecho')::boolean and (e ->> 'rpe_disponible')::boolean then
      insert into avisos_enviados (perfil_id, fecha, tipo) values (j.perfil_id, (e ->> 'fecha')::date, 'rpe') on conflict do nothing;
      if found then
        return query select s.perfil_id, 'rpe'::text, s.endpoint, s.p256dh, s.auth from push_suscripciones s where s.perfil_id = j.perfil_id;
      end if;
    end if;
  end loop;
end $$;

-- Suscripciones que el celular ya no acepta (la persona desinstaló o quitó el permiso).
create or replace function public.quitar_suscripcion(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_suscripciones where endpoint = p_endpoint;
$$;

-- Hora del aviso de wellness, desde Ajustes.
create or replace function public.actualizar_hora_aviso(p_hora time) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin() then raise exception 'Solo un administrador puede cambiar esto.'; end if;
  update clubs set hora_aviso_wellness = p_hora where id = mi_club();
  perform _registrar(mi_club(), 'cambió la hora del aviso de wellness a las ' || to_char(p_hora, 'HH24:MI') || '.');
end $$;

revoke all on function public.guardar_suscripcion(text, text, text) from public, anon;
revoke all on function public.borrar_suscripcion(text) from public, anon;
revoke all on function public.estado_de(uuid) from public, anon, authenticated;
revoke all on function public.tomar_avisos() from public, anon, authenticated;
revoke all on function public.quitar_suscripcion(text) from public, anon, authenticated;
revoke all on function public.actualizar_hora_aviso(time) from public, anon;
grant execute on function public.guardar_suscripcion(text, text, text) to authenticated;
grant execute on function public.borrar_suscripcion(text) to authenticated;
grant execute on function public.estado_hoy() to authenticated;
grant execute on function public.actualizar_hora_aviso(time) to authenticated;
grant execute on function public.tomar_avisos() to service_role;
grant execute on function public.quitar_suscripcion(text) to service_role;
grant execute on function public.estado_de(uuid) to service_role;
