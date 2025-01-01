// Background script for handling model worker and file downloads
import * as XLSX from 'xlsx';

let modelWorker = null;
let pendingRequests = {};

// Initialize web worker for model processing
function setupWorker() {
  try {
    console.log('[Background] Setting up worker...');
    const workerUrl = chrome.runtime.getURL("model-worker.js");
    console.log('[Background] Worker URL:', workerUrl);
    modelWorker = new Worker(workerUrl);
    console.log('[Background] Worker created successfully');
    
    // Add error handler
    modelWorker.onerror = (error) => {
      console.error('[Background] Worker error:', error);
    };
    
    modelWorker.onmessage = (evt) => {
      const { type, data, requestId } = evt.data;
      console.log(`[Background] Worker Message Received - Type: ${type}, RequestId: ${requestId}, Data:`, data);
      
      if (requestId && pendingRequests[requestId]) {
        const { resolve, reject } = pendingRequests[requestId];
        delete pendingRequests[requestId];  // Clean up immediately

        switch (type) {
          case "response":
            console.log('[Background] Received from worker:', evt.data);
            console.log('[Background] Sending to popup:', evt.data);
            resolve(evt.data);
            break;
          case "error":
            reject(new Error(data));
            break;
          case "status":
            if (data === "model_ready") {
              resolve(data);
            } else if (data.includes("error") || data.includes("失败")) {
              reject(new Error(data));
            }
            break;
        }
      } else if (type === "status") {
        // Log status messages even without requestId
        console.log("[Worker Status]", data);
      }
    };
    
    // Initialize the model in the worker
    console.log('[Background] Sending init message to worker');
    modelWorker.postMessage({ type: "init" });
  } catch (error) {
    console.error('[Background] Failed to setup worker:', error);
    throw error;
  }
}

// Set up worker when extension loads
try {
  setupWorker();
  console.log('[Background] Worker setup completed');
} catch (error) {
  console.error('[Background] Worker setup failed:', error);
}

// Queue content for processing by worker
async function queueContentRequest(question, content) {
  try {
    console.log('[Background] Queueing content request:', { question, content });
    return new Promise((resolve, reject) => {
      const requestId = Date.now();
      pendingRequests[requestId] = { resolve, reject };
      
      // Forward the request to the worker
      modelWorker.postMessage({
        type: "generate",
        requestId,
        data: {
          question,
          content
        }
      });
    });
  } catch (error) {
    console.error('Error queuing content request:', error);
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
        if (!modelWorker) {
          // If worker isn't ready, try to set it up
          setupWorker();
          sendResponse({ status: 'loading', message: '模型正在初始化，请稍等...' });
          return;
        }
        
        const response = await queueContentRequest(question, content);
        sendResponse({ response });
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
