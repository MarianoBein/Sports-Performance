-- =====================================================================
-- Restablecer contraseña desde Usuarios (sin emails).
-- Pegar entero en Supabase → SQL Editor → Run (después del 011). Una sola vez.
--
-- El admin genera una clave temporal (la app la crea en el servidor con la
-- clave secreta guardada en Vercel) y se la manda por WhatsApp. Al entrar
-- con esa clave, la persona tiene que elegir una nueva.
-- =====================================================================

alter table public.perfiles add column debe_cambiar_clave boolean not null default false;

-- Lo llama el servidor con la sesión del admin: valida el permiso, marca y deja registro.
create or replace function public.preparar_clave_temporal(p_perfil uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_club uuid := mi_club(); v_nombre text;
begin
  if not soy_admin() then raise exception 'Solo un administrador puede restablecer contraseñas.'; end if;
  select nombre into v_nombre from perfiles where id = p_perfil and club_id = v_club and eliminado_en is null;
  if v_nombre is null then raise exception 'Esa persona no está en el club.'; end if;
  update perfiles set debe_cambiar_clave = true where id = p_perfil;
  perform _registrar(v_club, 'restableció la contraseña de ' || v_nombre || '.');
  return v_nombre;
end $$;

-- Lo llama la persona después de elegir su clave nueva.
create or replace function public.clave_cambiada() returns void
language sql security definer set search_path = public as $$
  update perfiles set debe_cambiar_clave = false where id = auth.uid();
$$;

revoke all on function public.preparar_clave_temporal(uuid) from public, anon;
revoke all on function public.clave_cambiada() from public, anon;
grant execute on function public.preparar_clave_temporal(uuid) to authenticated;
grant execute on function public.clave_cambiada() to authenticated;
