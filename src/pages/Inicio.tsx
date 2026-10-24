import { Link } from 'react-router-dom';
import { useSesion } from '../lib/sesion';

function esIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function instalada() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export default function Inicio() {
  const { perfil } = useSesion();
  if (!perfil) return null;
  const nombre = perfil.nombre.split(' ')[0];
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div>
        <p className="muted small" style={{ margin: '0 0 4px' }}>{perfil.club.nombre} · {perfil.rol.nombre}{perfil.es_admin ? ' · Administrador' : ''}</p>
        <h1 className="display" style={{ fontSize: 40 }}>Hola, {nombre}</h1>
      </div>

      {!instalada() && (
        <div className="card" style={{ padding: 16 }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Instala la app en tu teléfono</h2>
          {esIOS() ? (
            <p className="small" style={{ margin: 0, lineHeight: 1.5 }}>En Safari, toca el botón <strong>Compartir</strong> (el cuadrado con la flecha) y luego <strong>«Añadir a pantalla de inicio»</strong>.</p>
          ) : (
            <p className="small" style={{ margin: 0, lineHeight: 1.5 }}>En Chrome, toca el menú <strong>⋮</strong> y luego <strong>«Instalar app»</strong> o <strong>«Añadir a pantalla de inicio»</strong>.</p>
          )}
        </div>
      )}

      <div className="card" style={{ padding: 16 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Versión de prueba</h2>
        <p className="small muted" style={{ margin: 0, lineHeight: 1.5 }}>
          Ya funciona el alta y la gestión de usuarios. El calendario, el wellness y el entreno van llegando por módulos.
        </p>
      </div>

      {perfil.es_admin && (
        <Link to="/usuarios" className="btn btn-dark" style={{ alignSelf: 'flex-start' }}>Ir a Usuarios</Link>
      )}
    </div>
  );
}
