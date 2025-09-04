// content.js

/**
 * Perplexity AI Automator – Content Script
 * Restored full element-finding and insertion from content-working.js
 */

class PerplexityAutomator {
  constructor() {
    if (window.__perplexityAutomatorInitialized) return;
    window.__perplexityAutomatorInitialized = true;

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

    this.setupMessageListener();
    this.waitForPageReady();
  }

  setupMessageListener() {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'execute-prompt') {
        this.executePrompt(message.prompt, message.index);
      } else if (message.type === 'stop-automation') {
        this.isExecuting = false;
      }
      sendResponse({ success: true });
      return true;
    });
  }

  async waitForPageReady() {
    if (document.readyState !== 'complete') {
      await new Promise(r => window.addEventListener('load', r));
    }
    await this.sleep(2000);
    this.isReady = true;
    browser.runtime.sendMessage({ type: 'content-script-ready' });
  }

  async executePrompt(prompt, index) {
    if (!this.isReady || this.isExecuting) return;
    this.isExecuting = true;
    this.hasCompletedCurrentPrompt = false;
    const startTime = Date.now();

    try {
      await this.processPrompt(prompt);
      const { responseText, error } = await this.waitForResponseText(this.responseTimeout);
      if (error) throw new Error(error);

      await browser.runtime.sendMessage({
        type: 'prompt-completed',
        result: { index, prompt, timestamp: Date.now(), success: true, response: responseText, startTime }
      });
    } catch (err) {
      await browser.runtime.sendMessage({ type: 'prompt-failed', error: err.message, promptIndex: index });
    } finally {
      this.isExecuting = false;
    }
  }

  async processPrompt(prompt) {
    await this.waitForPageToSettle();
    const input = await this.waitForInputElement();
    if (!input) throw new Error('Input element not found');
    await this.insertTextUsingExecCommand(input, prompt);
    await this.sleep(1000);
    const btn = await this.waitForSubmitButton();
    if (!btn) throw new Error('Submit button not found');
    await this.sleep(this.submitDelay);
    await this.clickSubmit(btn);
  }

  async waitForPageToSettle() {
    let attempts = 0;
    while (attempts++ < 10) {
      const loading = document.querySelectorAll('[role="progressbar"], [aria-busy="true"], .Loader, svg[aria-label="Loading"], [data-testid*="spinner"], [data-testid*="loading"]');
      if (loading.length === 0) break;
      await this.sleep(500);
    }
    await this.sleep(1000);
  }

  async waitForInputElement(timeout = this.waitTimeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      for (let sel of this.selectors.textareas.concat(this.selectors.contentEditable, this.selectors.textInputs)) {
        const el = document.querySelector(sel);
        if (el && this.isVisible(el)) return el;
      }
      await this.sleep(200);
    }
    return null;
  }

  async waitForSubmitButton(timeout = this.waitTimeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      for (let sel of this.selectors.submitButtons) {
        const el = document.querySelector(sel);
        if (el && this.isVisible(el) && this.isLikelySubmitButton(el)) return el;
      }
      await this.sleep(200);
    }
    return null;
  }

  isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  isLikelySubmitButton(el) {
    const text = (el.textContent || '').toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const title = (el.title || '').toLowerCase();
    return ['send','submit','search','ask','go'].some(k => text.includes(k) || aria.includes(k) || title.includes(k)) || el.type === 'submit' || !!el.querySelector('svg');
  }

  async insertTextUsingExecCommand(el, text) {
    el.focus();
    await this.sleep(300);
    document.execCommand('selectAll');
    document.execCommand('delete');
    const ok = document.execCommand('insertText', false, text);
    if (!ok) {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') el.value = text;
      else el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await this.sleep(300);
  }

  async clickSubmit(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.sleep(200);
    el.click();
  }

  async waitForResponseText(timeout) {
    const start = Date.now();
    const initial = new Set(document.querySelectorAll(this.selectors.responseContainers.join(',')));
    return new Promise(resolve => {
      let stable = 0, lastLen = 0;
      const check = () => {
        const nodes = Array.from(document.querySelectorAll(this.selectors.responseContainers.join(',')));
        const node = nodes.reverse().find(n => !initial.has(n) && this.isVisible(n));
        if (node) {
          // CHANGED: Extract HTML content instead of plain text
              const htmlContent = this.extractHTMLContent(node);
              const textLength = node.innerText.trim().length;

              if (textLength === lastLen) {
                  if (++stable >= 3) {
                      return resolve({
                          responseText: htmlContent,  // Return HTML instead of plain text
                          startTime: start
                      });
                  }
              } else {
                  lastLen = textLength;
                  stable = 0;
              }
          }

          if (Date.now() - start > timeout) {
              return resolve({
                  responseText: '',
                  error: `AI response timeout after ${timeout/1000}s`
              });
          }
          setTimeout(check, 1000);
      };
      check();
    });
  }

  // NEW METHOD: Add this method to extract HTML content
  extractHTMLContent(node) {
      // Clone the node to avoid modifying the original
      const clonedNode = node.cloneNode(true);

      // Remove unwanted elements (buttons, navigation, etc.)
      const unwantedSelectors = [
          'button',
          'nav',
          '.navigation',
          '.btn',
          '[role="button"]',
          '.copy-button',
          '.share-button'
      ];

      unwantedSelectors.forEach(selector => {
          const elements = clonedNode.querySelectorAll(selector);
          elements.forEach(el => el.remove());
      });

      // Get the HTML content
      let htmlContent = clonedNode.innerHTML;

      // Clean up the HTML - remove unnecessary attributes but keep structure
      htmlContent = htmlContent
          .replace(/class="[^"]*"/g, '')          // Remove class attributes
          .replace(/id="[^"]*"/g, '')            // Remove id attributes
          .replace(/data-[^=]*="[^"]*"/g, '')    // Remove data attributes
          .replace(/style="[^"]*"/g, '')         // Remove inline styles
          .replace(/\s+>/g, '>')                 // Clean up spacing
          .replace(/>\s+</g, '><')               // Clean up spacing
          .trim();

      // If no meaningful HTML structure found, fall back to plain text
      if (!htmlContent.includes('<p') && !htmlContent.includes('<div') &&
          !htmlContent.includes('<h') && !htmlContent.includes('<ul') &&
          !htmlContent.includes('<ol')) {
          return node.innerText.trim();
      }

      return htmlContent;
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

new PerplexityAutomator();
