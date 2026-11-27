-- 031 · Parte de fisio: «¿Puede jugar el partido?»
-- Un jugador adaptado puede jugar el partido (con minutos limitados) o no.
-- La disponibilidad pasa a tener 4 grupos: Disponibles, Adaptados con partido, Adaptados sin partido y Fuera.
-- Requiere 028 y 029. Pegar entero en el SQL Editor de Supabase.

alter table public.partes_fisio add column if not exists juega_partido boolean;   -- null = no se marcó (cuenta como «sin partido»)

drop function if exists public.guardar_parte(uuid, uuid, text, date, text, text, text, text, date);
create or replace function public.guardar_parte(p_id uuid, p_perfil uuid, p_nombre_libre text, p_fecha date, p_motivo text, p_entrena text, p_pesas text,
  p_restricciones text default null, p_fecha_rechequeo date default null, p_juega_partido boolean default null) returns uuid
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
  if p_entrena = 'no' then p_juega_partido := false; end if;   -- si no entrena, tampoco juega
  if p_id is null then
    insert into partes_fisio (club_id, perfil_id, nombre_libre, fecha, motivo, entrena, pesas, restricciones, fecha_rechequeo, juega_partido, creado_por)
    values (v_club, p_perfil, p_nombre_libre, p_fecha, p_motivo, p_entrena, p_pesas, p_restricciones, p_fecha_rechequeo, p_juega_partido, yo())
    returning id into v_id;
    perform _registrar(v_club, 'cargó un parte de fisio de ' || v_nombre || '.');
  else
    select fecha_rechequeo into v_antes from partes_fisio where id = p_id and club_id = v_club;
    update partes_fisio set perfil_id = p_perfil, nombre_libre = p_nombre_libre, fecha = p_fecha, motivo = p_motivo, entrena = p_entrena, pesas = p_pesas,
      restricciones = p_restricciones, fecha_rechequeo = p_fecha_rechequeo, juega_partido = p_juega_partido, actualizado_en = now(),
      rechequeo_avisado_en = case when p_fecha_rechequeo is distinct from v_antes then null else rechequeo_avisado_en end
    where id = p_id and club_id = v_club returning id into v_id;
    if v_id is null then raise exception 'Ese parte no existe.'; end if;
    perform _registrar(v_club, 'cambió un parte de fisio de ' || v_nombre || '.');
  end if;
  return v_id;
end $$;

revoke all on function public.guardar_parte(uuid, uuid, text, date, text, text, text, text, date, boolean) from public, anon;
grant execute on function public.guardar_parte(uuid, uuid, text, date, text, text, text, text, date, boolean) to authenticated;

-- Comprobación: tiene que mostrar true | 0.
select
  (select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'partes_fisio' and column_name = 'juega_partido') as listo,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'guardar_parte'
     and has_function_privilege('anon', oid, 'execute')) as abiertas_sin_sesion;
