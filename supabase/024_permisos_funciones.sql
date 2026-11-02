-- =====================================================================
-- 024 · Ajuste de seguridad (avisos del Security Advisor de Supabase)
-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
-- 1. Quien NO inició sesión ya no puede llamar a las funciones de la app.
--    (Igual no podían hacer nada, porque cada función pide saber quién sos,
--    pero así queda cerrado de entrada.) Solo quedan abiertas las dos que
--    hacen falta sin sesión:
--      - ver_codigo: la pantalla de alta muestra a qué club te sumás con el código.
--      - ics_eventos: el calendario que se suscribe desde Google/Apple, con su token.
-- 2. Quien sí inició sesión conserva exactamente los mismos permisos que tenía.
-- 3. _uuid_o_nulo con search_path fijo.
-- =====================================================================

do $$
declare f record; tenia boolean;
begin
  for f in
    select p.oid, p.oid::regprocedure as firma, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
      and p.proname not in ('ver_codigo', 'ics_eventos')
  loop
    tenia := has_function_privilege('authenticated', f.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', f.firma);
    if tenia then execute format('grant execute on function %s to authenticated', f.firma); end if;
  end loop;
end $$;

alter function public._uuid_o_nulo(text) set search_path = public;

-- Comprobación: tiene que decir 2 (ver_codigo e ics_eventos).
select count(*) as funciones_abiertas_sin_sesion
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
