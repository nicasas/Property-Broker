/**
 * Imágenes DECORATIVAS para las tarjetas de inmueble.
 *
 * No representan el inmueble real: el sistema no guarda fotos. Un `listing` es
 * dirección más tres porcentajes de reparto, y agregarle fotos de verdad seria
 * ampliar el alcance del backend hacia un MLS, que es justo lo que este reto dejó
 * fuera a propósito.
 *
 * Existen porque una grilla de tarjetas sin imagen se lee como un panel de
 * administración, y esto es un producto para brokers. Se eligen de forma
 * DETERMINISTA a partir del id del inmueble: el mismo inmueble muestra siempre la
 * misma imagen, entre renders y entre sesiones. Si fueran aleatorias, la foto
 * cambiaría en cada refresh y la interfaz se sentiría inestable justo donde
 * necesita transmitir solidez.
 *
 * Las URLs se sirven desde Unsplash con `<img>` nativo en vez de `next/image`
 * para no tener que declarar hosts remotos en la configuración: son decoración,
 * no contenido, y no justifican optimización ni un dominio de confianza nuevo.
 */

const PHOTO_IDS = [
  "1512917774080-9991f1c4c750",
  "1600596542815-ffad4c1539a9",
  "1600585154340-be6161a56a0c",
  "1580587771525-78b9dba3b914",
  "1600607687939-ce8a6c25118c",
  "1502672260266-1c1ef2d93688",
  "1493809842364-78817add7ffb",
  "1560448204-e02f11c3d0e2",
  "1568605114967-8130f3a36994",
  "1570129477492-45c003edd2be",
  "1613977257363-707ba9348227",
  "1600047509807-ba8f99d2cdde",
];

/** Hash estable de un string a entero. Determinista entre servidor y cliente. */
function hash(value: string): number {
  let acc = 0;
  for (let i = 0; i < value.length; i += 1) {
    acc = (acc * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(acc);
}

export function listingImage(listingId: string, width = 800): string {
  const id = PHOTO_IDS[hash(listingId) % PHOTO_IDS.length];
  return `https://images.unsplash.com/photo-${id}?w=${width}&q=70&auto=format&fit=crop`;
}
