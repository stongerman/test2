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
export async function processContentRequest(question, content) {
  if (!model) {
    throw new Error('Model not initialized. Call setupModel() first.');
  }

  try {
    // Split content into chunks of reasonable size (500 chars)
    const chunks = splitIntoChunks(content, 500);
    
    // Get embeddings for question and content chunks
    const questionEmbedding = await model.embed([question]);
    const contentEmbeddings = await model.embed(chunks);

    // Convert embeddings to tensors for computation
    const questionTensor = questionEmbedding;
    const contentTensor = contentEmbeddings;

    // Compute cosine similarities between question and all content chunks
    const similarities = await computeCosineSimilarities(questionTensor, contentTensor);
    
    // Get the most relevant chunks based on similarity scores
    const topChunks = getTopChunks(chunks, similarities.arraySync(), 3);

    // Generate response based on relevant content
    const response = generateResponse(question, topChunks);

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
function generateResponse(question, relevantChunks) {
  const context = relevantChunks.join(' ');
  return `Based on the content: "${context}", here is the response to your question "${question}": `;
}
