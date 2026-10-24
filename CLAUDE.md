# Contexto para Claude

- Usuario: Mariano Bein, preparador físico del Casademont Zaragoza (ACB). No programa: Claude escribe el código y él prueba. Hablarle en español, simple.
- Producto: app multi-club y multideporte. Prueba gratuita: app web instalable (PWA) + Supabase free (Frankfurt) + Vercel free.
- Stack: Vite + React + TypeScript + React Router + supabase-js. CSS propio en `src/styles.css` (tokens del boceto: fondo #F6F5F2, tinta #16181D, acento #B3122E, Barlow Condensed + Inter).
- Base de datos: SQL numerado en `supabase/NNN_*.sql`; el usuario lo pega en el SQL Editor. Nunca pedirle la service_role ni la contraseña de la BD.
- Seguridad: todas las tablas con RLS por club (`mi_club()`, `soy_admin()`); las escrituras sensibles van por funciones `security definer` que registran en `registro_cambios`.
- Permisos por módulo: `calendario`, `sports_science`, `workout_builder`, `estadisticas`, `usuarios`; niveles `sin`, `ver`, `propio`, `editar` + `exporta`. Admin = todo.
- Nombres de módulos en la UI: Calendario, Workout Builder, Sports Science Hub, Usuarios.
- Datos de salud: un dato que falta nunca cuenta como cero.
