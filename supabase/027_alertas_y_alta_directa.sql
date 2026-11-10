-- =====================================================================
-- 027 · Alertas del Sports Science Hub + «Sumar persona» en Usuarios
-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
-- 1) Alertas: reglas del club («sueño debajo de su media dos días seguidos»).
--    Cada 5 minutos se revisan; si un jugador cumple una regla, le llega un aviso
--    al celular a todo el staff deportivo (principal, ayudante, skills, PF, fisio)
--    y queda marcada en el Hub. Un dato que falta nunca cuenta: si no contestó, no hay alerta.
-- 2) Sumar persona: el admin crea la cuenta (nombre, email, rol, contraseña temporal).
--    La primera vez que entra, la app le pide elegir su contraseña.
-- 3) Plataforma: el dueño puede eliminar una organización (con doble confirmación).
-- =====================================================================

-- ---------- 1. Alertas ----------
create table if not exists public.alertas_reglas (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  nombre text not null check (length(nombre) between 1 and 80),
  activa boolean not null default true,
  modo text not null default 'todas' check (modo in ('todas', 'alguna')),
  dias integer not null default 1 check (dias between 1 and 7),
  condiciones jsonb not null default '[]'::jsonb,
  creado_por uuid references public.perfiles (id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists alertas_reglas_club on public.alertas_reglas (club_id);
alter table public.alertas_reglas enable row level security;
drop policy if exists alertas_reglas_ver on public.alertas_reglas;
create policy alertas_reglas_ver on public.alertas_reglas for select to authenticated
  using (club_id = (select public.mi_club()) and (select public.ve_sports_science_club()));

create table if not exists public.alertas_disparadas (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  regla_id uuid not null references public.alertas_reglas (id) on delete cascade,
  perfil_id uuid not null references public.perfiles (id) on delete cascade,
  fecha date not null,
  detalle text not null default '',
  creado_en timestamptz not null default now(),
  avisado_en timestamptz,
  unique (regla_id, perfil_id, fecha)
);
create index if not exists alertas_disparadas_club_fecha on public.alertas_disparadas (club_id, fecha);
alter table public.alertas_disparadas enable row level security;
drop policy if exists alertas_disparadas_ver on public.alertas_disparadas;
create policy alertas_disparadas_ver on public.alertas_disparadas for select to authenticated
  using (club_id = (select public.mi_club()) and (select public.ve_sports_science_club()));

revoke all on public.alertas_reglas, public.alertas_disparadas from anon;
revoke insert, update, delete, truncate on public.alertas_reglas, public.alertas_disparadas from authenticated;
grant select on public.alertas_reglas, public.alertas_disparadas to authenticated;

-- Valor de una métrica de un jugador en un día (null si no contestó). Fatiga, estrés y dolor
-- se guardan con 5 = peor; sueño y preparación con 5 = mejor; RPE de 0 a 10.
create or replace function public._valor_metrica(p_perfil uuid, p_fecha date, p_metrica text) returns numeric
language sql stable security definer set search_path = public as $$
  select case p_metrica
    when 'rpe' then (select r.valor::numeric from rpe r where r.perfil_id = p_perfil and r.fecha = p_fecha limit 1)
    else (select (case p_metrica when 'sueno' then w.sueno when 'fatiga' then w.fatiga when 'estres' then w.estres
                   when 'dolor' then w.dolor when 'preparacion' then w.preparacion end)::numeric
          from wellness w where w.perfil_id = p_perfil and w.fecha = p_fecha limit 1)
  end
$$;

-- Media del jugador en los 28 días anteriores a ese día (hace falta al menos 5 datos).
create or replace function public._media_metrica(p_perfil uuid, p_fecha date, p_metrica text) returns numeric
language sql stable security definer set search_path = public as $$
  with v as (
    select _valor_metrica(p_perfil, d::date, p_metrica) as x
    from generate_series(p_fecha - 28, p_fecha - 1, interval '1 day') d
  )
  select case when count(x) >= 5 then avg(x) end from v
$$;

-- ¿Cumple la condición ese día? Si falta el dato (o la media), no.
create or replace function public._cumple(p_perfil uuid, p_fecha date, c jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v numeric; lim numeric;
begin
  v := _valor_metrica(p_perfil, p_fecha, c ->> 'metrica');
  if v is null then return false; end if;
  if c ->> 'referencia' = 'media' then
    lim := _media_metrica(p_perfil, p_fecha, c ->> 'metrica');
    if lim is null then return false; end if;
    lim := lim + coalesce((c ->> 'valor')::numeric, 0);
  else
    lim := (c ->> 'valor')::numeric;
    if lim is null then return false; end if;
  end if;
  return case c ->> 'comparador'
    when 'menor' then v < lim when 'menor_igual' then v <= lim
    when 'mayor' then v > lim when 'mayor_igual' then v >= lim else false end;
end $$;

-- ¿Cumple la regla en cada uno de los últimos «dias» días hasta p_fecha?
create or replace function public._cumple_regla(p_perfil uuid, p_fecha date, r public.alertas_reglas) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare d integer; c jsonb; alguna boolean; todas boolean;
begin
  if jsonb_array_length(r.condiciones) = 0 then return false; end if;
  for d in 0 .. r.dias - 1 loop
    alguna := false; todas := true;
    for c in select * from jsonb_array_elements(r.condiciones) loop
      if _cumple(p_perfil, p_fecha - d, c) then alguna := true; else todas := false; end if;
    end loop;
    if (r.modo = 'todas' and not todas) or (r.modo = 'alguna' and not alguna) then return false; end if;
  end loop;
  return true;
end $$;

-- Guardar una regla (nueva si p_id es null). Solo con Sports Science Hub «editar» o admin.
create or replace function public.guardar_alerta(p_id uuid, p_nombre text, p_activa boolean, p_modo text, p_dias integer, p_condiciones jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_id uuid; c jsonb; n integer;
begin
  if v_club is null then raise exception 'Sin sesión.'; end if;
  if not (soy_admin() or nivel_de(yo(), 'sports_science') = 'editar') then
    raise exception 'Hace falta permiso para editar el Sports Science Hub.';
  end if;
  if coalesce(length(trim(p_nombre)), 0) = 0 or length(trim(p_nombre)) > 80 then raise exception 'Poné un nombre (hasta 80 letras).'; end if;
  if p_modo not in ('todas', 'alguna') then raise exception 'Modo no válido.'; end if;
  if p_dias is null or p_dias not between 1 and 7 then raise exception 'Los días seguidos van de 1 a 7.'; end if;
  if jsonb_typeof(p_condiciones) <> 'array' then raise exception 'Condiciones no válidas.'; end if;
  n := jsonb_array_length(p_condiciones);
  if n not between 1 and 6 then raise exception 'Poné entre 1 y 6 condiciones.'; end if;
  for c in select * from jsonb_array_elements(p_condiciones) loop
    if jsonb_typeof(c) <> 'object'
       or c ->> 'metrica' not in ('sueno', 'fatiga', 'estres', 'dolor', 'preparacion', 'rpe')
       or c ->> 'comparador' not in ('menor', 'menor_igual', 'mayor', 'mayor_igual')
       or c ->> 'referencia' not in ('valor', 'media')
       or jsonb_typeof(c -> 'valor') <> 'number'
       or abs((c ->> 'valor')::numeric) > 10 then
      raise exception 'Hay una condición incompleta.';
    end if;
  end loop;
  -- Solo se guardan los campos conocidos.
  p_condiciones := (select jsonb_agg(jsonb_build_object('metrica', c2 ->> 'metrica', 'comparador', c2 ->> 'comparador',
                     'referencia', c2 ->> 'referencia', 'valor', (c2 ->> 'valor')::numeric)) from jsonb_array_elements(p_condiciones) c2);
  if p_id is null then
    insert into alertas_reglas (club_id, nombre, activa, modo, dias, condiciones, creado_por)
    values (v_club, trim(p_nombre), coalesce(p_activa, true), p_modo, p_dias, p_condiciones, yo())
    returning id into v_id;
    perform _registrar(v_club, 'creó la alerta «' || trim(p_nombre) || '».');
  else
    update alertas_reglas set nombre = trim(p_nombre), activa = coalesce(p_activa, true), modo = p_modo, dias = p_dias,
      condiciones = p_condiciones, actualizado_en = now()
    where id = p_id and club_id = v_club returning id into v_id;
    if v_id is null then raise exception 'Esa alerta no existe.'; end if;
    perform _registrar(v_club, 'cambió la alerta «' || trim(p_nombre) || '».');
  end if;
  return v_id;
end $$;

create or replace function public.eliminar_alerta(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_nombre text;
begin
  if v_club is null then raise exception 'Sin sesión.'; end if;
  if not (soy_admin() or nivel_de(yo(), 'sports_science') = 'editar') then
    raise exception 'Hace falta permiso para editar el Sports Science Hub.';
  end if;
  delete from alertas_reglas where id = p_id and club_id = v_club returning nombre into v_nombre;
  if v_nombre is null then raise exception 'Esa alerta no existe.'; end if;
  perform _registrar(v_club, 'borró la alerta «' || v_nombre || '».');
end $$;

-- La llama solo el servidor (api/avisos.js) cada 5 minutos: revisa las reglas de hoy,
-- anota las nuevas y devuelve a quién mandarle el aviso (todo el staff deportivo con su celular activado).
create or replace function public.tomar_alertas()
returns table (endpoint text, p256dh text, auth text, titulo text, cuerpo text, url text, tag text, fecha date)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r alertas_reglas; j record; v_hoy date; v_id uuid; v_txt text;
begin
  for r in select a.* from alertas_reglas a join clubs c on c.id = a.club_id
           where a.activa and c.estado = 'activa' loop
    v_hoy := hoy_club(r.club_id);
    for j in select p.id, p.nombre from perfiles p join roles ro on ro.id = p.rol_id
             where p.club_id = r.club_id and p.eliminado_en is null and ro.es_jugador loop
      if exists (select 1 from alertas_disparadas d where d.regla_id = r.id and d.perfil_id = j.id and d.fecha = v_hoy) then continue; end if;
      if not _cumple_regla(j.id, v_hoy, r) then continue; end if;
      v_txt := j.nombre || ': ' || r.nombre || case when r.dias > 1 then ' (' || r.dias || ' días seguidos)' else '' end;
      insert into alertas_disparadas (club_id, regla_id, perfil_id, fecha, detalle, avisado_en)
      values (r.club_id, r.id, j.id, v_hoy, v_txt, now())
      on conflict do nothing returning id into v_id;
      if v_id is null then continue; end if;
      return query
        select s.endpoint, s.p256dh, s.auth, ('⚠ Alerta: ' || j.nombre)::text, v_txt, '/sports-science?pestana=alertas'::text,
               ('alerta-' || v_id::text)::text, v_hoy
        from push_suscripciones s
        join perfiles st on st.id = s.perfil_id
        join roles rs on rs.id = st.rol_id
        where st.club_id = r.club_id and st.eliminado_en is null
          and rs.clave in ('principal', 'ayudante', 'skills', 'pf', 'fisio')
          and nivel_de(st.id, 'sports_science') <> 'sin';
    end loop;
  end loop;
end $$;

-- ---------- 2. Sumar persona (el admin crea la cuenta) ----------
-- Paso 1 (antes de crear la cuenta): ¿puede este admin sumar a alguien con ese rol y grupo? Devuelve su club.
drop function if exists public.puedo_sumar_persona(uuid, uuid);
create or replace function public.puedo_sumar_persona(p_rol uuid, p_grupo uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club();
begin
  if not soy_admin() then raise exception 'Solo un administrador puede sumar personas.'; end if;
  if not exists (select 1 from roles where id = p_rol and club_id = v_club) then raise exception 'Rol no válido.'; end if;
  if p_grupo is not null and not exists (select 1 from grupos where id = p_grupo and club_id = v_club) then
    raise exception 'Grupo no válido.';
  end if;
  return v_club;
end $$;

-- Paso 2 (con la cuenta recién creada por el servidor): crea el perfil en el club.
-- Solo vale para una cuenta que el servidor acaba de crear para ESTE club (marca en app_metadata,
-- que solo puede poner el servidor), hace minutos, que nunca entró y que no está en ninguna organización:
-- así nadie puede «adoptar» la cuenta de otra persona.
create or replace function public.sumar_persona(p_user uuid, p_email text, p_nombre text, p_rol uuid, p_grupo uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); u record; ro roles; v_nombre text := left(trim(coalesce(p_nombre, '')), 120);
begin
  if not soy_admin() then raise exception 'Solo un administrador puede sumar personas.'; end if;
  if v_nombre = '' then raise exception 'Falta el nombre.'; end if;
  select * into ro from roles where id = p_rol and club_id = v_club;
  if not found then raise exception 'Rol no válido.'; end if;
  if p_grupo is not null and not exists (select 1 from grupos where id = p_grupo and club_id = v_club) then
    raise exception 'Grupo no válido.';
  end if;
  select id, email, created_at, last_sign_in_at, raw_app_meta_data into u from auth.users where id = p_user;
  if u.id is null or lower(u.email) <> lower(trim(p_email)) or u.created_at < now() - interval '10 minutes'
     or u.last_sign_in_at is not null
     or coalesce(u.raw_app_meta_data ->> 'sumado_en_club', '') <> v_club::text
     or exists (select 1 from perfiles where user_id = p_user or id = p_user)
     or exists (select 1 from duenos_plataforma where user_id = p_user) then
    raise exception 'Esa cuenta no se puede sumar así.';
  end if;
  insert into perfiles (id, user_id, club_id, nombre, email, rol_id, es_admin, debe_cambiar_clave)
  values (p_user, p_user, v_club, v_nombre, u.email, ro.id, false, true);
  if p_grupo is not null and ro.es_jugador then
    insert into grupo_miembros (grupo_id, perfil_id) values (p_grupo, p_user);
  end if;
  insert into perfil_activo (user_id, perfil_id) values (p_user, p_user)
  on conflict (user_id) do update set perfil_id = excluded.perfil_id, cambiado_en = now();
  perform _registrar(v_club, 'sumó a ' || v_nombre || ' como ' || ro.nombre || ' (con contraseña temporal).');
  return p_user;
end $$;

-- La primera vez que entra, la persona acepta el uso de sus datos de salud.
create or replace function public.aceptar_consentimiento() returns void
language sql security definer set search_path = public as $$
  update perfiles set consentimiento_en = coalesce(consentimiento_en, now()) where id = (select public.yo());
$$;

-- ---------- 3. Plataforma: eliminar una organización (solo el dueño) ----------
-- Borra la organización y TODO lo suyo (personas, calendario, entrenos, wellness, RPE…). No se puede deshacer.
-- Las cuentas siguen existiendo: si alguien está también en otra organización, sigue entrando a esa.
-- Pide el nombre exacto como confirmación, para que un toque equivocado no borre otra.
create or replace function public.plataforma_eliminar_organizacion(p_club uuid, p_nombre text) returns void
language plpgsql security definer set search_path = public as $$
declare c clubs;
begin
  if not soy_dueno() then raise exception 'Solo el dueño de la plataforma.'; end if;
  select * into c from clubs where id = p_club for update;
  if not found then raise exception 'Organización no encontrada.'; end if;
  if c.nombre is distinct from p_nombre then raise exception 'El nombre no coincide.'; end if;
  -- Quien tenía esta organización como activa pasa a otra suya (si tiene).
  update perfil_activo pa set perfil_id = otro.id, cambiado_en = now()
  from perfiles viejo, lateral (select o.id from perfiles o where o.user_id = viejo.user_id and o.club_id <> p_club and o.eliminado_en is null order by o.creado_en limit 1) otro
  where pa.perfil_id = viejo.id and viejo.club_id = p_club;
  delete from clubs where id = p_club;
end $$;

-- ---------- Permisos de las funciones ----------
revoke all on function public._valor_metrica(uuid, date, text) from public, anon, authenticated;
revoke all on function public._media_metrica(uuid, date, text) from public, anon, authenticated;
revoke all on function public._cumple(uuid, date, jsonb) from public, anon, authenticated;
revoke all on function public._cumple_regla(uuid, date, public.alertas_reglas) from public, anon, authenticated;
revoke all on function public.guardar_alerta(uuid, text, boolean, text, integer, jsonb) from public, anon;
revoke all on function public.eliminar_alerta(uuid) from public, anon;
revoke all on function public.tomar_alertas() from public, anon, authenticated;
revoke all on function public.puedo_sumar_persona(uuid, uuid) from public, anon;
revoke all on function public.sumar_persona(uuid, text, text, uuid, uuid) from public, anon;
revoke all on function public.aceptar_consentimiento() from public, anon;
revoke all on function public.plataforma_eliminar_organizacion(uuid, text) from public, anon;
grant execute on function public.guardar_alerta(uuid, text, boolean, text, integer, jsonb) to authenticated;
grant execute on function public.eliminar_alerta(uuid) to authenticated;
grant execute on function public.puedo_sumar_persona(uuid, uuid) to authenticated;
grant execute on function public.sumar_persona(uuid, text, text, uuid, uuid) to authenticated;
grant execute on function public.aceptar_consentimiento() to authenticated;
grant execute on function public.plataforma_eliminar_organizacion(uuid, text) to authenticated;
grant execute on function public.tomar_alertas() to service_role;

-- Comprobación: tiene que mostrar 2 | 0 (dos tablas nuevas; ninguna función nueva abierta sin sesión).
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename in ('alertas_reglas', 'alertas_disparadas') and rowsecurity) as tablas_con_rls,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('guardar_alerta', 'eliminar_alerta', 'tomar_alertas', 'puedo_sumar_persona', 'sumar_persona', 'aceptar_consentimiento', 'plataforma_eliminar_organizacion', '_valor_metrica', '_media_metrica', '_cumple', '_cumple_regla')
     and has_function_privilege('anon', oid, 'execute')) as abiertas_sin_sesion;
