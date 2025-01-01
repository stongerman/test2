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
          // Extract numeric data (view counts, etc.)
          numericData: {
            // Extract view counts from various common formats
            viewCounts: Array.from(document.querySelectorAll('*')).map(el => {
              const text = el.innerText || '';
              // Match patterns like "1.2M views", "1,234次观看", "1.5k播放量"
              const viewMatch = text.match(/(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:K|k|M|万|千|百万)?\s*(views?|次观看|播放量|观看)/i);
              if (viewMatch) {
                let count = parseFloat(viewMatch[1].replace(/,/g, ''));
                // Convert K/M/万 to actual numbers
                const multiplier = viewMatch[0].toLowerCase().includes('k') ? 1000 :
                                 viewMatch[0].toLowerCase().includes('m') ? 1000000 :
                                 viewMatch[0].includes('万') ? 10000 :
                                 viewMatch[0].includes('千') ? 1000 :
                                 viewMatch[0].includes('百万') ? 1000000 : 1;
                count *= multiplier;
                
                return {
                  element: el.tagName.toLowerCase(),
                  text: text.trim(),
                  viewCount: count,
                  rawMatch: viewMatch[0]
                };
              }
              return null;
            }).filter(item => item !== null),
            
            // Extract other numeric metrics (likes, comments, etc.)
            metrics: Array.from(document.querySelectorAll('*')).map(el => {
              const text = el.innerText || '';
              // Match patterns like "1.2K likes", "1,234 评论"
              const metricMatch = text.match(/(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:K|k|M|万|千|百万)?\s*(likes?|comments?|赞|评论|点赞)/i);
              if (metricMatch) {
                let value = parseFloat(metricMatch[1].replace(/,/g, ''));
                const multiplier = metricMatch[0].toLowerCase().includes('k') ? 1000 :
                                 metricMatch[0].toLowerCase().includes('m') ? 1000000 :
                                 metricMatch[0].includes('万') ? 10000 :
                                 metricMatch[0].includes('千') ? 1000 :
                                 metricMatch[0].includes('百万') ? 1000000 : 1;
                value *= multiplier;
                
                return {
                  element: el.tagName.toLowerCase(),
                  text: text.trim(),
                  value: value,
                  type: metricMatch[2].toLowerCase(),
                  rawMatch: metricMatch[0]
                };
              }
              return null;
            }).filter(item => item !== null)
          },
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
      console.log('[Content] Received AI processing request:', {
        question: request.data?.question,
        hasContent: !!request.data?.content,
        timestamp: new Date().toISOString()
      });

      const startTime = performance.now();
      try {
        // Extract content and numeric data
        const content = request.data.content?.mainContent;
        const text = content?.text ?? "";
        const numericData = content?.numericData ?? { viewCounts: [], metrics: [] };
        
        console.log('[Content] Extracted data for processing:', {
          textLength: text.length,
          viewCounts: numericData.viewCounts.length,
          metrics: numericData.metrics.length,
          timeMs: Math.round(performance.now() - startTime)
        });
        
        // Pass both text and structured numeric data
        const result = await processContentRequest(
          request.data.question,
          text,
          numericData
        );

        console.log('[Content] AI processing completed:', {
          hasResponse: !!result?.response,
          responseLength: result?.response?.length,
          timeMs: Math.round(performance.now() - startTime)
        });

        sendResponse(result);
      } catch (error) {
        console.error('[Content] Error processing content:', {
          error: error.message,
          stack: error.stack,
          timeMs: Math.round(performance.now() - startTime)
        });
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
