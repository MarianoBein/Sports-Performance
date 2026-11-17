-- =====================================================================
-- 029 · Tablero de disponibilidad (Sports Science Hub)
-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr más de una vez.
-- Necesita el 027 (alertas) y el 028 (partes de fisio).
-- Además: las alertas pueden contar «veces seguidas que respondió» en lugar de días seguidos.
--
-- El tablero sale de los partes de fisio:
--   · «Entrena: no» → Fuera.   · «Con restricciones» o «Pesas: no» → Adaptado.   · El resto, disponible.
-- Un jugador queda en el tablero hasta la fecha del rechequeo o hasta que le den el alta.
-- Como todavía no están todos en la app, el parte acepta un nombre escrito a mano
-- (por ejemplo «Mariano Bein») en lugar de elegir un jugador registrado.
-- =====================================================================

alter table public.partes_fisio alter column perfil_id drop not null;
alter table public.partes_fisio add column if not exists nombre_libre text;
alter table public.partes_fisio add column if not exists fecha_alta date;
alter table public.partes_fisio drop constraint if exists partes_fisio_quien;
alter table public.partes_fisio add constraint partes_fisio_quien
  check ((perfil_id is not null and nombre_libre is null) or (perfil_id is null and length(trim(nombre_libre)) between 1 and 120));

-- Guardar un parte: con un jugador registrado (p_perfil) o con un nombre escrito a mano (p_nombre_libre).
drop function if exists public.guardar_parte(uuid, uuid, date, text, text, text, text, date);
create or replace function public.guardar_parte(p_id uuid, p_perfil uuid, p_nombre_libre text, p_fecha date, p_motivo text, p_entrena text, p_pesas text,
  p_restricciones text default null, p_fecha_rechequeo date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_id uuid; v_nombre text; v_antes date;
begin
  if v_club is null then raise exception 'Sin sesión.'; end if;
  if not _edita_ssh() then raise exception 'Hace falta permiso para editar el Sports Science Hub.'; end if;
  p_nombre_libre := nullif(trim(coalesce(p_nombre_libre, '')), '');
  if p_perfil is not null then
    p_nombre_libre := null;
    select p.nombre into v_nombre from perfiles p join roles r on r.id = p.rol_id
      where p.id = p_perfil and p.club_id = v_club and p.eliminado_en is null and r.es_jugador;
    if v_nombre is null then raise exception 'Jugador no válido.'; end if;
  else
    if p_nombre_libre is null or length(p_nombre_libre) > 120 then raise exception 'Elegí un jugador o escribí su nombre.'; end if;
    v_nombre := p_nombre_libre;
  end if;
  if p_fecha is null or p_fecha > hoy_club(v_club) + 1 then raise exception 'Fecha no válida.'; end if;
  p_motivo := trim(coalesce(p_motivo, ''));
  if p_motivo = '' or length(p_motivo) > 2000 then raise exception 'Escribí el motivo (hasta 2000 letras).'; end if;
  if p_entrena not in ('si', 'no', 'restricciones') or p_pesas not in ('si', 'no', 'restricciones') then raise exception 'Respuesta no válida.'; end if;
  p_restricciones := nullif(trim(coalesce(p_restricciones, '')), '');
  if length(p_restricciones) > 1000 then raise exception 'Las restricciones son muy largas.'; end if;
  if p_fecha_rechequeo is not null and p_fecha_rechequeo < p_fecha then raise exception 'El rechequeo tiene que ser después del parte.'; end if;
  if p_id is null then
    insert into partes_fisio (club_id, perfil_id, nombre_libre, fecha, motivo, entrena, pesas, restricciones, fecha_rechequeo, creado_por)
    values (v_club, p_perfil, p_nombre_libre, p_fecha, p_motivo, p_entrena, p_pesas, p_restricciones, p_fecha_rechequeo, yo())
    returning id into v_id;
    perform _registrar(v_club, 'cargó un parte de fisio de ' || v_nombre || '.');
  else
    select fecha_rechequeo into v_antes from partes_fisio where id = p_id and club_id = v_club;
    update partes_fisio set perfil_id = p_perfil, nombre_libre = p_nombre_libre, fecha = p_fecha, motivo = p_motivo, entrena = p_entrena, pesas = p_pesas,
      restricciones = p_restricciones, fecha_rechequeo = p_fecha_rechequeo, actualizado_en = now(),
      rechequeo_avisado_en = case when p_fecha_rechequeo is distinct from v_antes then null else rechequeo_avisado_en end
    where id = p_id and club_id = v_club returning id into v_id;
    if v_id is null then raise exception 'Ese parte no existe.'; end if;
    perform _registrar(v_club, 'cambió un parte de fisio de ' || v_nombre || '.');
  end if;
  return v_id;
end $$;

-- Dar el alta (sale del tablero desde esa fecha). Con p_fecha null se deshace el alta.
create or replace function public.dar_alta_parte(p_id uuid, p_fecha date) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_nombre text;
begin
  if v_club is null then raise exception 'Sin sesión.'; end if;
  if not _edita_ssh() then raise exception 'Hace falta permiso para editar el Sports Science Hub.'; end if;
  update partes_fisio pf set fecha_alta = p_fecha, actualizado_en = now()
  where pf.id = p_id and pf.club_id = v_club and (p_fecha is null or p_fecha >= pf.fecha)
  returning coalesce((select nombre from perfiles where id = pf.perfil_id), pf.nombre_libre) into v_nombre;
  if v_nombre is null then raise exception 'Ese parte no existe (o el alta es antes del parte).'; end if;
  perform _registrar(v_club, case when p_fecha is null then 'quitó el alta de ' else 'dio el alta a ' end || v_nombre || '.');
end $$;

create or replace function public.eliminar_parte(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_nombre text;
begin
  if v_club is null then raise exception 'Sin sesión.'; end if;
  if not _edita_ssh() then raise exception 'Hace falta permiso para editar el Sports Science Hub.'; end if;
  delete from partes_fisio pf where pf.id = p_id and pf.club_id = v_club
  returning coalesce((select nombre from perfiles where id = pf.perfil_id), pf.nombre_libre) into v_nombre;
  if v_nombre is null then raise exception 'Ese parte no existe.'; end if;
  perform _registrar(v_club, 'borró un parte de fisio de ' || v_nombre || '.');
end $$;

-- Avisos: igual que en el 028, ahora también para los partes con nombre escrito a mano.
create or replace function public.tomar_partes()
returns table (endpoint text, p256dh text, auth text, titulo text, cuerpo text, url text, tag text, fecha date)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare p record; v_txt text;
  est constant jsonb := '{"si": "sí", "no": "no", "restricciones": "con restricciones"}';
begin
  for p in update partes_fisio pf set avisado_en = now()
           from clubs c
           where pf.avisado_en is null and c.id = pf.club_id and c.estado = 'activa' and pf.creado_en > now() - interval '3 days'
           returning pf.*, coalesce((select nombre from perfiles where id = pf.perfil_id), pf.nombre_libre) as jugador loop
    v_txt := 'Entrena: ' || (est ->> p.entrena) || ' · Pesas: ' || (est ->> p.pesas)
             || case when p.fecha_rechequeo is not null then ' · Rechequeo ' || to_char(p.fecha_rechequeo, 'DD/MM') else '' end;
    return query
      select s.endpoint, s.p256dh, s.auth, ('🩺 Parte de fisio: ' || p.jugador)::text, v_txt, '/sports-science?pestana=fisio'::text,
             ('parte-' || p.id::text)::text, hoy_club(p.club_id)
      from push_suscripciones s
      join perfiles st on st.id = s.perfil_id
      join roles rs on rs.id = st.rol_id
      where st.club_id = p.club_id and st.eliminado_en is null and st.id is distinct from p.creado_por
        and rs.clave in ('principal', 'ayudante', 'skills', 'pf', 'fisio')
        and nivel_de(st.id, 'sports_science') <> 'sin';
  end loop;
  for p in update partes_fisio pf set rechequeo_avisado_en = now()
           from clubs c
           where pf.rechequeo_avisado_en is null and pf.fecha_rechequeo is not null and pf.fecha_alta is null and c.id = pf.club_id
             and c.estado = 'activa' and pf.fecha_rechequeo = hoy_club(c.id)
             and (now() at time zone coalesce(c.zona_horaria, 'Europe/Madrid'))::time >= time '09:00'
           returning pf.*, coalesce((select nombre from perfiles where id = pf.perfil_id), pf.nombre_libre) as jugador loop
    return query
      select s.endpoint, s.p256dh, s.auth, ('Rechequeo hoy: ' || p.jugador)::text, left(p.motivo, 140), '/sports-science?pestana=fisio'::text,
             ('rechequeo-' || p.id::text)::text, p.fecha_rechequeo
      from push_suscripciones s
      join perfiles st on st.id = s.perfil_id
      join roles rs on rs.id = st.rol_id
      where st.club_id = p.club_id and st.eliminado_en is null
        and (st.id = p.creado_por or rs.clave = 'fisio')
        and nivel_de(st.id, 'sports_science') <> 'sin';
  end loop;
end $$;


-- ---------- Alertas: «N veces seguidas» salteando los días sin dato ----------
-- (Necesita el 027.) Para el RPE: si entrenan martes y jueves, el miércoles sin entreno no corta la racha.
-- Con esta opción la regla mira las últimas N veces que el jugador respondió (hasta 21 días hacia atrás),
-- y solo avisa el día en que llega la respuesta que completa la racha.
alter table public.alertas_reglas add column if not exists solo_con_dato boolean not null default false;

create or replace function public._cumple_regla(p_perfil uuid, p_fecha date, r public.alertas_reglas) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare d integer; c jsonb; alguna boolean; todas boolean; hay boolean; vistos integer := 0;
begin
  if jsonb_array_length(r.condiciones) = 0 then return false; end if;
  for d in 0 .. (case when r.solo_con_dato then 20 else r.dias - 1 end) loop
    if r.solo_con_dato then
      hay := exists (select 1 from jsonb_array_elements(r.condiciones) x where _valor_metrica(p_perfil, p_fecha - d, x ->> 'metrica') is not null);
      if not hay then
        if d = 0 then return false; end if;   -- hoy todavía no respondió
        continue;
      end if;
    end if;
    alguna := false; todas := true;
    for c in select * from jsonb_array_elements(r.condiciones) loop
      if _cumple(p_perfil, p_fecha - d, c) then alguna := true; else todas := false; end if;
    end loop;
    if (r.modo = 'todas' and not todas) or (r.modo = 'alguna' and not alguna) then return false; end if;
    vistos := vistos + 1;
    if vistos >= r.dias then return true; end if;
  end loop;
  return false;
end $$;

drop function if exists public.guardar_alerta(uuid, text, boolean, text, integer, jsonb);
create or replace function public.guardar_alerta(p_id uuid, p_nombre text, p_activa boolean, p_modo text, p_dias integer, p_condiciones jsonb,
  p_solo_con_dato boolean default false)
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
    insert into alertas_reglas (club_id, nombre, activa, modo, dias, condiciones, creado_por, solo_con_dato)
    values (v_club, trim(p_nombre), coalesce(p_activa, true), p_modo, p_dias, p_condiciones, yo(), coalesce(p_solo_con_dato, false))
    returning id into v_id;
    perform _registrar(v_club, 'creó la alerta «' || trim(p_nombre) || '».');
  else
    update alertas_reglas set nombre = trim(p_nombre), activa = coalesce(p_activa, true), modo = p_modo, dias = p_dias,
      condiciones = p_condiciones, solo_con_dato = coalesce(p_solo_con_dato, false), actualizado_en = now()
    where id = p_id and club_id = v_club returning id into v_id;
    if v_id is null then raise exception 'Esa alerta no existe.'; end if;
    perform _registrar(v_club, 'cambió la alerta «' || trim(p_nombre) || '».');
  end if;
  return v_id;
end $$;

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
      v_txt := j.nombre || ': ' || r.nombre || case when r.dias > 1 then ' (' || r.dias || case when r.solo_con_dato then ' veces seguidas)' else ' días seguidos)' end else '' end;
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

revoke all on function public._cumple_regla(uuid, date, public.alertas_reglas) from public, anon, authenticated;
revoke all on function public.guardar_alerta(uuid, text, boolean, text, integer, jsonb, boolean) from public, anon;
grant execute on function public.guardar_alerta(uuid, text, boolean, text, integer, jsonb, boolean) to authenticated;
revoke all on function public.tomar_alertas() from public, anon, authenticated;
grant execute on function public.tomar_alertas() to service_role;

revoke all on function public.guardar_parte(uuid, uuid, text, date, text, text, text, text, date) from public, anon;
revoke all on function public.dar_alta_parte(uuid, date) from public, anon;
revoke all on function public.eliminar_parte(uuid) from public, anon;
revoke all on function public.tomar_partes() from public, anon, authenticated;
grant execute on function public.guardar_parte(uuid, uuid, text, date, text, text, text, text, date) to authenticated;
grant execute on function public.dar_alta_parte(uuid, date) to authenticated;
grant execute on function public.eliminar_parte(uuid) to authenticated;
grant execute on function public.tomar_partes() to service_role;

-- Comprobación: tiene que mostrar true | 0.
select
  (select count(*) = 2 from information_schema.columns where table_schema = 'public' and ((table_name = 'partes_fisio' and column_name = 'nombre_libre') or (table_name = 'alertas_reglas' and column_name = 'solo_con_dato'))) as listo,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('guardar_parte', 'dar_alta_parte', 'eliminar_parte', 'tomar_partes', 'guardar_alerta', 'tomar_alertas', '_cumple_regla')
     and has_function_privilege('anon', oid, 'execute')) as abiertas_sin_sesion;
