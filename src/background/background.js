// Background script for handling model processing and file downloads
import * as XLSX from 'xlsx';
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

// Initialize model processing
async function setupModel() {
  try {
    console.log('[Background] Setting up model processor...');
    
    if (!model && !isModelLoading) {
      try {
        console.log('[Background] Starting model initialization');
        isModelLoading = true;
        
        console.log('[Background] Loading Universal Sentence Encoder model...');
        const loadStart = Date.now();
        const loadTimeout = 60000; // 60 second timeout

        // Try loading from each URL until success
        for (const url of [MODEL_CONFIG.defaultModelUrl, ...MODEL_CONFIG.fallbackUrls]) {
          try {
            console.log(`[Background] Attempting to load model from: ${url}`);
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error(`模型加载超时: ${url}`)), loadTimeout);
            });

            model = await Promise.race([
              use.load({ modelUrl: url }),
              timeoutPromise
            ]);
            
            console.log(`[Background] Successfully loaded model from: ${url}`);
            break; // Success - exit the loop
          } catch (err) {
            console.error(`[Background] Failed to load from ${url}:`, err);
            if (url !== MODEL_CONFIG.fallbackUrls[MODEL_CONFIG.fallbackUrls.length - 1]) {
              console.log('[Background] Trying next fallback URL...');
              continue;
            }
            throw new Error('所有模型源都无法访问，请检查网络设置或使用VPN');
          }
        }
        
        const loadTime = Date.now() - loadStart;
        console.log(`[Background] Model loaded successfully in ${loadTime}ms`);
        return true;
      } catch (error) {
        console.error('[Background] Error loading model:', error);
        let errorMessage = '模型加载失败';
        
        if (error.message.includes('timeout') || error.message.includes('network')) {
          errorMessage = '模型加载失败: 网络连接问题，请检查网络设置或使用VPN';
        } else if (error.message.includes('fetch')) {
          errorMessage = '模型加载失败: 无法访问模型文件，可能需要使用VPN';
        } else {
          errorMessage = '模型加载失败: ' + error.message;
        }
        
        throw new Error(errorMessage);
      } finally {
        isModelLoading = false;
      }
    }
    return true;
  } catch (error) {
    console.error('[Background] Failed to setup model:', error);
    throw error;
  }
}

// Initialize model when extension loads
setupModel().catch(error => {
  console.error('[Background] Model initialization failed:', error);
});

// Process content using the model directly
async function processContentRequest(question, content) {
  try {
    console.log('[Background] Processing content request:', { question, content });
    
    if (!model) {
      throw new Error('模型未加载，请先初始化模型');
    }
    
    // Encode question and content sections
    console.log('[Background] Generating embeddings for:', { question, content });
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
    return { response };
  } catch (error) {
    console.error('Error processing content request:', error);
    throw new Error('处理请求时出错：' + error.message);
  }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "processContent") {
    const { question, content } = request.data;
    
    // Handle async operations using Promise
    (async () => {
      try {
        if (!model) {
          await setupModel();
        }
        
        const result = await processContentRequest(question, content);
        sendResponse(result);
      } catch (error) {
        console.error('Error:', error);
        sendResponse({ error: error.message || '处理请求时出错，请稍后重试' });
      }
    })();
    
    return true; // Keep the message channel open for async response
  } else if (request.type === "exportExcel") {
    const { content } = request.data;
    
    try {
      // Create workbook
      const wb = XLSX.utils.book_new();
      
      // Add main content sheet
      const mainContentData = [
        ['标题', content.title],
        ['URL', content.url],
        ['描述', content.meta.description],
        ['关键词', content.meta.keywords],
        ['作者', content.meta.author],
        ['最后修改时间', content.meta.lastModified],
        ['正文内容', content.mainContent.text]
      ];
      const mainWs = XLSX.utils.aoa_to_sheet(mainContentData);
      XLSX.utils.book_append_sheet(wb, mainWs, '页面基本信息');

      // Add tables sheet if tables exist
      if (content.mainContent.tables && content.mainContent.tables.length > 0) {
        content.mainContent.tables.forEach((table, index) => {
          const tableData = [table.headers, ...table.rows];
          const tableWs = XLSX.utils.aoa_to_sheet(tableData);
          XLSX.utils.book_append_sheet(wb, tableWs, `表格${index + 1}`);
        });
      }

      // Add lists sheet if lists exist
      if (content.mainContent.lists && content.mainContent.lists.length > 0) {
        const listsData = content.mainContent.lists.map(list => [
          `${list.type === 'ul' ? '无序列表' : '有序列表'}`,
          ...list.items
        ]);
        const listsWs = XLSX.utils.aoa_to_sheet(listsData);
        XLSX.utils.book_append_sheet(wb, listsWs, '列表内容');
      }

      // Add headings sheet if headings exist
      if (content.mainContent.headings && content.mainContent.headings.length > 0) {
        const headingsData = content.mainContent.headings.map(heading => [
          `H${heading.level}`,
          heading.text
        ]);
        const headingsWs = XLSX.utils.aoa_to_sheet(headingsData);
        XLSX.utils.book_append_sheet(wb, headingsWs, '标题结构');
      }

      // Generate Excel file
      const excelBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      
      // Create blob and download URL
      const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      
      // Trigger download
      chrome.downloads.download({
        url: url,
        filename: `${content.title.replace(/[<>:"/\\|?*]/g, '_')}_导出.xlsx`,
        saveAs: true
      });

      sendResponse({ status: "success" });
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      sendResponse({ error: '导出Excel文件时出错，请重试' });
    }
    return true;
  }
});
