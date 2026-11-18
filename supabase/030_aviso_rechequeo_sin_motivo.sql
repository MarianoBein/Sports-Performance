-- =====================================================================
-- 030 · El aviso del rechequeo ya no muestra el motivo del parte
-- Pegar entero en Supabase → SQL Editor → Run (después del 029). Se puede correr más de una vez.
--
-- El motivo de un parte de fisio es un dato de salud y el aviso se lee con el celular
-- bloqueado. Ahora el aviso solo dice «Tiene rechequeo hoy: mirá el parte en la app».
-- (Propuesto por la revisión semanal.) No cambia ningún permiso.
-- =====================================================================

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
      select s.endpoint, s.p256dh, s.auth, ('Rechequeo hoy: ' || p.jugador)::text, 'Tiene rechequeo hoy: mirá el parte en la app.'::text, '/sports-science?pestana=fisio'::text,
             ('rechequeo-' || p.id::text)::text, p.fecha_rechequeo
      from push_suscripciones s
      join perfiles st on st.id = s.perfil_id
      join roles rs on rs.id = st.rol_id
      where st.club_id = p.club_id and st.eliminado_en is null
        and (st.id = p.creado_por or rs.clave = 'fisio')
        and nivel_de(st.id, 'sports_science') <> 'sin';
  end loop;
end $$;
revoke all on function public.tomar_partes() from public, anon, authenticated;
grant execute on function public.tomar_partes() to service_role;

-- Comprobación: tiene que mostrar true | 0.
select
  (select prosrc not like '%p.motivo%' from pg_proc where proname = 'tomar_partes' and pronamespace = 'public'::regnamespace) as sin_motivo,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tomar_partes'
     and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute'))) as abiertas;
