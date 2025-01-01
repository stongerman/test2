import * as tf from '@tensorflow/tfjs';
import * as use from '@tensorflow-models/universal-sentence-encoder';

let model = null;
let isModelLoading = false;

// Model loading configuration with fallback URLs
const MODEL_CONFIG = {
  // Default TF Hub URL
  defaultModelUrl: 'https://tfhub.dev/tensorflow/tfjs-model/universal-sentence-encoder-lite/1/default/1',
  // Fallback URLs - using CDNs that are accessible in China
  fallbackUrls: [
    'https://cdn.jsdelivr.net/npm/@tensorflow-models/universal-sentence-encoder',
    'https://unpkg.com/@tensorflow-models/universal-sentence-encoder'
  ]
};

// Pre-defined responses for different types of questions
const responses = {
  summary: '这是一个网页的摘要：',
  extract: '以下是提取的关键信息：',
  analyze: '根据内容分析：',
  default: '这是相关的内容：',
  retrying: '模型加载失败，正在尝试其他源...'
};

// Function to get cosine similarity between two vectors
function cosineSimilarity(a, b) {
  return tf.tidy(() => {
    const a_norm = a.div(tf.norm(a));
    const b_norm = b.div(tf.norm(b));
    return a_norm.dot(b_norm);
  });
}

// Handle messages from main thread
self.onmessage = async function(e) {
  const { type, data, requestId } = e.data;
  console.log(`[Worker Received Message] Type: ${type}, RequestId: ${requestId}`, data);

  console.log('[Worker] Processing message:', { type, requestId });
  switch (type) {
    case 'init':
      if (!model && !isModelLoading) {
        try {
          console.log('[Worker] Starting model initialization');
          isModelLoading = true;
          self.postMessage({ type: 'status', data: 'loading_model', requestId });
          console.log('[Worker] Posted loading_model status');
          
          console.log('[Worker] Loading Universal Sentence Encoder model...');
          const loadStart = Date.now();
          const loadTimeout = 60000; // 60 second timeout

          // Try loading from each URL until success
          for (const url of [MODEL_CONFIG.defaultModelUrl, ...MODEL_CONFIG.fallbackUrls]) {
            try {
              console.log(`[Worker] Attempting to load model from: ${url}`);
              const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`模型加载超时: ${url}`)), loadTimeout);
              });

              model = await Promise.race([
                use.load({ modelUrl: url }),
                timeoutPromise
              ]);
              
              console.log(`[Worker] Successfully loaded model from: ${url}`);
              break; // Success - exit the loop
            } catch (err) {
              console.error(`[Worker] Failed to load from ${url}:`, err);
              if (url !== MODEL_CONFIG.fallbackUrls[MODEL_CONFIG.fallbackUrls.length - 1]) {
                console.log('[Worker] Trying next fallback URL...');
                self.postMessage({ type: 'status', data: responses.retrying, requestId });
                continue;
              }
              throw new Error('所有模型源都无法访问，请检查网络设置或使用VPN');
            }
          }
          
          const loadTime = Date.now() - loadStart;
          console.log(`[Worker] Model loaded successfully in ${loadTime}ms`);
          
          self.postMessage({ type: 'status', data: 'model_ready', requestId });
        } catch (error) {
          console.error('[Worker] Error loading model:', error);
          let errorMessage = '模型加载失败';
          
          if (error.message.includes('timeout') || error.message.includes('network')) {
            errorMessage = '模型加载失败: 网络连接问题，请检查网络设置或使用VPN';
          } else if (error.message.includes('fetch')) {
            errorMessage = '模型加载失败: 无法访问模型文件，可能需要使用VPN';
          } else {
            errorMessage = '模型加载失败: ' + error.message;
          }
          
          self.postMessage({ 
            type: 'error', 
            data: errorMessage,
            requestId 
          });
        } finally {
          isModelLoading = false;
        }
      }
      break;

    case 'generate':
      if (!model) {
        self.postMessage({ 
          type: 'error', 
          data: '模型未加载，请先初始化模型' 
        });
        return;
      }

      try {
        const { question, content } = data;
        
        // Encode question and content sections
        console.log('[Worker] Generating embeddings for:', { question, content });
        const embeddings = await model.embed([
          question,
          content.title || '',
          (content.mainContent && content.mainContent.text) ? content.mainContent.text.substring(0, 500) : ''
        ]);

        // Get similarities
        const titleSimilarity = await cosineSimilarity(
          embeddings.slice([0, 0], [1, -1]),
          embeddings.slice([1, 0], [1, -1])
        ).data();
        
        const contentSimilarity = await cosineSimilarity(
          embeddings.slice([0, 0], [1, -1]),
          embeddings.slice([2, 0], [1, -1])
        ).data();


        // Generate response based on similarities
        let responsePrefix = responses.default;
        if (titleSimilarity[0] > 0.6) {
          responsePrefix = responses.summary;
        } else if (contentSimilarity[0] > 0.6) {
          responsePrefix = responses.analyze;
        }

        // Extract relevant content based on similarity
        const relevantContent = content.mainContent.text
          .split('。')
          .slice(0, 3)
          .join('。');

        const response = `${responsePrefix}\n${content.title}\n\n${relevantContent}`;
        
        self.postMessage({
          type: 'response',
          response: response,
          requestId
        });
      } catch (error) {
        self.postMessage({ 
          type: 'error', 
          data: '生成回答失败: ' + error.message,
          requestId
        });
      }
      break;
  }
};
