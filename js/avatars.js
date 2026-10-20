// Avatar library — the 36 illustrated faces from the Sintonia app (avatars/*.webp, imported by tools/import_avatars.py).
// Each image is a 192 px WebP with a transparent background, so the circle behind it takes the member's colour.
// No DOM and no i18n imports: the GitHub Action (backend/) validates avatar ids with this same list.

const A = (id, en, pt, es) => ({ id, g: id[0], label: { en, pt, es } });

export const AVATARS = [
  A('f1', 'Auburn curls', 'Cachos ruivos', 'Rizos pelirrojos'),
  A('f2', 'Blonde with headband and glasses', 'Loira de faixa e óculos', 'Rubia con diadema y gafas'),
  A('f3', 'Wavy red hair', 'Ruiva ondulada', 'Pelirroja ondulada'),
  A('f4', 'Dark wavy hair', 'Cabelo escuro ondulado', 'Cabello oscuro ondulado'),
  A('f5', 'Platinum blonde with glasses', 'Platinada de óculos', 'Platinada con gafas'),
  A('f6', 'Polka-dot headband', 'Faixa de bolinhas', 'Diadema de lunares'),
  A('f7', 'Patterned headscarf', 'Lenço estampado', 'Pañuelo estampado'),
  A('f8', 'Redhead with a scarf', 'Ruiva de cachecol', 'Pelirroja con bufanda'),
  A('f9', 'Long brown hair', 'Castanha de cabelo longo', 'Castaña de cabello largo'),
  A('f10', 'Long blonde hair', 'Loira de cabelo longo', 'Rubia de cabello largo'),
  A('f11', 'Brunette in a coral blazer', 'Morena de blazer coral', 'Morena con blazer coral'),
  A('f12', 'Blonde with a scarf', 'Loira de cachecol', 'Rubia con bufanda'),
  A('f13', 'Dark waves', 'Cabelo ondulado escuro', 'Ondas oscuras'),
  A('f14', 'Blue hair', 'Cabelo azul', 'Cabello azul'),
  A('f15', 'Bob cut with glasses', 'Chanel de óculos', 'Melena corta con gafas'),
  A('m1', 'Beard and orange jacket', 'Barba e jaqueta laranja', 'Barba y chaqueta naranja'),
  A('m2', 'Short hair', 'Cabelo curto', 'Cabello corto'),
  A('m3', 'Blond with glasses', 'Loiro de óculos', 'Rubio con gafas'),
  A('m4', 'Beard and yellow sweater', 'Barba e blusa amarela', 'Barba y suéter amarillo'),
  A('m5', 'Beanie and glasses', 'Gorro e óculos', 'Gorro y gafas'),
  A('m6', 'Yellow jacket', 'Jaqueta amarela', 'Chaqueta amarilla'),
  A('m7', 'Striped sweatshirt', 'Moletom listrado', 'Sudadera a rayas'),
  A('m8', 'Glasses and lab coat', 'Óculos e jaleco', 'Gafas y bata'),
  A('m9', 'Blue jacket', 'Jaqueta azul', 'Chaqueta azul'),
  A('m10', 'Dark hair and jacket', 'Cabelo escuro e jaqueta', 'Cabello oscuro y chaqueta'),
  A('m11', 'Shirt and blazer', 'Camisa e blazer', 'Camisa y blazer'),
  A('m12', 'Beige jacket', 'Jaqueta bege', 'Chaqueta beige'),
  A('m13', 'Beard and blue T-shirt', 'Barba e camiseta azul', 'Barba y camiseta azul'),
  A('m14', 'Glasses and green jacket', 'Óculos e jaqueta verde', 'Gafas y chaqueta verde'),
  A('m15', 'Blond with glasses and jacket', 'Loiro de óculos e jaqueta', 'Rubio con gafas y chaqueta'),
  A('m16', 'Navy jacket', 'Jaqueta azul-marinho', 'Chaqueta azul marino'),
  A('m17', 'Blond with a tie', 'Loiro de gravata', 'Rubio con corbata'),
  A('m18', 'Glasses and suit', 'Óculos e terno', 'Gafas y traje'),
  A('m19', 'Glasses and denim jacket', 'Óculos e jaqueta jeans', 'Gafas y chaqueta de mezclilla'),
  A('m20', 'Beard and grey blazer', 'Barba e blazer cinza', 'Barba y blazer gris'),
  A('m21', 'Brown hair', 'Cabelo castanho', 'Cabello castaño'),
];

const BY_ID = new Map(AVATARS.map(a => [a.id, a]));

export const isAvatar = id => BY_ID.has(id);
/** Image URL (relative to the app) or '' when the id is unknown. */
export const avatarSrc = id => (BY_ID.has(id) ? `avatars/${id}.webp` : '');
/** Accessible description of an avatar in 'en' | 'pt' | 'es'. */
export const avatarLabel = (id, lang = 'en') => { const a = BY_ID.get(id); return a ? a.label[lang] || a.label.en : ''; };
/** <img> for an avatar; decorative by default (the member's name sits next to it). */
export const avatarImg = (id, alt = '') => {
  const src = avatarSrc(id);
  return src ? `<img src="${src}" alt="${alt.replace(/"/g, '&quot;')}" width="192" height="192" decoding="async" draggable="false">` : '';
};
