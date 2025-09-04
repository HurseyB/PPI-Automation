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

    // NEW: Overlay management
    this.overlay = null;
    this.overlayVisible = true; // Track if user has closed overlay
    this.currentStatus = null; // Track current status to detect changes

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

    this.initializeOverlayStyles();
    this.setupMessageListener();
    this.waitForPageReady();
  }

  // NEW: Initialize overlay CSS styles
  initializeOverlayStyles() {
      if (document.getElementById('perplexity-automator-overlay-styles')) return;

      const style = document.createElement('style');
      style.id = 'perplexity-automator-overlay-styles';
      style.textContent = `
          .perplexity-automator-overlay {
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 10000;
            padding: 8px 12px;
            border-radius: 6px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 12px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            animation: slideInFromRight 0.3s ease-out;
            min-width: 120px;
            max-width: 200px;
          }

          .perplexity-automator-overlay.status-progress {
            background-color: #fbbf24; /* Yellow */
            color: #000000; /* Black */
          }

          .perplexity-automator-overlay.status-paused {
              background-color: #dc2626; /* Red */
              color: #ffffff; /* White */
          }

          .perplexity-automator-overlay.status-complete {
              background-color: #059669; /* Forest Green */
              color: #ffffff; /* White */
          }

          .perplexity-automator-overlay-close {
              background: none;
              border: none;
              color: inherit;
              cursor: pointer;
              font-size: 14px;
              font-weight: bold;
              padding: 0;
              margin-left: 4px;
              width: 16px;
              height: 16px;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 2px;
              opacity: 0.7;
              transition: opacity 0.2s;
          }

          .perplexity-automator-overlay-close:hover {
              opacity: 1;
          }

          @keyframes slideInFromRight {
              from {
                  transform: translateX(100%);
                  opacity: 0;
              }
              to {
                  transform: translateX(0);
                  opacity: 1;
              }
          }

          @keyframes slideOutToRight {
              from {
                  transform: translateX(0);
                  opacity: 1;
              }
              to {
                  transform: translateX(100%);
                  opacity: 0;
              }
          }
      `;
      document.head.appendChild(style);
  }

  // NEW: Create and show status overlay
  showStatusOverlay(status, message) {
      // Only show if status changed or overlay was previously closed by user
      const statusChanged = this.currentStatus !== status;

      if (statusChanged) {
          this.overlayVisible = true; // Re-show overlay on status change
          this.currentStatus = status;
      }

      if (!this.overlayVisible) return;

      // Remove existing overlay
      this.hideStatusOverlay();

      // Create new overlay
      this.overlay = document.createElement('div');
      this.overlay.className = `perplexity-automator-overlay status-${status}`;

      // Add message text
      const messageSpan = document.createElement('span');
      messageSpan.textContent = message;
      this.overlay.appendChild(messageSpan);

      // Add close button
      const closeBtn = document.createElement('button');
      closeBtn.className = 'perplexity-automator-overlay-close';
      closeBtn.innerHTML = '×';
      closeBtn.title = 'Close';
      closeBtn.addEventListener('click', () => this.closeStatusOverlay());
      this.overlay.appendChild(closeBtn);

      // Add to page
      document.body.appendChild(this.overlay);

      console.log('Status overlay shown:', status, message);
  }

  // NEW: Close overlay (user initiated)
  closeStatusOverlay() {
      this.overlayVisible = false;
      this.hideStatusOverlay();
  }

  // NEW: Hide overlay (programmatic)
  hideStatusOverlay() {
      if (this.overlay && this.overlay.parentNode) {
          this.overlay.style.animation = 'slideOutToRight 0.3s ease-in';
          setTimeout(() => {
              if (this.overlay && this.overlay.parentNode) {
                  this.overlay.parentNode.removeChild(this.overlay);
              }
              this.overlay = null;
          }, 300);
      }
  }

  setupMessageListener() {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'execute-prompt':
          this.executePrompt(message.prompt, message.index);
          break;
        case 'stop-automation':
          this.isExecuting = false;
          break;
        case 'update-tab-title':
          this.updateTabTitle(message.companyName);
          break;
        case 'show-status-overlay':
          this.showStatusOverlay(message.status, message.message);
          break;
        case 'hide-status-overlay':
          this.hideStatusOverlay();
          break;
      }
      sendResponse({ success: true });
      return true;
    });
  }

  // Update tab title with company name
  updateTabTitle(companyName) {
      try {
          const title = companyName && companyName.trim()
              ? `${companyName.trim()} Analyses`
              : 'Perplexity AI';
          document.title = title;
          console.log('Tab title updated to:', title);
      } catch (error) {
          console.error('Failed to update tab title:', error);
      }
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
