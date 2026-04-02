import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

env.allowRemoteModels = false; 
env.localModelPath = path.join(__dirname, '../../models'); 

export class ModelSingleton {
  private static extractor: any = null;
  private static classifier: any = null;

  static async getExtractor() {
    if (!this.extractor) {
      this.extractor = await (pipeline as any)('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    return this.extractor;
  }

  static async getNER() {
    if (!this.classifier) {
      // Token classification model for identifying sensitive entities
      this.classifier = await (pipeline as any)('token-classification', 'Xenova/bert-base-NER');
    }
    return this.classifier;
  }
}