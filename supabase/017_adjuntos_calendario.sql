-- =====================================================================
-- Calendario: adjuntar imágenes o PDF a una actividad (hasta 5 MB cada uno).
-- Pegar entero en Supabase → SQL Editor → Run (después del 016). Una sola vez.
--
-- Los archivos van a una carpeta privada «adjuntos/<club>/<actividad>/...».
-- Solo los ve quien ve la actividad, y solo los sube o borra quien puede editarla.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('adjuntos', 'adjuntos', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

create or replace function public._uuid_o_nulo(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- ¿Puede esta persona editar la actividad? (ver y editar, o «solo lo suyo» si la creó)
create or replace function public.puede_editar_actividad(p_perfil uuid, p_act uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from actividades a join perfiles p on p.id = p_perfil and p.club_id = a.club_id and p.eliminado_en is null
    where a.id = p_act and a.eliminado_en is null
      and (nivel_de(p_perfil, 'calendario') = 'editar' or (nivel_de(p_perfil, 'calendario') = 'propio' and a.creado_por = p_perfil))
  )
$$;

create table public.actividad_adjuntos (
  id uuid primary key default gen_random_uuid(),
  actividad_id uuid not null references public.actividades(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  ruta text not null unique,
  nombre text not null check (length(nombre) between 1 and 200),
  tipo text not null,
  bytes int not null check (bytes between 1 and 5242880),
  subido_por uuid references public.perfiles(id),
  creado_en timestamptz not null default now()
);
create index actividad_adjuntos_act on public.actividad_adjuntos (actividad_id);
alter table public.actividad_adjuntos enable row level security;
create policy adjuntos_ver on public.actividad_adjuntos for select
  using (club_id = public.mi_club() and public.ve_actividad(auth.uid(), actividad_id));

create policy adjuntos_archivo_ver on storage.objects for select to authenticated
  using (bucket_id = 'adjuntos' and (storage.foldername(name))[1] = public.mi_club()::text
         and public.ve_actividad(auth.uid(), public._uuid_o_nulo((storage.foldername(name))[2])));
create policy adjuntos_archivo_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'adjuntos' and (storage.foldername(name))[1] = public.mi_club()::text
              and public.puede_editar_actividad(auth.uid(), public._uuid_o_nulo((storage.foldername(name))[2])));
create policy adjuntos_archivo_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'adjuntos' and (storage.foldername(name))[1] = public.mi_club()::text
         and public.puede_editar_actividad(auth.uid(), public._uuid_o_nulo((storage.foldername(name))[2])));

-- Anota el archivo ya subido.
create or replace function public.registrar_adjunto(p_actividad uuid, p_ruta text, p_nombre text, p_tipo text, p_bytes int) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_id uuid; v_act text;
begin
  if not puede_editar_actividad(auth.uid(), p_actividad) then raise exception 'No podés adjuntar archivos a esta actividad.'; end if;
  if p_ruta not like v_club || '/' || p_actividad || '/%' then raise exception 'Archivo no válido.'; end if;
  if p_tipo not in ('image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf') then raise exception 'Solo imágenes o PDF.'; end if;
  if (select count(*) from actividad_adjuntos where actividad_id = p_actividad) >= 10 then raise exception 'Máximo 10 archivos por actividad.'; end if;
  insert into actividad_adjuntos (actividad_id, club_id, ruta, nombre, tipo, bytes, subido_por)
  values (p_actividad, v_club, p_ruta, left(btrim(p_nombre), 200), p_tipo, p_bytes, auth.uid()) returning id into v_id;
  select nombre into v_act from actividades where id = p_actividad;
  perform _registrar(v_club, 'adjuntó «' || left(btrim(p_nombre), 80) || '» a la actividad «' || v_act || '».');
  return v_id;
end $$;

create or replace function public.borrar_adjunto(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare x actividad_adjuntos;
begin
  select * into x from actividad_adjuntos where id = p_id and club_id = mi_club();
  if x.id is null then raise exception 'Ese archivo ya no existe.'; end if;
  if not puede_editar_actividad(auth.uid(), x.actividad_id) then raise exception 'No podés borrar este archivo.'; end if;
  delete from actividad_adjuntos where id = p_id;
  return x.ruta; -- la app borra el archivo de la carpeta
end $$;

revoke all on function public._uuid_o_nulo(text) from public, anon;
revoke all on function public.puede_editar_actividad(uuid, uuid) from public, anon;
revoke all on function public.registrar_adjunto(uuid, text, text, text, int) from public, anon;
revoke all on function public.borrar_adjunto(uuid) from public, anon;
grant execute on function public._uuid_o_nulo(text) to authenticated;
grant execute on function public.puede_editar_actividad(uuid, uuid) to authenticated;
grant execute on function public.registrar_adjunto(uuid, text, text, text, int) to authenticated;
grant execute on function public.borrar_adjunto(uuid) to authenticated;
