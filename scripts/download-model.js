import { pipeline, env } from '@huggingface/transformers';
import path from 'path';

// Force download to a local folder in the project root
const modelPath = path.join(process.cwd(), 'models');
env.cacheDir = modelPath;
env.localModelPath = modelPath;
env.allowRemoteModels = true; 

async function download() {
  console.log('Downloading MiniLM-L6-v2 to ./models...');
  await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    device: 'cpu'
  });
  console.log('Downloading BERT-NER to ./models...');
  await pipeline('token-classification', 'Xenova/bert-base-NER', {
    device: 'cpu'
  });
  console.log('Model downloaded successfully.');
}

download();