import * as tf from '@tensorflow/tfjs';
import * as use from '@tensorflow-models/universal-sentence-encoder';

let model = null;
let isModelLoading = false;

// Pre-defined responses for different types of questions
const responses = {
  summary: '这是一个网页的摘要：',
  extract: '以下是提取的关键信息：',
  analyze: '根据内容分析：',
  default: '这是相关的内容：'
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
  const { type, data } = e.data;

  switch (type) {
    case 'init':
      if (!model && !isModelLoading) {
        try {
          isModelLoading = true;
          self.postMessage({ type: 'status', data: 'loading_model' });
          
          model = await use.load();
          
          self.postMessage({ type: 'status', data: 'model_ready' });
        } catch (error) {
          self.postMessage({ 
            type: 'error', 
            data: '模型加载失败: ' + error.message 
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
        const embeddings = await model.embed([
          question,
          content.title,
          content.mainContent.text.substring(0, 500)
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
          data: response 
        });
      } catch (error) {
        self.postMessage({ 
          type: 'error', 
          data: '生成回答失败: ' + error.message 
        });
      }
      break;
  }
};
