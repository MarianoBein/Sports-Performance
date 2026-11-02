# Pruebas de seguridad (no se pegan en Supabase)

1. `./reconstruir.sh prueba` arma una base igual a la de Supabase con todos los SQL.
2. `python3 datos_prueba.py prueba datos.json` crea dos clubes (Casademont y Fénix) con admins, jugadores, staff y datos, por los mismos caminos que la app.
3. `python3 ataque.py prueba datos.json` intenta leer y cambiar lo ajeno desde 7 cuentas distintas (sin sesión, sin club, jugador, utilero, PF, admin de otro club) y comprueba que lo legítimo siga andando. Tiene que terminar en «0 problemas».
