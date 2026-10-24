-- =====================================================================
-- Módulo 1 · Usuarios, roles, grupos y alta con código
-- Pegar entero en Supabase → SQL Editor → Run. Se puede ejecutar una sola vez.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tablas ----------

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  sede_local text,
  temporada text,
  creado_en timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  clave text not null,
  nombre text not null,
  es_jugador boolean not null default false,
  permisos jsonb not null,
  creado_en timestamptz not null default now(),
  unique (club_id, clave)
);

create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  nombre text not null,
  email text not null,
  rol_id uuid not null references public.roles(id),
  es_admin boolean not null default false,
  permisos_ajustados jsonb,
  consentimiento_en timestamptz,
  eliminado_en timestamptz,
  creado_en timestamptz not null default now()
);

create table public.grupos (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  nombre text not null,
  creado_en timestamptz not null default now(),
  unique (club_id, nombre)
);

create table public.grupo_miembros (
  grupo_id uuid not null references public.grupos(id) on delete cascade,
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  primary key (grupo_id, perfil_id)
);

create table public.codigos_alta (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  codigo text not null unique,
  rol_id uuid not null references public.roles(id),
  grupo_id uuid references public.grupos(id) on delete set null,
  da_admin boolean not null default false,
  usos_max integer,              -- null = varios usos
  usos integer not null default 0,
  caduca_en timestamptz not null,
  revocado boolean not null default false,
  creado_por uuid references public.perfiles(id),
  creado_en timestamptz not null default now()
);

create table public.registro_cambios (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  actor_id uuid,
  actor_nombre text,
  accion text not null,
  creado_en timestamptz not null default now()
);

-- ---------- Funciones de ayuda ----------

create or replace function public.mi_club() returns uuid
language sql stable security definer set search_path = public as $$
  select club_id from perfiles where id = auth.uid() and eliminado_en is null
$$;

create or replace function public.soy_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select es_admin from perfiles where id = auth.uid() and eliminado_en is null), false)
$$;

create or replace function public._registrar(p_club uuid, p_accion text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into registro_cambios (club_id, actor_id, actor_nombre, accion)
  values (p_club, auth.uid(), (select nombre from perfiles where id = auth.uid()), p_accion);
end $$;

-- ---------- Seguridad por filas (cada club solo ve lo suyo) ----------

alter table public.clubs enable row level security;
alter table public.roles enable row level security;
alter table public.perfiles enable row level security;
alter table public.grupos enable row level security;
alter table public.grupo_miembros enable row level security;
alter table public.codigos_alta enable row level security;
alter table public.registro_cambios enable row level security;

create policy clubs_ver on public.clubs for select using (id = public.mi_club());

create policy roles_ver on public.roles for select using (club_id = public.mi_club());

create policy perfiles_ver on public.perfiles for select
  using (club_id = public.mi_club() and (eliminado_en is null or public.soy_admin()));

create policy grupos_ver on public.grupos for select using (club_id = public.mi_club());

create policy miembros_ver on public.grupo_miembros for select
  using (exists (select 1 from public.grupos g where g.id = grupo_id and g.club_id = public.mi_club()));

create policy codigos_ver on public.codigos_alta for select
  using (club_id = public.mi_club() and public.soy_admin());

create policy registro_ver on public.registro_cambios for select
  using (club_id = public.mi_club() and public.soy_admin());

-- Las escrituras se hacen solo a través de las funciones de abajo,
-- que comprueban permisos y dejan constancia en el registro de cambios.

-- ---------- Alta con código ----------

create or replace function public.ver_codigo(p_codigo text)
returns table (club text, rol text, grupo text, valido boolean, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare c codigos_alta;
begin
  select * into c from codigos_alta where codigo = upper(trim(p_codigo));
  if not found then
    return query select null::text, null::text, null::text, false, 'El código no existe.'; return;
  end if;
  if c.revocado then
    return query select null::text, null::text, null::text, false, 'Este código fue anulado.'; return;
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

create or replace function public.canjear_codigo(p_codigo text, p_nombre text)
returns void
language plpgsql security definer set search_path = public as $$
declare c codigos_alta; v_email text; v_rol text;
begin
  if auth.uid() is null then raise exception 'Tienes que crear la cuenta primero.'; end if;
  if exists (select 1 from perfiles where id = auth.uid()) then raise exception 'Esta cuenta ya está dada de alta.'; end if;
  select * into c from codigos_alta where codigo = upper(trim(p_codigo)) for update;
  if not found or c.revocado or c.caduca_en < now() or (c.usos_max is not null and c.usos >= c.usos_max) then
    raise exception 'El código no es válido.';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into perfiles (id, club_id, nombre, email, rol_id, es_admin, consentimiento_en)
  values (auth.uid(), c.club_id, trim(p_nombre), v_email, c.rol_id, c.da_admin, now());
  if c.grupo_id is not null then
    insert into grupo_miembros (grupo_id, perfil_id) values (c.grupo_id, auth.uid());
  end if;
  update codigos_alta set usos = usos + 1 where id = c.id;
  select nombre into v_rol from roles where id = c.rol_id;
  perform _registrar(c.club_id, 'se dio de alta con el código ' || c.codigo || ' como ' || v_rol
    || case when c.da_admin then ' (administrador)' else '' end || '.');
end $$;

create or replace function public.crear_codigo(p_rol uuid, p_grupo uuid default null)
returns table (codigo text, caduca_en timestamptz, usos_max integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_club uuid := mi_club(); r roles; v_codigo text; v_prefijo text;
        v_alfabeto text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if not soy_admin() then raise exception 'Solo un administrador puede crear códigos.'; end if;
  select * into r from roles where id = p_rol and club_id = v_club;
  if not found then raise exception 'Rol no válido.'; end if;
  if p_grupo is not null and not exists (select 1 from grupos where id = p_grupo and club_id = v_club) then
    raise exception 'Grupo no válido.';
  end if;
  select upper(string_agg(left(w, 1), '')) into v_prefijo
    from (select w from regexp_split_to_table((select nombre from clubs where id = v_club), '\s+') w limit 2) x;
  loop
    v_codigo := coalesce(v_prefijo, 'CL') || '-';
    for i in 1..4 loop
      v_codigo := v_codigo || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    end loop;
    exit when not exists (select 1 from codigos_alta where codigos_alta.codigo = v_codigo);
  end loop;
  insert into codigos_alta (club_id, codigo, rol_id, grupo_id, usos_max, caduca_en, creado_por)
  values (v_club, v_codigo, r.id, case when r.es_jugador then p_grupo else null end,
          case when r.es_jugador then null else 1 end,
          now() + case when r.es_jugador then interval '7 days' else interval '48 hours' end,
          auth.uid());
  perform _registrar(v_club, 'creó el código de alta ' || v_codigo || ' para ' || r.nombre || '.');
  return query select a.codigo, a.caduca_en, a.usos_max from codigos_alta a where a.codigo = v_codigo;
end $$;

-- ---------- Gestión de miembros ----------

create or replace function public.actualizar_miembro(
  p_perfil uuid, p_rol uuid, p_admin boolean, p_permisos jsonb, p_grupos uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); p perfiles; r_nuevo roles; r_viejo roles; v_cambios text[] := '{}';
begin
  if not soy_admin() then raise exception 'Solo un administrador puede editar personas.'; end if;
  select * into p from perfiles where id = p_perfil and club_id = v_club and eliminado_en is null;
  if not found then raise exception 'Persona no encontrada.'; end if;
  select * into r_nuevo from roles where id = p_rol and club_id = v_club;
  if not found then raise exception 'Rol no válido.'; end if;
  select * into r_viejo from roles where id = p.rol_id;

  if p.es_admin and not p_admin and
     (select count(*) from perfiles where club_id = v_club and es_admin and eliminado_en is null) <= 1 then
    raise exception 'Tiene que quedar al menos un administrador.';
  end if;

  if r_nuevo.id <> r_viejo.id then v_cambios := v_cambios || ('rol: ' || r_viejo.nombre || ' → ' || r_nuevo.nombre); end if;
  if p_admin and not p.es_admin then v_cambios := v_cambios || 'lo nombró administrador'::text; end if;
  if not p_admin and p.es_admin then v_cambios := v_cambios || 'le quitó la administración'::text; end if;
  if coalesce(p_permisos, 'null'::jsonb) is distinct from coalesce(p.permisos_ajustados, 'null'::jsonb) then
    v_cambios := v_cambios || (case when p_permisos is null then 'restableció los permisos del rol' else 'ajustó sus permisos' end);
  end if;

  update perfiles set rol_id = r_nuevo.id, es_admin = p_admin, permisos_ajustados = p_permisos where id = p.id;

  delete from grupo_miembros where perfil_id = p.id;
  if r_nuevo.es_jugador and p_grupos is not null then
    insert into grupo_miembros (grupo_id, perfil_id)
    select g.id, p.id from grupos g where g.id = any(p_grupos) and g.club_id = v_club;
  end if;

  if array_length(v_cambios, 1) > 0 then
    perform _registrar(v_club, 'editó a ' || p.nombre || ': ' || array_to_string(v_cambios, '; ') || '.');
  end if;
end $$;

create or replace function public.eliminar_miembro(p_perfil uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); p perfiles;
begin
  if not soy_admin() then raise exception 'Solo un administrador puede eliminar personas.'; end if;
  select * into p from perfiles where id = p_perfil and club_id = v_club and eliminado_en is null;
  if not found then raise exception 'Persona no encontrada.'; end if;
  if p.es_admin and (select count(*) from perfiles where club_id = v_club and es_admin and eliminado_en is null) <= 1 then
    raise exception 'Es el único administrador: nombra a otro antes de eliminarlo.';
  end if;
  update perfiles set eliminado_en = now(), es_admin = false where id = p.id;
  delete from grupo_miembros where perfil_id = p.id;
  perform _registrar(v_club, 'eliminó a ' || p.nombre || ' (sus datos de la temporada se conservan).');
end $$;

create or replace function public.crear_grupo(p_nombre text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_id uuid;
begin
  if not soy_admin() then raise exception 'Solo un administrador puede crear grupos.'; end if;
  insert into grupos (club_id, nombre) values (v_club, trim(p_nombre)) returning id into v_id;
  perform _registrar(v_club, 'creó el grupo ' || trim(p_nombre) || '.');
  return v_id;
end $$;

create or replace function public.crear_rol(p_nombre text, p_permisos jsonb, p_es_jugador boolean default false)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_id uuid;
begin
  if not soy_admin() then raise exception 'Solo un administrador puede crear roles.'; end if;
  insert into roles (club_id, clave, nombre, es_jugador, permisos)
  values (v_club, 'custom-' || substr(gen_random_uuid()::text, 1, 8), trim(p_nombre), p_es_jugador, p_permisos)
  returning id into v_id;
  perform _registrar(v_club, 'creó el rol ' || trim(p_nombre) || '.');
  return v_id;
end $$;

-- ---------- Permisos de ejecución ----------

revoke all on function public._registrar(uuid, text) from public, anon, authenticated;
grant execute on function public.ver_codigo(text) to anon, authenticated;
grant execute on function public.canjear_codigo(text, text) to authenticated;
grant execute on function public.crear_codigo(uuid, uuid) to authenticated;
grant execute on function public.actualizar_miembro(uuid, uuid, boolean, jsonb, uuid[]) to authenticated;
grant execute on function public.eliminar_miembro(uuid) to authenticated;
grant execute on function public.crear_grupo(text) to authenticated;
grant execute on function public.crear_rol(text, jsonb, boolean) to authenticated;

-- =====================================================================
-- Datos iniciales del club
-- =====================================================================

do $$
declare v_club uuid; v_pf uuid;
  sin  jsonb := '{"nivel":"sin","exporta":false}';
  ver  jsonb := '{"nivel":"ver","exporta":false}';
  pro  jsonb := '{"nivel":"propio","exporta":false}';
  edi  jsonb := '{"nivel":"editar","exporta":false}';
begin
  insert into clubs (nombre, sede_local, temporada)
  values ('Casademont Zaragoza', 'P. Felipe', '26/27') returning id into v_club;

  insert into roles (club_id, clave, nombre, es_jugador, permisos) values
  (v_club, 'principal', 'Entrenador principal', false, jsonb_build_object('calendario', ver, 'sports_science', ver, 'workout_builder', sin, 'estadisticas', ver, 'usuarios', sin)),
  (v_club, 'ayudante',  'Entrenador ayudante',  false, jsonb_build_object('calendario', ver, 'sports_science', ver, 'workout_builder', sin, 'estadisticas', ver, 'usuarios', sin)),
  (v_club, 'skills',    'Entrenador de skills', false, jsonb_build_object('calendario', ver, 'sports_science', ver, 'workout_builder', sin, 'estadisticas', ver, 'usuarios', sin)),
  (v_club, 'pf',        'Preparador físico',    false, jsonb_build_object('calendario', pro, 'sports_science', edi, 'workout_builder', edi, 'estadisticas', sin, 'usuarios', sin)),
  (v_club, 'fisio',     'Fisioterapeuta',       false, jsonb_build_object('calendario', pro, 'sports_science', edi, 'workout_builder', edi, 'estadisticas', sin, 'usuarios', sin)),
  (v_club, 'delegado',  'Delegado',             false, jsonb_build_object('calendario', '{"nivel":"propio","exporta":true}'::jsonb, 'sports_science', sin, 'workout_builder', sin, 'estadisticas', sin, 'usuarios', sin)),
  (v_club, 'utilero',   'Utilero',              false, jsonb_build_object('calendario', ver, 'sports_science', sin, 'workout_builder', sin, 'estadisticas', sin, 'usuarios', sin)),
  (v_club, 'clevel',    'C-level',              false, jsonb_build_object('calendario', ver, 'sports_science', ver, 'workout_builder', sin, 'estadisticas', sin, 'usuarios', sin)),
  (v_club, 'prensa',    'Prensa y sponsors',    false, jsonb_build_object('calendario', pro, 'sports_science', sin, 'workout_builder', sin, 'estadisticas', sin, 'usuarios', sin)),
  (v_club, 'jugador',   'Jugador',              true,  jsonb_build_object('calendario', ver, 'sports_science', pro, 'workout_builder', pro, 'estadisticas', sin, 'usuarios', sin));

  insert into grupos (club_id, nombre) values
  (v_club, 'ACB 1, 2 y 3'), (v_club, 'ACB 4 y 5'), (v_club, 'JR-U18'), (v_club, 'U22');

  select id into v_pf from roles where club_id = v_club and clave = 'pf';

  -- Código de arranque: un solo uso, te da de alta como Preparador físico y administrador.
  insert into codigos_alta (club_id, codigo, rol_id, da_admin, usos_max, caduca_en)
  values (v_club, 'CZ-ADMIN-7Q4M', v_pf, true, 1, now() + interval '14 days');
end $$;
