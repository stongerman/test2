const XLSX = require('xlsx');

document.addEventListener('DOMContentLoaded', function() {
  const extractButton = document.getElementById('extractContent');
  const askButton = document.getElementById('askAI');
  const exportButton = document.getElementById('exportExcel');
  const contentArea = document.getElementById('content');
  const questionInput = document.getElementById('question');

  let extractedData = null;

  const showError = (message) => {
    contentArea.value = `错误: ${message}`;
    contentArea.style.color = 'red';
  };

  const resetUI = () => {
    contentArea.style.color = 'initial';
    extractButton.disabled = false;
    extractButton.textContent = '读取页面内容';
  };

  // Format extracted content for display
  const formatContent = (content) => {
    const parts = [];
    parts.push(`标题: ${content.title}`);
    parts.push(`URL: ${content.url}`);
    parts.push('\n元数据:');
    Object.entries(content.meta).forEach(([key, value]) => {
      if (value) parts.push(`${key}: ${value}`);
    });
    
    parts.push('\n主要内容:');
    parts.push(content.mainContent.text.substring(0, 500) + '...');
    
    if (content.mainContent.tables.length) {
      parts.push('\n发现的表格:');
      parts.push(`共 ${content.mainContent.tables.length} 个表格`);
    }
    
    if (content.mainContent.lists.length) {
      parts.push('\n发现的列表:');
      parts.push(`共 ${content.mainContent.lists.length} 个列表`);
    }
    
    if (content.mainContent.headings.length) {
      parts.push('\n文档结构:');
      content.mainContent.headings.forEach(h => {
        parts.push(`${'-'.repeat(h.level)} ${h.text}`);
      });
    }
    
    return parts.join('\n');
  };

  // Extract content button handler
  extractButton.addEventListener('click', async () => {
    try {
      extractButton.disabled = true;
      extractButton.textContent = '正在读取...';
      contentArea.value = '正在提取页面内容，请稍候...';
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('无法访问当前标签页');
      }
      
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'getContent' });
      if (!response || response.error) {
        throw new Error(response.error || '无法读取页面内容');
      }
      
      extractedData = response.content;
      
      // Enable AI interaction after content extraction
      askButton.disabled = false;
      questionInput.disabled = false;
      contentArea.value = formatContent(extractedData);
      
    } catch (error) {
      showError(error.message || '提取内容时发生错误');
      extractedData = null;
    } finally {
      resetUI();
    }
  });

  // Ask AI button handler
  askButton.addEventListener('click', async () => {
    const question = questionInput.value;
    if (!extractedData || !question) {
      showError('请先提取页面内容并输入问题');
      return;
    }

    try {
      askButton.disabled = true;
      askButton.textContent = '正在询问AI...';
      contentArea.value += '\n\n正在等待AI回答...\n';

      let attempts = 0;
      const maxAttempts = 60; // 60 seconds timeout
      const response = await new Promise((resolve, reject) => {
        const checkModel = () => {
          console.log('[Popup] Attempt', attempts + 1, 'of', maxAttempts, '- Sending message to background');
          chrome.runtime.sendMessage({
            type: 'processContent',
            data: { question, content: extractedData }
          }, response => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else if (response.status === 'loading') {
              attempts++;
              if (attempts >= maxAttempts) {
                reject(new Error('AI模型加载超时，请刷新页面重试'));
              } else {
                const remainingTime = maxAttempts - attempts;
                const message = response.message || '正在加载AI模型...';
                contentArea.value = `${message}\n重试第 ${attempts} 次 (共 ${maxAttempts} 次)\n预计剩余时间：${remainingTime} 秒`;
                setTimeout(checkModel, 1000);
              }
            } else {
              resolve(response);
            }
          });
        };
        checkModel();
      });

      console.log('[Popup] Received response:', response);
      console.log('[Popup] Response type:', typeof response);
      console.log('[Popup] Response.response type:', response && typeof response.response);
      if (response && typeof response.response === "string") {
        contentArea.value += `\n问题：${question}\n回答：${response.response}`;
      } else {
        console.error('[Popup] Invalid response format:', response);
        showError("AI返回格式异常，请重试");
      }
    } catch (error) {
      showError(error.message || 'AI回答出错');
    } finally {
      askButton.disabled = false;
      askButton.textContent = '询问AI';
    }
  });

  // Export Excel button handler
  exportButton.addEventListener('click', async () => {
    if (!extractedData) {
      showError('请先提取页面内容');
      return;
    }
    
    chrome.runtime.sendMessage({
      type: 'exportExcel',
      data: { content: extractedData }
    });
  });
});
