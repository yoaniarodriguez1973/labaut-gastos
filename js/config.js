// Configuración de la app. La "publishable key" es pública por diseño:
// la seguridad la dan las reglas (RLS) de la base de datos.
export const SUPABASE_URL = 'https://sleppbwqufrncipxrlyc.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_igFBnvF8hrC1rJYP5HoUug_sedOOYp8';

// Cantidad de personas entre las que se reparte (partes iguales)
export const FAMILY_SIZE = 4;

export const CATEGORIES = [
  { id: 'Renta',    icon: '🏠', color: '#3D405B' },
  { id: 'Agua',     icon: '💧', color: '#4EA8DE' },
  { id: 'Luz',      icon: '💡', color: '#E9B949' },
  { id: 'Gas',      icon: '🔥', color: '#E76F51' },
  { id: 'Comida',   icon: '🛒', color: '#81B29A' },
  { id: 'Cárnicos', icon: '🥩', color: '#B5394B' },
  { id: 'Agro',     icon: '🥬', color: '#6A994E' },
  { id: 'Otros',    icon: '📦', color: '#9A8C98' },
];

export const PALETTE = ['#E07A5F', '#174E5A', '#81B29A', '#E9B949', '#4EA8DE', '#9B5DE5', '#F15BB5', '#2A9D8F'];
