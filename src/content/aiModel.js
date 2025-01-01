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

  // Check for Amazon product analysis requests
  if (relevantChunks[0]?.includes('amazon') || lowerQuestion.includes('product') || lowerQuestion.includes('商品')) {
    try {
      const amazonData = extractAmazonData(relevantChunks);
      
      // Handle different types of product analysis requests
      if (lowerQuestion.includes('keyword') || lowerQuestion.includes('关键词')) {
        return analyzeProductKeywords(amazonData);
      } else if (lowerQuestion.includes('review') || lowerQuestion.includes('评论')) {
        return analyzeProductReviews(amazonData);
      } else if (lowerQuestion.includes('compare') || lowerQuestion.includes('比较')) {
        return compareProducts(amazonData);
      } else if (lowerQuestion.includes('feature') || lowerQuestion.includes('特点')) {
        return analyzeProductFeatures(amazonData);
      } else {
        // General product analysis
        return generateProductAnalysis(amazonData);
      }
    } catch (error) {
      console.error('Error analyzing Amazon product:', error);
      return '分析商品信息时出错：' + error.message;
    }
  }

  // For general questions, provide a structured response
  const context = relevantChunks.join('\n\n');
  let response = `基于页面内容，以下是对您问题的回答：\n\n`;
  response += `问题：${question}\n\n`;
  response += `相关内容：\n${context}\n\n`;
  response += `总结：根据以上内容，`;
  if (context.length > 200) {
    response += context.substring(0, 200) + '...';
  } else {
    response += context;
  }
  
  return response;
}

/**
 * Extract structured data from Amazon product content
 */
function extractAmazonData(chunks) {
  const data = {
    title: '',
    price: '',
    description: '',
    features: [],
    reviews: [],
    specifications: {}
  };

  for (const chunk of chunks) {
    // Extract product title
    const titleMatch = chunk.match(/商品名称：(.+?)(?:\n|$)/);
    if (titleMatch) data.title = titleMatch[1].trim();

    // Extract price
    const priceMatch = chunk.match(/价格：(.+?)(?:\n|$)/);
    if (priceMatch) data.price = priceMatch[1].trim();

    // Extract description
    const descMatch = chunk.match(/商品描述：(.+?)(?:\n|$)/);
    if (descMatch) data.description = descMatch[1].trim();

    // Extract features
    const featureMatches = chunk.match(/特点：([\s\S]+?)(?:\n\n|$)/);
    if (featureMatches) {
      data.features = featureMatches[1].split('\n').map(f => f.trim()).filter(f => f);
    }

    // Extract reviews
    const reviewMatches = chunk.match(/评论：([\s\S]+?)(?:\n\n|$)/);
    if (reviewMatches) {
      data.reviews = reviewMatches[1].split('\n').map(r => r.trim()).filter(r => r);
    }

    // Extract specifications
    const specMatches = chunk.match(/规格：([\s\S]+?)(?:\n\n|$)/);
    if (specMatches) {
      const specs = specMatches[1].split('\n');
      specs.forEach(spec => {
        const [key, value] = spec.split(':').map(s => s.trim());
        if (key && value) data.specifications[key] = value;
      });
    }
  }

  return data;
}

/**
 * Analyze product keywords using TF-IDF
 */
function analyzeProductKeywords(data) {
  const keywords = new Set();
  const text = [data.title, data.description, ...data.features].join(' ');
  
  // Split into words and count frequencies
  const words = text.toLowerCase().match(/[\u4e00-\u9fa5a-z]+/g) || [];
  const frequencies = {};
  words.forEach(word => {
    frequencies[word] = (frequencies[word] || 0) + 1;
  });


  // Sort by frequency and get top keywords
  const sortedKeywords = Object.entries(frequencies)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([word]) => word);

  let response = '商品关键词分析：\n\n';
  response += `标题：${data.title}\n\n`;
  response += '主要关键词：\n';
  sortedKeywords.forEach((keyword, index) => {
    response += `${index + 1}. ${keyword}\n`;
  });

  return response;
}

/**
 * Analyze product reviews for sentiment and key points
 */
function analyzeProductReviews(data) {
  if (!data.reviews.length) {
    return '未找到商品评论信息。';
  }

  let response = '商品评论分析：\n\n';
  
  // Analyze sentiment
  const sentiments = data.reviews.map(review => ({
    text: review,
    sentiment: review.includes('好') || review.includes('赞') || review.includes('优') ? '正面' :
               review.includes('差') || review.includes('烂') || review.includes('退') ? '负面' : '中性'
  }));

  const positiveCount = sentiments.filter(s => s.sentiment === '正面').length;
  const negativeCount = sentiments.filter(s => s.sentiment === '负面').length;
  
  response += `评论情感分析：\n`;
  response += `- 正面评论：${positiveCount}条\n`;
  response += `- 负面评论：${negativeCount}条\n`;
  response += `- 好评率：${Math.round((positiveCount / sentiments.length) * 100)}%\n\n`;

  return response;
}

/**
 * Analyze product features and selling points
 */
function analyzeProductFeatures(data) {
  if (!data.features.length) {
    return '未找到商品特点信息。';
  }

  let response = '商品特点分析：\n\n';
  response += '主要卖点：\n';
  data.features.forEach((feature, index) => {
    response += `${index + 1}. ${feature}\n`;
  });

  if (data.specifications) {
    response += '\n技术规格：\n';
    Object.entries(data.specifications).forEach(([key, value]) => {
      response += `- ${key}: ${value}\n`;
    });
  }

  return response;
}

/**
 * Generate comprehensive product analysis
 */
function generateProductAnalysis(data) {
  let response = '商品综合分析：\n\n';
  
  response += `商品名称：${data.title}\n`;
  response += `价格：${data.price}\n\n`;
  
  if (data.features.length) {
    response += '主要特点：\n';
    data.features.slice(0, 5).forEach((feature, index) => {
      response += `${index + 1}. ${feature}\n`;
    });
  }

  if (data.reviews.length) {
    response += '\n评论概况：\n';
    response += `- 总评论数：${data.reviews.length}\n`;
    const positiveReviews = data.reviews.filter(review => 
      review.includes('好') || review.includes('赞') || review.includes('优')
    ).length;
    response += `- 好评率：${Math.round((positiveReviews / data.reviews.length) * 100)}%\n`;
  }

  return response;
}

/**
 * Compare multiple products or variations
 */
function compareProducts(data) {
  // If no related products, return basic analysis
  if (!data.relatedProducts || data.relatedProducts.length === 0) {
    return generateProductAnalysis(data);
  }

  let response = '商品对比分析：\n\n';

  // Current product details
  response += '当前商品：\n';
  response += `- 名称：${data.title}\n`;
  response += `- 价格：${data.price}\n`;
  if (data.rating && data.rating.overall) {
    response += `- 评分：${data.rating.overall}\n`;
  }

  // Related products comparison
  response += '\n相关商品：\n';
  data.relatedProducts.forEach((product, index) => {
    response += `\n${index + 1}. ${product.title}\n`;
    response += `   价格：${product.price}\n`;
    if (product.rating) {
      response += `   评分：${product.rating}\n`;
    }
  });

  // Price comparison
  const prices = [
    { name: '当前商品', price: parseFloat(data.price?.replace(/[^0-9.]/g, '')) },
    ...data.relatedProducts.map(p => ({
      name: p.title,
      price: parseFloat(p.price?.replace(/[^0-9.]/g, ''))
    }))
  ].filter(p => !isNaN(p.price));

  if (prices.length > 1) {
    response += '\n价格分析：\n';
    const avgPrice = prices.reduce((sum, p) => sum + p.price, 0) / prices.length;
    const minPrice = Math.min(...prices.map(p => p.price));
    const maxPrice = Math.max(...prices.map(p => p.price));

    response += `- 平均价格：¥${avgPrice.toFixed(2)}\n`;
    response += `- 最低价格：¥${minPrice.toFixed(2)}\n`;
    response += `- 最高价格：¥${maxPrice.toFixed(2)}\n`;
    response += `- 价格区间：¥${(maxPrice - minPrice).toFixed(2)}\n`;
  }

  return response;
}
