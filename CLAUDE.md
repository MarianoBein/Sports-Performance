# Contexto para Claude

- Usuario: Mariano Bein, preparador físico del Casademont Zaragoza (ACB). No programa: Claude escribe el código y él prueba. Hablarle en español, simple.
- Producto: app multi-club y multideporte. Prueba gratuita: app web instalable (PWA) + Supabase free (Frankfurt) + Vercel free.
- Stack: Vite + React + TypeScript + React Router + supabase-js. CSS propio en `src/styles.css` (tokens del boceto: fondo #F6F5F2, tinta #16181D, acento #B3122E, Barlow Condensed + Inter).
- Base de datos: SQL numerado en `supabase/NNN_*.sql`; el usuario lo pega en el SQL Editor. Nunca pedirle la service_role ni la contraseña de la BD.
- Una cuenta puede estar en varias organizaciones: un perfil por organización (`perfiles.user_id` = cuenta). En SQL usar `yo()` (perfil activo), nunca `auth.uid()` para el perfil. Cambio con `cambiar_organizacion`, alta extra con `canjear_codigo`.
- Seguridad: todas las tablas con RLS por club (`mi_club()`, `soy_admin()`); las escrituras sensibles van por funciones `security definer` que registran en `registro_cambios`.
- Reglas de seguridad (auditoría 2/11/2026, `024_seguridad.sql`):
  - Tablas nuevas: `enable row level security`, solo políticas de lectura; las escrituras por funciones.
  - Funciones nuevas: siempre `revoke all on function … from public, anon;` y `grant execute … to authenticated` solo si la app la llama. Sin sesión solo `ver_codigo` e `ics_eventos`.
  - `perfiles`: nunca `select('*')` ni la columna `email` desde la app (está cerrada); los emails salen de `emails_del_club()`. Columna nueva en `perfiles` → `grant select (columna) on public.perfiles to authenticated`.
  - Códigos de alta: siempre con `_codigo_nuevo()` (azar criptográfico, 10 signos). Notas del dueño: tabla `notas_plataforma`, nunca en `clubs`.
  - Funciones auxiliares que reciben un perfil o una actividad: que no respondan por otro club (ver `nivel_de`, `ve_actividad`).
  - Cabeceras de seguridad en `vercel.json` (CSP): un dominio externo nuevo hay que agregarlo ahí.
- Para probar SQL: la base espejo de Supabase y el ataque con varias cuentas están en `supabase/pruebas/` (ver LEEME): correrlos antes de entregar SQL nuevo.
- Permisos por módulo: `calendario`, `sports_science`, `workout_builder`, `estadisticas`, `usuarios`; niveles `sin`, `ver`, `propio`, `editar` + `exporta`. Admin = todo.
- Nombres de módulos en la UI: Calendario, Workout Builder, Sports Science Hub, Usuarios.
- Datos de salud: un dato que falta nunca cuenta como cero.
