import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

env.allowRemoteModels = false; 
env.localModelPath = path.join(__dirname, '../../models'); 

export class ModelSingleton {
  private static extractor: any = null;
  private static classifier: any = null;

  static init() {
    // Always resolve model path relative to the client app, not the library
    const projectRoot = process.cwd();
    const modelPath = path.join(projectRoot, "models");

    // Ensure directory exists
    if (!fs.existsSync(modelPath)) {
      fs.mkdirSync(modelPath, { recursive: true });
    }

    env.cacheDir = modelPath;
    env.localModelPath = modelPath;

    // Allow remote download if missing
    env.allowRemoteModels = true;

    console.log("[Guard] Using model directory:", modelPath);
  }


  static async getExtractor() {
    if (!this.extractor) {
      this.init();
      this.extractor = await (pipeline as any)('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    return this.extractor;
  }

  static async getNER() {
    if (!this.classifier) {
      this.init();
      // Token classification model for identifying sensitive entities
      this.classifier = await (pipeline as any)('token-classification', 'Xenova/bert-base-NER');
    }
    return this.classifier;
  }
}