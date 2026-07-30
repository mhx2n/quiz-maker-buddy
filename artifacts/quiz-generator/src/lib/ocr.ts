import { createWorker } from "tesseract.js";

export interface OCRResult {
  text: string;
  confidence: number;
}

export async function extractTextFromImage(
  imageData: string,
  onProgress?: (progress: number) => void
): Promise<OCRResult> {
  const worker = await createWorker(["ben", "eng"], 1, {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  try {
    const { data } = await worker.recognize(imageData);
    await worker.terminate();
    return {
      text: data.text.trim(),
      confidence: Math.round(data.confidence),
    };
  } catch (err) {
    await worker.terminate();
    throw err;
  }
}
