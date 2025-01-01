import { setupModel, processContentRequest } from './aiModel.js';

console.log('Content script loaded successfully');

// Initialize AI model
setupModel().catch(error => {
  console.error('Failed to initialize AI model:', error);
});

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Create async function to handle requests
  const handleRequest = async () => {
    if (request.type === "getContent") {
      // Extract structured content from the page
      const content = {
        title: document.title,
        url: window.location.href,
        meta: {
          description: document.querySelector('meta[name="description"]')?.content || "",
          keywords: document.querySelector('meta[name="keywords"]')?.content || "",
          author: document.querySelector('meta[name="author"]')?.content || "",
          lastModified: document.lastModified
        },
        mainContent: {
          text: document.body.innerText,
          // Extract tables for Excel export
          tables: Array.from(document.querySelectorAll('table')).map(table => ({
            headers: Array.from(table.querySelectorAll('th')).map(th => th.innerText.trim()),
            rows: Array.from(table.querySelectorAll('tr')).map(tr => 
              Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim())
            )
          })),
          // Extract lists for structured data
          lists: Array.from(document.querySelectorAll('ul, ol')).map(list => ({
            type: list.tagName.toLowerCase(),
            items: Array.from(list.querySelectorAll('li')).map(li => li.innerText.trim())
          })),
          // Extract headings for document structure
          headings: Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(heading => ({
            level: parseInt(heading.tagName[1]),
            text: heading.innerText.trim()
          }))
        }
      };
      sendResponse({ content });
    }
    
    // Handle AI processing requests
    if (request.type === "processContent") {
      try {
        const result = await processContentRequest(request.data.question, request.data.content);
        sendResponse(result);
      } catch (error) {
        console.error('Error processing content with AI:', error);
        sendResponse({ error: error.message });
      }
    }
  };

  // Execute async function and keep message channel open
  handleRequest().catch(error => {
    console.error('Error handling request:', error);
    sendResponse({ error: error.message });
  });
  return true;
});
