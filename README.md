# Sports Performance

App de gestión para equipos deportivos profesionales (versión de prueba con el Casademont Zaragoza).
App web instalable en el móvil + panel en el ordenador. Base de datos en Supabase (Frankfurt).

## Módulos

| # | Módulo | Estado |
|---|--------|--------|
| 1 | Usuarios, roles, grupos y alta con código | Hecho |
| 2 | Calendario | Pendiente |
| 3 | Wellness y RPE | Pendiente |
| 4 | Workout Builder y entreno del jugador | Pendiente |
| 5 | Sports Science Hub (Wimu, VALD) | Pendiente |

## Puesta en marcha

1. **Base de datos**: en Supabase → *SQL Editor*, pegar `supabase/001_usuarios.sql` entero y tocar *Run* (una sola vez).
2. **Auth**: en Supabase → *Authentication* → *Sign In / Providers* → *Email*, desactivar **Confirm email** (en la prueba no hay servidor de correo).
3. **Web**: importar este repositorio en Vercel (sin configuración extra) y desplegar.
4. **Primer administrador**: abrir la web → «Tengo un código» → `CZ-ADMIN-7Q4M` (un solo uso, caduca a los 14 días).

## Desarrollo

```bash
npm install
npm run dev
```

Las claves de `src/lib/supabase.ts` son públicas por diseño; la seguridad la ponen las reglas (RLS) y las funciones de la base de datos.
