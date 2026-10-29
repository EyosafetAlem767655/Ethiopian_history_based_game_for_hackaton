import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
self.onmessage = async (e: MessageEvent<{ image: ImageBitmap; base: string }>) => {
  let task: FaceLandmarker | undefined;
  try {
    task = await FaceLandmarker.createFromOptions(
      await FilesetResolver.forVisionTasks(e.data.base + '/vision/wasm'),
      {
        baseOptions: {
          modelAssetPath: e.data.base + '/vision/face_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        numFaces: 1,
      },
    );
    const face = task.detect(e.data.image).faceLandmarks[0];
    if (!face) throw Error('No face found. Try brighter light or use the manual editor.');
    const ratio = Math.abs(face[454].x - face[234].x) / Math.abs(face[152].y - face[10].y);
    self.postMessage({ shape: ratio > 0.83 ? 'round' : ratio < 0.7 ? 'oval' : 'square' });
  } catch {
    self.postMessage({
      error: 'Face suggestions are unavailable. You can edit every feature manually.',
    });
  } finally {
    e.data.image.close();
    task?.close();
  }
};
