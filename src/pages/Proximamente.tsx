export default function Proximamente({ titulo }: { titulo: string }) {
  return (
    <div className="stack">
      <h1 className="display" style={{ fontSize: 38 }}>{titulo}</h1>
      <div className="card" style={{ padding: 20 }}>
        <p style={{ margin: 0 }}>Este módulo llega en las próximas versiones.</p>
      </div>
    </div>
  );
}
