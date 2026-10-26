-- =====================================================================
-- Dueño de la plataforma atado a TU usuario, no a un email ni a un nombre.
-- Pegar entero en Supabase → SQL Editor → Run (después del 015). Se puede
-- correr más de una vez.
--
-- Por qué: el 015 decide quién es dueño comparando el email, y además agrega
-- como dueño a cualquier admin cuyo nombre empiece con «Mariano». Como la
-- pantalla de Alta deja crear cuentas con cualquier email, alguien podría
-- registrarse con un email de la lista (si todavía no existe esa cuenta) o
-- llamarse «Mariano…» y quedar como dueño: vería los admins de todos los
-- clubes y podría generar códigos de administrador de cualquier club.
-- =====================================================================

alter table public.duenos_plataforma
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Quitar los que entraron solo por llamarse «Mariano…» fuera del Casademont Zaragoza.
delete from public.duenos_plataforma d
where lower(d.email) <> 'marianobein1993@gmail.com'
  and not exists (
    select 1 from auth.users u
    join public.perfiles p on p.id = u.id
    join public.clubs c on c.id = p.club_id
    where lower(u.email) = lower(d.email) and p.es_admin and c.nombre = 'Casademont Zaragoza'
  );

-- Fijar el usuario de cada dueño que queda (solo una vez; después no cambia).
update public.duenos_plataforma d
set user_id = u.id
from auth.users u
where d.user_id is null and lower(u.email) = lower(d.email);

-- Ahora se compara por usuario: crear otra cuenta con el mismo email no sirve.
create or replace function public.soy_dueno() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from duenos_plataforma d where d.user_id = auth.uid())
$$;
revoke all on function public.soy_dueno() from public, anon;
grant execute on function public.soy_dueno() to authenticated;

-- Revisá esta lista: tiene que aparecer solo tu nombre.
select d.email, p.nombre, c.nombre as club, d.user_id is not null as activo
from public.duenos_plataforma d
left join public.perfiles p on p.id = d.user_id
left join public.clubs c on c.id = p.club_id;
