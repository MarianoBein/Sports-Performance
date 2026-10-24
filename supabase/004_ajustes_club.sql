-- =====================================================================
-- Ajustes del club: escudos (club y liga), lugar habitual y temporada.
-- Pegar entero en Supabase → SQL Editor → Run (después del 003). Una sola vez.
-- =====================================================================

alter table public.clubs
  add column logo_club_url text,
  add column logo_liga_url text;

-- Carpeta pública para los escudos: cada club solo puede escribir en la suya.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy logos_ver on storage.objects for select to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = public.mi_club()::text);
create policy logos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = public.mi_club()::text and public.soy_admin());
create policy logos_cambiar on storage.objects for update to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = public.mi_club()::text and public.soy_admin());
create policy logos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = public.mi_club()::text and public.soy_admin());

create or replace function public.actualizar_club(
  p_sede text, p_temporada text, p_logo_club text, p_logo_liga text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); c clubs; v_cambios text[] := '{}';
begin
  if not soy_admin() then raise exception 'Solo un administrador puede cambiar los ajustes del club.'; end if;
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

grant execute on function public.actualizar_club(text, text, text, text) to authenticated;
