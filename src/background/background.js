// Background script for handling file downloads and message forwarding
import * as XLSX from 'xlsx';

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "processContent") {
    console.log('[Background] Received AI processing request:', {
      type: request.type,
      questionLength: request?.data?.question?.length,
      hasContent: !!request?.data?.content,
      timestamp: new Date().toISOString()
    });

    // Forward the request to content script of active tab
    (async () => {
      const startTime = performance.now();
      try {
        console.log('[Background] Querying for active tab...');
        const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
        if (!activeTab) {
          console.error('[Background] No active tab found');
          throw new Error('没有找到活动标签页');
        }
        
        console.log('[Background] Forwarding request to content script:', {
          tabId: activeTab.id,
          url: activeTab.url,
          timeMs: Math.round(performance.now() - startTime)
        });
        
        // Forward request to content script
        chrome.tabs.sendMessage(activeTab.id, request, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[Background] Error forwarding to content script:', {
              error: chrome.runtime.lastError,
              tabId: activeTab.id,
              timeMs: Math.round(performance.now() - startTime)
            });
            sendResponse({ error: '无法连接到内容脚本，请刷新页面重试' });
            return;
          }
          console.log('[Background] Received response from content script:', {
            hasError: !!response?.error,
            responseLength: response?.response?.length,
            timeMs: Math.round(performance.now() - startTime)
          });
          sendResponse(response);
        });
      } catch (error) {
        console.error('[Background] Error processing request:', {
          error: error.message,
          stack: error.stack,
          timeMs: Math.round(performance.now() - startTime)
        });
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
