/**
 * Perplexity AI Automator - Content Script
 * Fixed: Uses document.execCommand('insertText') for proper text insertion
 */

class PerplexityAutomator {
  constructor() {
    this.isReady = false;
    this.currentPrompt = null;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.submitDelay = 1500;
    this.waitTimeout = 10000;
    this.responseTimeout = 60000;
    this.isExecuting = false;
    this.hasCompletedCurrentPrompt = false;
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
    this.hasCompletedCurrentPrompt = false;

    const startTime = Date.now();

    try {
      // Step 1: Submit the prompt
      this.log(`Step 1: Submitting prompt ${index + 1}`);
      await this.processPrompt(prompt);

      // Step 2: Wait for AI response to be fully generated
      this.log(`Step 2: Waiting for AI response for prompt ${index + 1}`);
      const { responseText, error } = await this.waitForResponseText();

      if (error) {
        throw new Error(error);
      }

      this.log(`Step 3: Response received for prompt ${index + 1}, length: ${responseText.length}`);

      // Step 3: Mark as completed and notify background
      if (!this.hasCompletedCurrentPrompt) {
        this.hasCompletedCurrentPrompt = true;
        await browser.runtime.sendMessage({
          type: 'prompt-completed',
          result: {
            index: index,
            prompt: prompt,
            timestamp: Date.now(),
            success: true,
            response: responseText,
            startTime: startTime
          }
        });
        this.log(`Prompt ${index + 1} completed successfully with response`);
      }

    } catch (error) {
      this.logError('Failed to execute prompt:', error);
      if (!this.hasCompletedCurrentPrompt) {
        this.hasCompletedCurrentPrompt = true;
        await browser.runtime.sendMessage({
          type: 'prompt-failed',
          error: error.message,
          promptIndex: index
        });
      }
    } finally {
      this.isExecuting = false;
    }
  }

  async processPrompt(prompt) {
    // Wait for any existing responses to finish loading first
    await this.waitForPageToSettle();

    // Find and focus input element
    const inputElement = await this.waitForInputElement();
    if (!inputElement) throw new Error('Input element not found');

    // Insert text using the working method for Perplexity
    await this.insertTextUsingExecCommand(inputElement, prompt);
    await this.sleep(1000);

    // Find and click submit button
    const submitButton = await this.waitForSubmitButton();
    if (!submitButton) throw new Error('Submit button not found');

    await this.sleep(this.submitDelay);
    await this.clickSubmit(submitButton);
    this.log('Prompt submitted successfully, now waiting for response...');
  }

  async waitForPageToSettle() {
    // Wait for any existing loading states to complete
    this.log('Waiting for page to settle...');
    let settleAttempts = 0;
    const maxSettleAttempts = 10;

    while (settleAttempts < maxSettleAttempts) {
      const loadingElements = document.querySelectorAll(
        '[role="progressbar"], [aria-busy="true"], .Loader, svg[aria-label="Loading"], [data-testid*="spinner"], [data-testid*="loading"]'
      );

      if (loadingElements.length === 0) {
        this.log('Page settled, no loading elements found');
        break;
      }

      this.log(`Found ${loadingElements.length} loading elements, waiting...`);
      await this.sleep(500);
      settleAttempts++;
    }

    // Additional wait to ensure UI is stable
    await this.sleep(1000);
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
    // Try textareas first (most common for Perplexity)
    for (const selector of this.selectors.textareas) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (this.isVisibleAndInteractive(element)) {
          this.log('Found textarea with selector:', selector);
          return element;
        }
      }
    }

    // Try content editable elements
    for (const selector of this.selectors.contentEditable) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (this.isVisibleAndInteractive(element)) {
          this.log('Found contentEditable with selector:', selector);
          return element;
        }
      }
    }

    // Try text inputs as fallback
    for (const selector of this.selectors.textInputs) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (this.isVisibleAndInteractive(element)) {
          this.log('Found text input with selector:', selector);
          return element;
        }
      }
    }

    // Fallback: try to find any textarea on the page
    const allTextareas = document.querySelectorAll('textarea');
    this.log(`Found ${allTextareas.length} total textareas on page`);
    for (const element of allTextareas) {
      if (this.isVisibleAndInteractive(element)) {
        this.log('Using fallback textarea:', element);
        return element;
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

  // FIXED: Using document.execCommand('insertText') - the working method for Perplexity
  async insertTextUsingExecCommand(element, text) {
    try {
      this.log('Inserting text using execCommand method:', text.substring(0, 50) + '...');
      
      // Focus the element first
      element.focus();
      await this.sleep(300);

      // Clear existing content by selecting all and deleting
      if (document.execCommand('selectAll')) {
        document.execCommand('delete');
      }
      
      await this.sleep(200);

      // Use insertText command - this is what works for Perplexity according to Reddit
      const success = document.execCommand('insertText', false, text);
      
      if (!success) {
        // Fallback to direct value assignment if execCommand fails
        this.log('execCommand failed, using fallback method');
        if (element.tagName.toLowerCase() === 'textarea' || element.tagName.toLowerCase() === 'input') {
          element.value = text;
        } else if (element.contentEditable === 'true') {
          element.textContent = text;
        }
      }

      // Dispatch events to notify React/frameworks
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      await this.sleep(300);
      this.log('Text inserted successfully using execCommand');

      // Verify text was inserted
      const currentValue = element.value || element.textContent || '';
      if (currentValue.includes(text.substring(0, 20))) {
        this.log('Text insertion verified');
      } else {
        this.logError('Text insertion verification failed');
      }

    } catch (error) {
      this.logError('Failed to insert text using execCommand:', error);
      throw new Error('Text insertion failed: ' + error.message);
    }
  }

  async clickSubmit(button) {
    try {
      if (!this.isVisibleAndInteractive(button)) {
        throw new Error('Submit button is not clickable');
      }

      button.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.sleep(500);

      // Focus the button first
      button.focus();
      await this.sleep(200);

      // Use simple click - most reliable method
      button.click();

      this.log('Submit button clicked successfully');
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
    this.hasCompletedCurrentPrompt = false;
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
      let lastResponseLength = 0;
      let stableCount = 0;
      const stableThreshold = 3;

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

          // Fallback to last visible node if no new nodes
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
        if (resolved) return null;

        let responseNode = getLatestResponseNode();
        if (!responseNode) {
          this.log('No response node found yet...');
          return null;
        }

        // Check if still loading
        const loadingSpinner = responseNode.querySelector(
          '[role="progressbar"], [aria-busy="true"], .Loader, svg[aria-label="Loading"], [data-testid*="spinner"], [data-testid*="loading"]'
        );

        if (loadingSpinner) {
          this.log('Response still loading (spinner found)...');
          return null;
        }

        // Extract response text
        const text = this.extractCleanedResponseText(responseNode);
        if (!text || text.length < 10) {
          this.log('Response text too short or empty:', text?.length || 0);
          return null;
        }

        // Check if response has stabilized (stopped growing)
        if (text.length === lastResponseLength) {
          stableCount++;
        } else {
          stableCount = 0;
          lastResponseLength = text.length;
        }

        // Only return response if it's stable for several checks
        if (stableCount >= stableThreshold) {
          this.log('Response extracted successfully:', text.substring(0, 100) + '...', 'Length:', text.length);
          return { text };
        } else {
          this.log(`Response still growing: ${text.length} chars (stable: ${stableCount}/${stableThreshold})`);
          return null;
        }
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
          if (result && !resolved) {
            resolved = true;
            observer.disconnect();
            clearTimeout(timeoutId);
            resolve({
              responseText: result.text,
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

      // Polling as backup
      let pollTries = 0;
      const pollInterval = 2000;
      const maxPolls = Math.floor(timeout / pollInterval);

      const poll = async () => {
        if (resolved) return;

        pollTries++;
        this.log(`Polling for response attempt ${pollTries}/${maxPolls}`);

        const result = tryExtractResponse();
        if (result && !resolved) {
          resolved = true;
          observer.disconnect();
          clearTimeout(timeoutId);
          resolve({
            responseText: result.text,
            error: null
          });
          return;
        }

        if (pollTries >= maxPolls) {
          if (!resolved) {
            resolved = true;
            observer.disconnect();
            resolve({
              responseText: "",
              error: "AI response timeout after " + (timeout / 1000) + "s"
            });
          }
        } else {
          setTimeout(poll, pollInterval);
        }
      };

      // Start polling after initial delay
      setTimeout(poll, 3000);

      // Set overall timeout
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          resolve({
            responseText: '',
            error: 'AI response timeout after ' + (timeout / 1000) + 's'
          });
        }
      }, timeout);
    });
  }

  extractCleanedResponseText(node) {
    if (!node) return '';

    let parts = [];
    const traverse = (currentNode) => {
      if (currentNode.nodeType === Node.TEXT_NODE) {
        const text = currentNode.textContent.trim();
        if (text) parts.push(text);
      } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
        // Handle code blocks
        if (currentNode.tagName === 'PRE') {
          parts.push('\n```\n' + currentNode.textContent + '\n```\n');
          return;
        }

        if (currentNode.tagName === 'CODE' && !currentNode.closest('pre')) {
          parts.push('`' + currentNode.textContent.trim() + '`');
          return;
        }

        // Handle lists
        if (currentNode.tagName === 'UL' || currentNode.tagName === 'OL') {
          const isOrdered = currentNode.tagName === 'OL';
          const items = Array.from(currentNode.children)
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
        if (['P', 'DIV', 'BR'].includes(currentNode.tagName)) {
          // Add spacing for block elements
          if (parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
            parts.push('\n');
          }
        }

        // Recurse through children
        for (let child of currentNode.childNodes) {
          traverse(child);
        }
      }
    };

    traverse(node);

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