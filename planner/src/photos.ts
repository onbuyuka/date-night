export async function preparePhoto(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP photo.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Choose a photo smaller than 12 MB.");
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 40000000) throw new Error("This photo is too large. Choose a smaller version.");
    for (const size of [1600, 1200, 800]) {
      const ratio = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser couldn’t prepare the photo.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", .78));
      if (compressed && compressed.size <= 384 * 1024) return compressed;
    }
    throw new Error("This photo could not be made small enough. Try another photo.");
  } finally { URL.revokeObjectURL(source); }
}
