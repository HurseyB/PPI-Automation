/**
 * Perplexity AI Automator - Content Script
 * Fixed: Now properly sequences prompt submission and response waiting
 */

class PerplexityAutomator {
  constructor() {
    this.isReady = false;
    this.currentPrompt = null;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.submitDelay = 1500;
    this.waitTimeout = 10000;
    this.responseTimeout = 45000; // Increased for longer AI responses
    this.isExecuting = false; // NEW: Prevent concurrent executions
    this.selectors = {
      textareas: [
        'textarea',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="follow"]',
        'textarea[data-testid*="search"]',
        'textarea[aria-label*="search"]',
        '[data-testid="searchbox"] textarea',
        '.search-box textarea',
        '#search-input'
      ],
      contentEditable: [
        '[contenteditable="true"]',
        '[contenteditable] textarea',
        'div[contenteditable="true"]',
        '[role="textbox"]'
      ],
      textInputs: [
        'input[type="text"]',
        'input[placeholder*="Ask"]',
        'input[placeholder*="search"]'
      ],
      submitButtons: [
        'button[type="submit"]',
        'button[aria-label*="submit"]',
        'button[aria-label*="Send"]',
        'button[data-testid*="submit"]',
        'button[data-testid*="send"]',
        '[data-testid="search-submit-button"]',
        '.submit-button',
        'button[title*="Send"]',
        'button svg[data-icon="arrow-right"]',
        'button:has(svg)',
        'form button:last-child'
      ],
      responseContainers: [
        'main .conversation-thread [data-message-author="ai"]',
        'main .markdown, .markdown-body, .prose, .conversation-message[data-author="ai"]',
        'div[data-message-author="ai"]',
        'div[data-author="ai"]',
        'main div[class*="Message"], main div[class*="message"], div[data-testid="ai-response"]'
      ]
    };
    this.responseObserver = null;
    this.currentResponseNode = null;
    this.initialize();
  }

  initialize() {
    this.log('Content script initializing on:', window.location.href);
    if (!this.isPerplexityPage()) {
      this.log('Not on Perplexity.ai page, exiting');
      return;
    }

    this.setupMessageListener();
    this.waitForPageReady();
  }

  isPerplexityPage() {
    return window.location.hostname.includes('perplexity.ai');
  }

  setupMessageListener() {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true;
    });
  }

  async waitForPageReady() {
    this.log('Waiting for page to be ready...');
    if (document.readyState !== 'complete') {
      await new Promise(resolve => window.addEventListener('load', resolve));
    }

    await this.sleep(2000);
    const input = await this.waitForInputElement();
    if (input) {
      this.isReady = true;
      this.log('Content script ready, input element found');
      try {
        await browser.runtime.sendMessage({ type: 'content-script-ready' });
      } catch (error) {
        this.logError('Failed to notify background script:', error);
      }
    } else {
      this.logError('Failed to find input element after waiting');
    }
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      this.log('Received message:', message.type);
      switch (message.type) {
        case 'execute-prompt':
          await this.executePrompt(message.prompt, message.index);
          sendResponse({ success: true });
          break;
        case 'stop-automation':
          this.stopAutomation();
          sendResponse({ success: true });
          break;
        case 'check-ready':
          sendResponse({ ready: this.isReady });
          break;
        case 'find-elements':
          const elements = this.findElements();
          sendResponse(elements);
          break;
        default:
          this.logError('Unknown message type:', message.type);
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      this.logError('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async executePrompt(prompt, index) {
    // Prevent concurrent executions
    if (this.isExecuting) {
      this.log('Already executing a prompt, ignoring new request');
      return;
    }

    this.log(`Executing prompt ${index + 1}: ${prompt.substring(0, 50)}...`);
    this.currentPrompt = prompt;
    this.retryCount = 0;
    this.isExecuting = true;

    try {
      // Step 1: Submit the prompt
      await this.processPrompt(prompt);
      
      // Step 2: Wait for and extract AI response  
      const { responseText, rawNodes, error } = await this.waitForResponseText();
      
      if (error) throw new Error(error);

      // Step 3: Notify background of completion
      await browser.runtime.sendMessage({
        type: 'prompt-completed',
        result: {
          index: index,
          prompt: prompt,
          timestamp: Date.now(),
          success: true,
          response: responseText,
          rawNodes: rawNodes
        }
      });

      this.log(`Prompt ${index + 1} completed successfully`);

    } catch (error) {
      this.logError('Failed to execute prompt:', error);
      await browser.runtime.sendMessage({
        type: 'prompt-failed',
        error: error.message,
        promptIndex: index
      });
    } finally {
      this.isExecuting = false;
    }
  }

  async processPrompt(prompt) {
    // Find and focus input element
    const inputElement = await this.waitForInputElement();
    if (!inputElement) throw new Error('Input element not found');

    // Clear and insert new text
    await this.insertText(inputElement, prompt);
    await this.sleep(500);

    // Find and click submit button
    const submitButton = await this.waitForSubmitButton();
    if (!submitButton) throw new Error('Submit button not found');

    await this.sleep(this.submitDelay);
    await this.clickSubmit(submitButton);
    this.log('Prompt submitted successfully');
  }

  async waitForInputElement(timeout = this.waitTimeout) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const input = this.findInputElement();
      if (input) {
        this.log('Input element found:', input.tagName, input.type || input.contentEditable);
        return input;
      }
      await this.sleep(200);
    }
    return null;
  }

  findInputElement() {
    for (const selector of this.selectors.textareas) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (this.isVisibleAndInteractive(element)) return element;
      }
    }

    for (const selector of this.selectors.contentEditable) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (this.isVisibleAndInteractive(element)) return element;
      }
    }

    for (const selector of this.selectors.textInputs) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (this.isVisibleAndInteractive(element)) return element;
      }
    }

    return null;
  }

  async waitForSubmitButton(timeout = this.waitTimeout) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const button = this.findSubmitButton();
      if (button) {
        this.log('Submit button found:', button.tagName, button.textContent?.trim());
        return button;
      }
      await this.sleep(200);
    }
    return null;
  }

  findSubmitButton() {
    for (const selector of this.selectors.submitButtons) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (this.isVisibleAndInteractive(element) && this.isLikelySubmitButton(element)) {
            return element;
          }
        }
      } catch (error) { continue; }
    }

    const buttons = document.querySelectorAll('button');
    for (const button of buttons) {
      if (this.isVisibleAndInteractive(button) && this.isLikelySubmitButton(button)) {
        return button;
      }
    }

    return null;
  }

  isLikelySubmitButton(element) {
    const text = element.textContent?.toLowerCase() || '';
    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
    const title = element.getAttribute('title')?.toLowerCase() || '';
    const submitKeywords = ['send', 'submit', 'search', 'ask', 'go'];
    
    const hasSubmitText = submitKeywords.some(keyword =>
      text.includes(keyword) || ariaLabel.includes(keyword) || title.includes(keyword)
    );
    
    const hasSvg = element.querySelector('svg') !== null;
    const hasArrowIcon = element.innerHTML.includes('arrow') || element.innerHTML.includes('→');
    const isFormSubmit = element.type === 'submit';
    
    return hasSubmitText || hasSvg || hasArrowIcon || isFormSubmit;
  }

  async insertText(element, text) {
    try {
      element.focus();
      await this.sleep(100);
      this.replaceValue(element, text);
      this.log('Text inserted successfully');
    } catch (error) {
      this.logError('Failed to insert text:', error);
      throw new Error('Text insertion failed: ' + error.message);
    }
  }

  replaceValue(element, value) {
    if (!element) return null;
    
    try {
      element.focus();
      
      // Select all existing content
      document.execCommand('selectAll');
      
      // Try modern insertText first, fallback to direct assignment
      if (!document.execCommand('insertText', false, value)) {
        if (element.tagName.toLowerCase() === 'textarea' || element.tagName.toLowerCase() === 'input') {
          element.value = value;
        } else if (element.contentEditable === 'true') {
          element.textContent = value;
        }
      }

      // Trigger events to notify React/frameworks
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      
    } catch (error) {
      this.logError('Error in replaceValue:', error);
      throw error;
    }

    return element;
  }

  async clickSubmit(button) {
    try {
      if (!this.isVisibleAndInteractive(button)) {
        throw new Error('Submit button is not clickable');
      }

      button.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.sleep(200);

      // Dispatch comprehensive mouse event sequence
      const rect = button.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;

      // Focus the button first
      button.focus();

      // Create and dispatch mouse events in proper sequence
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        const event = new MouseEvent(type, {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button: 0
        });
        button.dispatchEvent(event);
      });

      this.log('Submit button clicked via MouseEvent sequence');
      
    } catch (error) {
      this.logError('Failed to click submit button:', error);
      throw new Error('Submit click failed: ' + error.message);
    }
  }

  isVisibleAndInteractive(element) {
    if (!element) return false;
    
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    
    const isVisible = style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0;
    
    const isInteractive = !element.disabled && !element.readOnly;
    
    return isVisible && isInteractive;
  }

  findElements() {
    return {
      inputs: this.selectors.textareas.concat(this.selectors.contentEditable, this.selectors.textInputs)
        .map(selector => ({
          selector,
          found: document.querySelectorAll(selector).length,
          visible: Array.from(document.querySelectorAll(selector))
            .filter(el => this.isVisibleAndInteractive(el)).length
        })),
      buttons: this.selectors.submitButtons.map(selector => ({
        selector,
        found: document.querySelectorAll(selector).length,
        visible: Array.from(document.querySelectorAll(selector))
          .filter(el => this.isVisibleAndInteractive(el)).length
      }))
    };
  }

  stopAutomation() {
    this.log('Stopping automation');
    this.currentPrompt = null;
    this.retryCount = 0;
    this.isExecuting = false;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /* --------------- AI RESPONSE EXTRACTION CODE --------------- */

  async waitForResponseText(timeout = this.responseTimeout) {
    this.log('Waiting for AI response...');
    return new Promise(async (resolve) => {
      let resolved = false;
      let timeoutId;

      // Store initial response nodes to detect new ones
      const initialNodes = new Set(document.querySelectorAll(this.selectors.responseContainers.join(', ')));

      const getLatestResponseNode = () => {
        // Look for response nodes that appeared after submission
        for (const selector of this.selectors.responseContainers) {
          const nodes = Array.from(document.querySelectorAll(selector));
          
          // Find newest node (not in initial set)
          for (let i = nodes.length - 1; i >= 0; i--) {
            const node = nodes[i];
            if (!initialNodes.has(node) && this.isVisibleAndInteractive(node)) {
              return node;
            }
          }
          
          // Fallback to last visible node
          if (nodes.length > 0) {
            for (let i = nodes.length - 1; i >= 0; i--) {
              if (this.isVisibleAndInteractive(nodes[i])) {
                return nodes[i];
              }
            }
          }
        }
        return null;
      };

      const tryExtractResponse = () => {
        let responseNode = getLatestResponseNode();
        if (!responseNode) return null;

        // Check if still loading
        const loadingSpinner = responseNode.querySelector(
          '[role="progressbar"], [aria-busy="true"], .Loader, svg[aria-label="Loading"], [data-testid*="spinner"], [data-testid*="loading"]'
        );
        
        if (loadingSpinner) {
          this.log('Response still loading...');
          return null;
        }

        // Extract response text
        const raw = this.extractRawResponse(responseNode);
        const text = this.extractCleanedResponseText(raw);
        
        if (text && text.length > 10) { // Minimum meaningful response length
          this.log('Response extracted successfully:', text.substring(0, 100) + '...');
          return { text, raw, responseNode };
        }

        return null;
      };

      // Set up MutationObserver to watch for changes
      const observer = new MutationObserver((mutationsList) => {
        if (resolved) return;
        
        // Check if any mutations indicate new content
        let hasContentChange = false;
        for (const mutation of mutationsList) {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            hasContentChange = true;
            break;
          }
          if (mutation.type === 'characterData') {
            hasContentChange = true;
            break;
          }
        }

        if (hasContentChange) {
          const result = tryExtractResponse();
          if (result) {
            resolved = true;
            observer.disconnect();
            clearTimeout(timeoutId);
            resolve({
              responseText: result.text,
              rawNodes: result.raw,
              error: null
            });
          }
        }
      });

      // Observe the main content area
      const targetNode = document.querySelector('main') || document.body;
      observer.observe(targetNode, { 
        childList: true, 
        subtree: true, 
        characterData: true 
      });

      // Also use polling as backup
      let pollTries = 0;
      const pollInterval = 1000; // Check every second
      
      const poll = async () => {
        if (resolved) return;
        
        pollTries++;
        const result = tryExtractResponse();
        
        if (result) {
          resolved = true;
          observer.disconnect();
          clearTimeout(timeoutId);
          resolve({
            responseText: result.text,
            rawNodes: result.raw,
            error: null
          });
          return;
        }

        if (pollTries * pollInterval >= timeout) {
          resolved = true;
          observer.disconnect();
          resolve({
            responseText: "",
            rawNodes: "",
            error: "AI response timeout after " + (timeout / 1000) + "s"
          });
        } else {
          setTimeout(poll, pollInterval);
        }
      };

      // Start polling
      setTimeout(poll, 2000); // Wait 2 seconds before first poll

      // Set overall timeout
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          resolve({
            responseText: '',
            rawNodes: '',
            error: 'AI response timeout after ' + (timeout / 1000) + 's'
          });
        }
      }, timeout);
    });
  }

  extractRawResponse(responseNode) {
    return responseNode?.cloneNode(true) || null;
  }

  extractCleanedResponseText(rawNode) {
    if (!rawNode) return '';

    let parts = [];
    
    const traverse = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text) parts.push(text);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // Handle code blocks
        if (node.tagName === 'PRE') {
          parts.push('\n```\n' + node.textContent + '\n```\n');
          return;
        }
        
        if (node.tagName === 'CODE' && !node.closest('pre')) {
          parts.push('`' + node.textContent.trim() + '`');
          return;
        }

        // Handle lists
        if (node.tagName === 'UL' || node.tagName === 'OL') {
          const isOrdered = node.tagName === 'OL';
          const items = Array.from(node.children)
            .filter(child => child.tagName === 'LI')
            .map((li, idx) => {
              const prefix = isOrdered ? `${idx + 1}. ` : '- ';
              return prefix + (li.innerText || li.textContent).trim();
            });
          
          if (items.length > 0) {
            parts.push('\n' + items.join('\n') + '\n');
          }
          return;
        }

        // Handle paragraphs and line breaks
        if (['P', 'DIV', 'BR'].includes(node.tagName)) {
          // Add spacing for block elements
          if (parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
            parts.push('\n');
          }
        }

        // Recurse through children
        for (let child of node.childNodes) {
          traverse(child);
        }
      }
    };

    traverse(rawNode);

    // Clean up and join parts
    let result = parts
      .filter(Boolean)
      .join(' ')
      .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
      .replace(/[ \t]+/g, ' ') // Normalize spaces
      .trim();

    return result;
  }

  log(message, ...args) {
    console.log(`[Perplexity Automator Content] ${message}`, ...args);
  }

  logError(message, error) {
    console.error(`[Perplexity Automator Content ERROR] ${message}`, error);
  }
}

/* --------- Initialization & SPA Navigation Hijack --------- */

let automator = null;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAutomator);
} else {
  initializeAutomator();
}

function initializeAutomator() {
  if (!automator) {
    automator = new PerplexityAutomator();
  }

  // Handle SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      console.log('[Perplexity Automator] Page navigation detected, reinitializing...');
      setTimeout(() => {
        automator = new PerplexityAutomator();
      }, 1000);
    }
  }).observe(document, { subtree: true, childList: true });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PerplexityAutomator;
}