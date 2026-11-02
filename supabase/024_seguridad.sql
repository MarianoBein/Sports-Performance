-- =====================================================================
-- 024 · Seguridad (auditoría del 2/11/2026)
-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr más de una vez.
-- Antes de correrlo: que Vercel ya haya publicado la versión nueva de la app.
--
-- 1. Códigos de alta largos y con azar criptográfico. Los de antes tenían 4 letras
--    al azar (~1 millón de combinaciones) y se podían adivinar probando sin iniciar
--    sesión. Los códigos viejos que seguían activos se anulan: generá uno nuevo.
-- 2. Las notas privadas del dueño de la plataforma pasan a una tabla aparte: la
--    gente del club ya no las puede leer.
-- 3. El email de cada persona solo lo ven los administradores y quien entra a Usuarios.
-- 4. Las funciones internas ya no responden sobre personas o actividades de otro club.
-- 5. Sin sesión iniciada solo funcionan el alta con código y el calendario por token.
-- 6. Escudos: no se aceptan SVG (pueden llevar código) y el link tiene que ser https.
-- =====================================================================

-- ---------- 1. Códigos de alta ----------

-- Azar criptográfico: gen_random_uuid() sale del generador seguro del sistema.
create or replace function public._azar(n integer) returns text
language plpgsql volatile set search_path = public as $$
declare
  v_alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 signos: sin I, O, 0 ni 1
  b bytea; v text := ''; i int;
begin
  while length(v) < n loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    for i in 0..15 loop
      continue when i in (6, 8);   -- esos dos bytes llevan la versión del uuid (no son al azar)
      exit when length(v) >= n;
      v := v || substr(v_alfabeto, 1 + (get_byte(b, i) % 32), 1);
    end loop;
  end loop;
  return v;
end $$;

-- «cz-k7qm4 xtpr9» y «CZ-K7QM4-XTPR9» son el mismo código.
create or replace function public._codigo_normal(p text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g')
$$;

create or replace function public._prefijo_club(p_club uuid) returns text
language sql stable set search_path = public as $$
  select coalesce(nullif(_codigo_normal(string_agg(left(w, 1), '')), ''), 'CL')
  from (select w from regexp_split_to_table((select nombre from clubs where id = p_club), '\s+') w where w <> '' limit 2) x
$$;

-- Ej.: CZ-K7QM4-XTPR9 (10 signos al azar: más de mil billones de combinaciones).
create or replace function public._codigo_nuevo(p_club uuid, p_admin boolean) returns text
language plpgsql volatile set search_path = public as $$
declare v text;
begin
  loop
    v := _prefijo_club(p_club) || case when p_admin then '-ADMIN-' else '-' end || _azar(5) || '-' || _azar(5);
    exit when not exists (select 1 from codigos_alta where _codigo_normal(codigo) = _codigo_normal(v));
  end loop;
  return v;
end $$;

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
          now() + case when r.es_jugador then interval '7 days' else interval '48 hours' end,
          (select public.yo()));
  perform _registrar(v_club, 'creó el código de alta ' || v_codigo || ' para ' || r.nombre || '.');
  return query select a.codigo, a.caduca_en, a.usos_max from codigos_alta a where a.codigo = v_codigo;
end $$;

create or replace function public._codigo_admin(p_club uuid, p_rol_clave text) returns text
language plpgsql security definer set search_path = public as $$
declare v_rol uuid; v_codigo text;
begin
  select id into v_rol from roles where club_id = p_club and clave = coalesce(p_rol_clave, 'principal');
  if v_rol is null then select id into v_rol from roles where club_id = p_club and clave = 'principal'; end if;
  v_codigo := _codigo_nuevo(p_club, true);
  insert into codigos_alta (club_id, codigo, rol_id, da_admin, usos_max, caduca_en)
  values (p_club, v_codigo, v_rol, true, 1, now() + interval '14 days');
  return v_codigo;
end $$;

create or replace function public.ver_codigo(p_codigo text)
returns table (club text, rol text, grupo text, valido boolean, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare c codigos_alta;
begin
  select * into c from codigos_alta
  where _codigo_normal(codigo) = _codigo_normal(p_codigo) and _codigo_normal(p_codigo) <> '';
  if not found then
    return query select null::text, null::text, null::text, false, 'El código no existe.'; return;
  end if;
  if c.revocado then
    return query select null::text, null::text, null::text, false, 'Este código fue anulado. Pide uno nuevo.'; return;
  end if;
  if c.caduca_en < now() then
    return query select null::text, null::text, null::text, false, 'Este código caducó. Pide uno nuevo.'; return;
  end if;
  if c.usos_max is not null and c.usos >= c.usos_max then
    return query select null::text, null::text, null::text, false, 'Este código ya se usó.'; return;
  end if;
  return query
    select cl.nombre, r.nombre, g.nombre, true, null::text
    from clubs cl join roles r on r.id = c.rol_id
    left join grupos g on g.id = c.grupo_id
    where cl.id = c.club_id;
end $$;

create or replace function public.canjear_codigo(p_codigo text, p_nombre text) returns void
language plpgsql security definer set search_path = public as $$
declare c codigos_alta; v_email text; v_rol text; v_id uuid; v_nombre text;
begin
  if auth.uid() is null then raise exception 'Tienes que crear la cuenta primero.'; end if;
  select * into c from codigos_alta
  where _codigo_normal(codigo) = _codigo_normal(p_codigo) and _codigo_normal(p_codigo) <> ''
  for update;
  if not found or c.revocado or c.caduca_en < now() or (c.usos_max is not null and c.usos >= c.usos_max) then
    raise exception 'El código no es válido.';
  end if;
  if exists (select 1 from perfiles where user_id = auth.uid() and club_id = c.club_id and eliminado_en is null) then
    raise exception 'Ya sos parte de esta organización.';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  v_nombre := coalesce(nullif(left(trim(p_nombre), 120), ''),
                       (select nombre from perfiles where user_id = auth.uid() order by creado_en limit 1));
  if v_nombre is null then raise exception 'Falta el nombre.'; end if;
  -- La primera vez el perfil usa el mismo id que la cuenta (como siempre); las siguientes, uno nuevo.
  v_id := case when exists (select 1 from perfiles where id = auth.uid()) then gen_random_uuid() else auth.uid() end;
  insert into perfiles (id, user_id, club_id, nombre, email, rol_id, es_admin, consentimiento_en)
  values (v_id, auth.uid(), c.club_id, v_nombre, v_email, c.rol_id, c.da_admin, now());
  if c.grupo_id is not null then
    insert into grupo_miembros (grupo_id, perfil_id) values (c.grupo_id, v_id);
  end if;
  update codigos_alta set usos = usos + 1 where id = c.id;
  -- Entra directo a la organización nueva.
  insert into perfil_activo (user_id, perfil_id) values (auth.uid(), v_id)
  on conflict (user_id) do update set perfil_id = excluded.perfil_id, cambiado_en = now();
  select nombre into v_rol from roles where id = c.rol_id;
  perform _registrar(c.club_id, 'se dio de alta con el código ' || c.codigo || ' como ' || v_rol
    || case when c.da_admin then ' (administrador)' else '' end || '.');
end $$;

-- Los códigos cortos que seguían activos se anulan (los usados o vencidos quedan como estaban).
update public.codigos_alta set revocado = true
where not revocado and caduca_en > now() and codigo !~ '-[A-Z0-9]{5}-[A-Z0-9]{5}$';

-- ---------- 2. Notas privadas del dueño, fuera de «clubs» ----------
create table if not exists public.notas_plataforma (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  notas text check (notas is null or length(notas) <= 4000),
  actualizado_en timestamptz not null default now()
);
alter table public.notas_plataforma enable row level security;   -- sin políticas: solo las funciones del dueño
revoke all on public.notas_plataforma from anon, authenticated;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'clubs' and column_name = 'notas_dueno') then
    insert into public.notas_plataforma (club_id, notas)
    select id, notas_dueno from public.clubs where notas_dueno is not null
    on conflict (club_id) do update set notas = excluded.notas;
    alter table public.clubs drop column notas_dueno;
  end if;
end $$;

create or replace function public.plataforma_actualizar_organizacion(p_club uuid, p_plan text, p_estado text, p_notas text) returns void
language plpgsql security definer set search_path = public as $$
declare c clubs;
begin
  if not soy_dueno() then raise exception 'Solo el dueño de la plataforma.'; end if;
  select * into c from clubs where id = p_club;
  if not found then raise exception 'Organización no encontrada.'; end if;
  update clubs set plan = p_plan, estado = p_estado where id = p_club;
  insert into notas_plataforma (club_id, notas, actualizado_en) values (p_club, nullif(btrim(coalesce(p_notas, '')), ''), now())
  on conflict (club_id) do update set notas = excluded.notas, actualizado_en = now();
  if c.estado is distinct from p_estado then
    insert into registro_cambios (club_id, actor_nombre, accion)
    values (p_club, 'Plataforma', 'cambió el estado de la organización: ' || c.estado || ' → ' || p_estado || '.');
  end if;
  if c.plan is distinct from p_plan then
    insert into registro_cambios (club_id, actor_nombre, accion)
    values (p_club, 'Plataforma', 'cambió el plan: ' || c.plan || ' → ' || p_plan || '.');
  end if;
end $$;

create or replace function public.plataforma_organizaciones()
returns table (id uuid, nombre text, tipo text, plan text, estado text, sede_local text, notas_dueno text, creado_en timestamptz,
               personas integer, jugadores integer, admins text, ultima_actividad timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not soy_dueno() then raise exception 'Solo el dueño de la plataforma.'; end if;
  return query
  select c.id, c.nombre, c.tipo, c.plan, c.estado, c.sede_local, n.notas, c.creado_en,
    (select count(*)::int from perfiles p where p.club_id = c.id and p.eliminado_en is null),
    (select count(*)::int from perfiles p join roles r on r.id = p.rol_id
       where p.club_id = c.id and p.eliminado_en is null and r.es_jugador),
    (select string_agg(p.nombre || ' <' || p.email || '>', ', ') from perfiles p
       where p.club_id = c.id and p.es_admin and p.eliminado_en is null),
    greatest(
      (select max(rc.creado_en) from registro_cambios rc where rc.club_id = c.id),
      (select max(p.creado_en) from perfiles p where p.club_id = c.id),
      c.creado_en)
  from clubs c left join notas_plataforma n on n.club_id = c.id
  order by c.creado_en desc;
end $$;

-- ---------- 3. Emails: solo administradores y quien entra a Usuarios ----------
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'perfiles' and column_name <> 'email';
  revoke select on public.perfiles from anon, authenticated;
  execute format('grant select (%s) on public.perfiles to authenticated', v_cols);
end $$;

create or replace function public.emails_del_club() returns table (perfil_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.email from perfiles p
  where p.club_id = mi_club() and (soy_admin() or nivel_de((select public.yo()), 'usuarios') <> 'sin')
$$;

-- ---------- 4. Funciones internas: solo sobre gente del propio club ----------
-- Responden por la persona misma o por gente de su club. Sin sesión (calendario por token,
-- avisos del servidor) siguen funcionando como antes. Un dato que no corresponde da «sin».
create or replace function public.nivel_de(p_perfil uuid, p_modulo text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when p.es_admin then 'editar'
                else coalesce(p.permisos_ajustados -> p_modulo ->> 'nivel', r.permisos -> p_modulo ->> 'nivel', 'sin') end
    from perfiles p join roles r on r.id = p.rol_id
    where p.id = p_perfil and p.eliminado_en is null
      and (auth.uid() is null or p.user_id = auth.uid() or p.club_id = (select public.mi_club()))
  ), 'sin')
$$;

create or replace function public.ve_actividad(p_perfil uuid, p_act uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from actividades a
    join perfiles p on p.id = p_perfil and p.club_id = a.club_id and p.eliminado_en is null
    join roles r on r.id = p.rol_id
    where a.id = p_act and a.eliminado_en is null
      and (auth.uid() is null or p.user_id = auth.uid() or p.club_id = (select public.mi_club()))
      and nivel_de(p.id, 'calendario') <> 'sin'
      and (not r.es_jugador or p.es_admin or a.creado_por = p.id
           or p.id in (select personas_de_actividad(a.id)))
  )
$$;

create or replace function public.puede_editar_actividad(p_perfil uuid, p_act uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from actividades a join perfiles p on p.id = p_perfil and p.club_id = a.club_id and p.eliminado_en is null
    where a.id = p_act and a.eliminado_en is null
      and (auth.uid() is null or p.user_id = auth.uid() or p.club_id = (select public.mi_club()))
      and (nivel_de(p_perfil, 'calendario') = 'editar' or (nivel_de(p_perfil, 'calendario') = 'propio' and a.creado_por = p_perfil))
  )
$$;

-- ---------- 6. Escudos ----------
update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'] where id = 'logos';

create or replace function public.actualizar_club(p_sede text, p_temporada text, p_logo_club text, p_logo_liga text) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); c clubs; v_cambios text[] := '{}';
begin
  if not soy_admin() then raise exception 'Solo un administrador puede cambiar los ajustes del club.'; end if;
  if (p_logo_club is not null and (p_logo_club !~ '^https://[^\s"''<>()]+$' or length(p_logo_club) > 500))
     or (p_logo_liga is not null and (p_logo_liga !~ '^https://[^\s"''<>()]+$' or length(p_logo_liga) > 500)) then
    raise exception 'El escudo tiene que ser un link que empiece con https://';
  end if;
  select * into c from clubs where id = v_club;
  if c.sede_local is distinct from nullif(trim(p_sede), '') then v_cambios := v_cambios || 'lugar habitual'::text; end if;
  if c.temporada is distinct from nullif(trim(p_temporada), '') then v_cambios := v_cambios || 'temporada'::text; end if;
  if c.logo_club_url is distinct from p_logo_club then v_cambios := v_cambios || 'escudo del club'::text; end if;
  if c.logo_liga_url is distinct from p_logo_liga then v_cambios := v_cambios || 'escudo de la liga'::text; end if;
  update clubs set sede_local = nullif(trim(p_sede), ''), temporada = nullif(trim(p_temporada), ''),
    logo_club_url = p_logo_club, logo_liga_url = p_logo_liga
  where id = v_club;
  if array_length(v_cambios, 1) > 0 then
    perform _registrar(v_club, 'cambió los ajustes del club: ' || array_to_string(v_cambios, ', ') || '.');
  end if;
end $$;

-- ---------- 5. Quién puede llamar a cada función ----------
-- a) Sin sesión: nada, salvo ver_codigo (pantalla de alta) e ics_eventos (calendario con token).
--    Con sesión: lo mismo que tenía.
do $$
declare f record; tenia boolean;
begin
  for f in
    select p.oid, p.oid::regprocedure as firma
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and p.proname not in ('ver_codigo', 'ics_eventos')
  loop
    tenia := has_function_privilege('authenticated', f.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', f.firma);
    if tenia then execute format('grant execute on function %s to authenticated', f.firma); end if;
  end loop;
end $$;

-- b) Auxiliares que la app nunca llama directo (las usan otras funciones por dentro).
revoke execute on function public.personas_de_actividad(uuid), public.personas_de_sesion(uuid),
  public.exporta_de(uuid, text), public.ahora_club(uuid), public.hoy_club(uuid),
  public.aplica_cuestionario(uuid, date, text), public.puede_ver_entreno(uuid), public.estado_de(uuid),
  public._azar(integer), public._codigo_normal(text), public._prefijo_club(uuid), public._codigo_nuevo(uuid, boolean)
from public, anon, authenticated;

-- c) Las que sí usa la app con sesión.
grant execute on function public.emails_del_club() to authenticated;

alter function public._uuid_o_nulo(text) set search_path = public;

-- ---------- Comprobación ----------
select
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')) as abiertas_sin_sesion,          -- tiene que ser 2
  not has_column_privilege('authenticated', 'public.perfiles', 'email', 'select') as email_protegido,  -- true
  not exists (select 1 from information_schema.columns where table_name = 'clubs' and column_name = 'notas_dueno') as notas_protegidas, -- true
  (select count(*) from public.codigos_alta where not revocado and caduca_en > now()) as codigos_activos;  -- 0 hasta que generes uno nuevo
