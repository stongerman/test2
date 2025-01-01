import * as tf from '@tensorflow/tfjs';
import * as use from '@tensorflow-models/universal-sentence-encoder';

let model = null;

/**
 * Initialize the Universal Sentence Encoder model
 */
export async function setupModel() {
  if (model) return;
  try {
    model = await use.load();
    console.log('Model loaded successfully');
  } catch (error) {
    console.error('Error loading model:', error);
    throw error;
  }
}

/**
 * Process a content request by computing embeddings and similarities
 * @param {string} question - The user's question
 * @param {string} content - The webpage content to analyze
 * @returns {Promise<{response: string}>} The AI response
 */
export async function processContentRequest(question, content, numericData = { viewCounts: [], metrics: [] }) {
  console.log('[AI Model] Starting request processing:', {
    questionLength: question.length,
    contentLength: content.length,
    numericData: {
      viewCounts: numericData.viewCounts.length,
      metrics: numericData.metrics.length
    }
  });

  if (!model) {
    console.error('[AI Model] Error: Model not initialized');
    throw new Error('Model not initialized. Call setupModel() first.');
  }

  const startTime = performance.now();
  try {
    // Split content into chunks of reasonable size (500 chars)
    console.log('[AI Model] Splitting content into chunks...');
    const chunks = splitIntoChunks(content, 500);
    console.log('[AI Model] Content split into chunks:', {
      totalChunks: chunks.length,
      averageChunkLength: Math.round(chunks.reduce((sum, chunk) => sum + chunk.length, 0) / chunks.length)
    });
    
    // Get embeddings for question and content chunks
    console.log('[AI Model] Computing embeddings...');
    const embedStart = performance.now();
    const questionEmbedding = await model.embed([question]);
    const contentEmbeddings = await model.embed(chunks);
    console.log('[AI Model] Embeddings computed:', {
      timeMs: Math.round(performance.now() - embedStart)
    });

    // Convert embeddings to tensors for computation
    const questionTensor = questionEmbedding;
    const contentTensor = contentEmbeddings;

    // Compute cosine similarities between question and all content chunks
    console.log('[AI Model] Computing similarities...');
    const similarityStart = performance.now();
    const similarities = await computeCosineSimilarities(questionTensor, contentTensor);
    console.log('[AI Model] Similarities computed:', {
      timeMs: Math.round(performance.now() - similarityStart)
    });
    
    // Get the most relevant chunks based on similarity scores
    const topChunks = getTopChunks(chunks, similarities.arraySync(), 3);
    console.log('[AI Model] Selected top chunks:', {
      count: topChunks.length,
      averageLength: Math.round(topChunks.reduce((sum, chunk) => sum + chunk.length, 0) / topChunks.length)
    });

    // Generate response based on relevant content
    console.log('[AI Model] Generating response...');
    const response = generateResponse(question, topChunks, numericData);

    return { response };
  } catch (error) {
    console.error('Error processing content:', error);
    throw error;
  }
}

/**
 * Split text into chunks of specified size
 */
function splitIntoChunks(text, chunkSize) {
  const chunks = [];
  let currentChunk = '';
  const sentences = text.split(/[.!?]+/);

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    currentChunk += sentence + '. ';
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Compute cosine similarities between question and content embeddings
 */
async function computeCosineSimilarities(questionEmbedding, contentEmbeddings) {
  // Normalize the embeddings
  const normalizedQuestion = tf.div(
    questionEmbedding,
    tf.norm(questionEmbedding, 2, 1, true)
  );
  const normalizedContent = tf.div(
    contentEmbeddings,
    tf.norm(contentEmbeddings, 2, 1, true)
  );

  // Compute dot product
  const similarities = tf.matMul(normalizedQuestion, normalizedContent.transpose());
  
  return similarities;
}

/**
 * Get top chunks based on similarity scores
 */
function getTopChunks(chunks, similarities, topK) {
  // Create array of {chunk, score} objects
  const scoredChunks = chunks.map((chunk, i) => ({
    chunk,
    score: similarities[0][i]
  }));

  // Sort by score and get top K chunks
  return scoredChunks
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(item => item.chunk);
}

/**
 * Generate a response based on the question and relevant content
 */
function generateResponse(question, relevantChunks, numericData = { viewCounts: [], metrics: [] }) {
  // Convert question to lowercase for easier matching
  const lowerQuestion = question.toLowerCase();
  
  // Check for sorting requests
  if (lowerQuestion.includes('sort by') || lowerQuestion.includes('排序')) {
    try {
      // Use the structured numeric data passed from content.js
      const items = numericData.viewCounts;
      
      if (items.length > 0) {
        // Sort items by view count
        items.sort((a, b) => b.viewCount - a.viewCount);
        
        // Format response with more details
        let response = '按观看次数排序的结果：\n\n';
        items.forEach((item, index) => {
          // Format view count with appropriate units
          let formattedCount = item.viewCount;
          if (formattedCount >= 1000000) {
            formattedCount = (formattedCount / 1000000).toFixed(1) + 'M';
          } else if (formattedCount >= 10000) {
            formattedCount = (formattedCount / 10000).toFixed(1) + '万';
          } else if (formattedCount >= 1000) {
            formattedCount = (formattedCount / 1000).toFixed(1) + 'K';
          }
          
          response += `${index + 1}. ${item.text}\n`;
          response += `   观看次数: ${formattedCount}\n`;
          response += `   元素类型: ${item.element}\n\n`;
        });
        
        // Add summary
        response += `\n总计找到 ${items.length} 个结果`;
        if (items.length > 1) {
          const totalViews = items.reduce((sum, item) => sum + item.viewCount, 0);
          let avgViews = Math.round(totalViews / items.length);
          // Format average views
          if (avgViews >= 1000000) {
            avgViews = (avgViews / 1000000).toFixed(1) + 'M';
          } else if (avgViews >= 10000) {
            avgViews = (avgViews / 10000).toFixed(1) + '万';
          } else if (avgViews >= 1000) {
            avgViews = (avgViews / 1000).toFixed(1) + 'K';
          }
          response += `\n平均观看次数: ${avgViews}`;
        }
        return response;
      } else {
        return '未找到任何观看次数信息。请确保页面包含观看次数数据。';
      }
    } catch (error) {
      console.error('Error processing sort request:', error);
      return '处理排序请求时出错：' + error.message;
    }
  }

  // Check for filtering requests
  if (lowerQuestion.includes('filter') || lowerQuestion.includes('筛选')) {
    // Similar structure for filtering logic
    // To be implemented based on specific filtering needs
    return `抱歉，筛选功能正在开发中。以下是相关内容：\n\n${relevantChunks.join('\n\n')}`;
  }

  // For general questions, provide a more structured response
  const context = relevantChunks.join('\n\n');
  let response = `基于页面内容，以下是对您问题的回答：\n\n`;
  response += `问题：${question}\n\n`;
  response += `相关内容：\n${context}\n\n`;
  response += `总结：根据以上内容，`;
  // Add basic content analysis
  if (context.length > 200) {
    response += context.substring(0, 200) + '...';
  } else {
    response += context;
  }
  
  return response;
}
