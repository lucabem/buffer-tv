/**
 * Color dominante de un logo para teñir el dock. Ignora píxeles transparentes,
 * oscuros y grises: un logo blanco o negro no debe teñir la interfaz.
 */
const SIZE = 16;
const cache = new Map<string, Promise<string | null>>();

export function dominantColor(dataUrl: string): Promise<string | null> {
  let pending = cache.get(dataUrl);
  if (!pending) {
    pending = sample(dataUrl);
    cache.set(dataUrl, pending);
  }
  return pending;
}

function sample(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue;
        const max = Math.max(data[i], data[i + 1], data[i + 2]);
        const min = Math.min(data[i], data[i + 1], data[i + 2]);
        const saturation = max === 0 ? 0 : (max - min) / max;
        if (saturation < 0.25 || max < 60) continue;
        r += data[i] * saturation;
        g += data[i + 1] * saturation;
        b += data[i + 2] * saturation;
        weight += saturation;
      }

      resolve(weight === 0 ? null : `rgb(${Math.round(r / weight)} ${Math.round(g / weight)} ${Math.round(b / weight)})`);
    };
    img.src = dataUrl;
  });
}
