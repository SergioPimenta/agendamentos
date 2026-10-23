/**
 * Prepara uma foto de perfil: recorta um quadrado no centro, reduz para `size` px e salva em JPEG.
 * Uma foto de celular de vários MB vira ~50 KB, o que acelera o envio e poupa espaço no servidor.
 */
export async function squarePhoto(file: File, size = 512): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bitmap) throw new Error('Não foi possível ler essa imagem. Tente outra foto (JPG, PNG ou WebP).');
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  const target = Math.min(size, side);
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Seu navegador não conseguiu preparar a foto.');
  ctx.fillStyle = '#ffffff'; // PNG com fundo transparente vira branco no JPEG
  ctx.fillRect(0, 0, target, target);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, target, target);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) throw new Error('Não foi possível preparar a foto.');
  return new File([blob], 'perfil.jpg', { type: 'image/jpeg' });
}
