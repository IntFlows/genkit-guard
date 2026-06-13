import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createLogger } from '../logging/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

env.allowRemoteModels = false; 
env.localModelPath = path.join(__dirname, '../../models'); 

export class ModelSingleton {
  private static extractors: Map<string, any> = new Map();
  private static nerClassifiers: Map<string, any> = new Map();
  private static textClassifiers: Map<string, any> = new Map();

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

    createLogger()({
      level: 'info',
      event: 'guard.models.directory_configured',
      modelPath
    });
  }

  static async getExtractor(modelName: string = 'Xenova/all-MiniLM-L6-v2') {
    if (!this.extractors.has(modelName)) {
      this.init();
      const inst = await (pipeline as any)('feature-extraction', modelName);
      this.extractors.set(modelName, inst);
    }
    return this.extractors.get(modelName);
  }

  static async getNER(modelName: string = 'Xenova/bert-base-NER') {
    if (!this.nerClassifiers.has(modelName)) {
      this.init();
      const inst = await (pipeline as any)('token-classification', modelName);
      this.nerClassifiers.set(modelName, inst);
    }
    return this.nerClassifiers.get(modelName);
  }

  static async getPIIClassifier(modelName: string = 'openai/privacy-filter') {
    if (!this.textClassifiers.has(modelName)) {
      this.init();
      const inst = await (pipeline as any)('text-classification', modelName);
      this.textClassifiers.set(modelName, inst);
    }
    return this.textClassifiers.get(modelName);
  }

  static async preload(models?: { extractor?: string; ner?: string; pii?: string }) {
    const tasks: Promise<any>[] = [];
    if (models?.extractor) tasks.push(this.getExtractor(models.extractor));
    if (models?.ner) tasks.push(this.getNER(models.ner));
    if (models?.pii) tasks.push(this.getPIIClassifier(models.pii));
    await Promise.all(tasks);
  }
}
