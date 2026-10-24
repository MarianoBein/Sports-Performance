// En pantalla el 5 siempre es lo mejor. La base de datos guarda sueño tal cual
// y fatiga, estrés y dolor muscular invertidos (5 = peor), como el Looker del PF.

export const COLORES_5 = ['#D6192F', '#EF6A2A', '#E5A800', '#6DB33F', '#1E9E4A'];
export const TEXTO_5 = ['#fff', '#fff', '#2B2100', '#102A05', '#fff'];

export type Pregunta = { clave: 'sueno' | 'fatiga' | 'estres' | 'dolor'; titulo: string; ayuda?: string; frases: string[] };

export const PREGUNTAS: Pregunta[] = [
  { clave: 'sueno', titulo: 'Calidad del sueño', frases: ['Muy mal, casi no dormí', 'Mal', 'Normal', 'Bien', 'Excelente, súper descansado'] },
  { clave: 'fatiga', titulo: 'Fatiga', frases: ['Agotado', 'Cansado', 'Normal', 'Fresco', 'Muy fresco'] },
  { clave: 'estres', titulo: 'Estrés', frases: ['Muy estresado', 'Estresado', 'Normal', 'Relajado', 'Muy relajado'] },
  { clave: 'dolor', titulo: 'Dolor muscular', ayuda: 'Agujetas, no lesiones', frases: ['Mucho dolor muscular', 'Bastante dolor', 'Algo de dolor', 'Poco dolor', 'Nada de dolor'] },
];

// Escala de Borg CR-10.
export const RPE: { valor: number; frase: string; color: string; texto: string }[] = [
  { valor: 10, frase: 'Esfuerzo máximo', color: '#9E0F1F', texto: '#fff' },
  { valor: 9, frase: 'Casi máximo', color: '#C8162B', texto: '#fff' },
  { valor: 8, frase: 'Muy duro', color: '#E03A2E', texto: '#fff' },
  { valor: 7, frase: 'Muy duro', color: '#EF6A2A', texto: '#fff' },
  { valor: 6, frase: 'Duro', color: '#F2902B', texto: '#2B1600' },
  { valor: 5, frase: 'Duro', color: '#F5B21C', texto: '#2B2100' },
  { valor: 4, frase: 'Algo duro', color: '#E8CF2A', texto: '#2B2600' },
  { valor: 3, frase: 'Moderado', color: '#B7D445', texto: '#1A2600' },
  { valor: 2, frase: 'Fácil', color: '#6DB33F', texto: '#102A05' },
  { valor: 1, frase: 'Muy, muy fácil', color: '#1E9E4A', texto: '#fff' },
];

export const colorRpe = (v: number) => RPE.find((r) => r.valor === v) ?? RPE[RPE.length - 1];

// Valor guardado → valor "5 = mejor" para pintar.
export const bienDe = (clave: Pregunta['clave'], guardado: number) => (clave === 'sueno' ? guardado : 6 - guardado);

export type EstadoHoy = {
  fecha: string; es_jugador: boolean;
  wellness_toca: boolean; wellness_hecho: boolean; preparacion: number | null;
  rpe_toca: boolean; rpe_desde: string; rpe_disponible: boolean; rpe_hecho: boolean; rpe: number | null;
};
