// Background script for handling model processing and file downloads
import * as XLSX from 'xlsx';

let modelProcessor = null;

// Initialize model processing in service worker context
async function setupWorker() {
  try {
    console.log('[Background] Setting up model processor...');
    
    try {
      // Create a new worker using the bundled worker file
      const workerUrl = chrome.runtime.getURL('model-worker.js');
      console.log('[Background] Worker URL:', workerUrl);
      
      if (!workerUrl) {
        throw new Error('Failed to get worker URL from chrome.runtime.getURL');
      }
      
      const worker = new Worker(workerUrl, { type: 'module' });
      console.log('[Background] Worker created successfully');
      
      // Set up error handler
      worker.onerror = (error) => {
        console.error('[Background] Worker error:', error);
        throw new Error(`Worker initialization failed: ${error.message}`);
      };
      
      return worker;
    } catch (error) {
      console.error('[Background] Failed to create worker:', error);
      throw error;
    }
    
    // Set up worker message handling
    worker.onmessage = (event) => {
      const { type, data, requestId } = event.data;
      console.log('[Background] Received worker message:', { type, data, requestId });
      if (type === 'model_ready') {
        modelProcessor = worker;
      }
    };
    
    // Initialize the worker
    worker.postMessage({ type: 'init', requestId: Date.now() });
    console.log('[Background] Model processor code loaded successfully');
    
    // Initialize the model processor
    modelProcessor = new ModelProcessor();
    await modelProcessor.initialize();
    console.log('[Background] Model processor initialized');
    
    return true;
  } catch (error) {
    console.error('[Background] Failed to setup model processor:', error);
    throw error;
  }
}

// Initialize model processor when extension loads
setupWorker().catch(error => {
  console.error('[Background] Model processor initialization failed:', error);
});

// Process content using the model processor
async function processContentRequest(question, content) {
  try {
    console.log('[Background] Processing content request:', { question, content });
    
    if (!modelProcessor) {
      throw new Error('Model processor not initialized');
    }
    
    return new Promise((resolve, reject) => {
      const requestId = Date.now();
      
      const messageHandler = (event) => {
        const { type, response, error, requestId: responseId } = event.data;
        if (responseId !== requestId) return;
        
        modelProcessor.removeEventListener('message', messageHandler);
        
        if (type === 'error') {
          reject(new Error(error));
        } else if (type === 'response') {
          resolve({ response });
        }
      };
      
      modelProcessor.addEventListener('message', messageHandler);
      modelProcessor.postMessage({
        type: 'generate',
        data: { question, content },
        requestId
      });
    });
  } catch (error) {
    console.error('Error processing content request:', error);
    throw new Error('处理请求时出错，请稍后重试');
  }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "processContent") {
    const { question, content } = request.data;
    
    // Handle async operations using Promise
    (async () => {
      try {
        if (!modelProcessor) {
          await setupWorker();
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
