// Background script for handling TensorFlow.js model and file downloads
import * as tf from '@tensorflow/tfjs';
import * as use from '@tensorflow-models/universal-sentence-encoder';
import * as XLSX from 'xlsx';

let model = null;
let encoder = null;
let modelStatus = 'not_initialized';

// Initialize TensorFlow.js and Universal Sentence Encoder
async function initializeModel() {
  try {
    if (!encoder) {
      encoder = await use.load();
      modelStatus = 'model_ready';
      console.log('Model loaded successfully');
    }
  } catch (error) {
    console.error('Error loading model:', error);
    modelStatus = 'error';
  }
}

// Process content with semantic similarity
async function processContent(question, content) {
  try {
    const context = `${content.title}\n${content.mainContent.text.substring(0, 1000)}`;
    const sentences = [question, context];
    const embeddings = await encoder.embed(sentences);
    
    const similarity = tf.tidy(() => {
      const questionEmb = embeddings.slice([0, 0], [1, -1]);
      const contextEmb = embeddings.slice([1, 0], [1, -1]);
      return tf.metrics.cosineProximity(questionEmb, contextEmb).dataSync()[0];
    });

    // Generate response based on similarity
    let response = '';
    if (similarity > 0.7) {
      response = `根据页面内容，我找到了与您问题高度相关的信息。\n\n`;
      if (question.includes('表格') && content.mainContent.tables.length > 0) {
        response += `页面包含 ${content.mainContent.tables.length} 个表格。\n`;
        const firstTable = content.mainContent.tables[0];
        response += `第一个表格的列标题：${firstTable.headers.join(', ')}\n`;
      }
      if (question.includes('列表') && content.mainContent.lists.length > 0) {
        response += `页面包含 ${content.mainContent.lists.length} 个列表。\n`;
        const firstList = content.mainContent.lists[0];
        response += `第一个列表的内容：\n${firstList.items.slice(0, 3).join('\n')}\n`;
      }
      response += `\n相关内容：${content.mainContent.text.substring(0, 300)}...`;
    } else {
      response = '抱歉，我在页面中没有找到与您问题直接相关的信息。请尝试换个方式提问，或者查看完整的页面内容。';
    }
    
    return response;
  } catch (error) {
    console.error('Error processing content:', error);
    throw new Error('处理内容时出错，请稍后重试');
  }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "processContent") {
    const { question, content } = request.data;
    
    // Handle async operations using Promise
    (async () => {
      try {
        // Initialize model if not already initialized
        if (modelStatus === 'not_initialized') {
          await initializeModel();
        }
        
        if (modelStatus === 'error') {
          sendResponse({ error: '模型加载失败，请刷新页面重试' });
          return;
        }
        
        if (modelStatus !== 'model_ready') {
          sendResponse({ error: '模型正在加载中，请稍后再试' });
          return;
        }
        
        const response = await processContent(question, content);
        sendResponse({ response });
      } catch (error) {
        console.error('Error:', error);
        sendResponse({ error: error.message });
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
