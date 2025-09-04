// content.js

/**
 * Perplexity AI Automator – Content Script
 * Restored full element-finding and insertion from content-working.js
 */

class AdaptiveSelectorManager {
  constructor(strategies) {
    this.strategies = strategies;
  }

  async findElement(type, timeout = 10000) {
    const sels = this.strategies[type] || [];
    const end = Date.now() + timeout;

    while (Date.now() < end) {
      // First try predefined strategies
      for (const sel of sels) {
        let el;
        try {
          // Support jQuery-style :contains for text fallback
          if (sel.includes(':contains')) {
            const text = sel.match(/:contains\("(.+)"\)/)[1];
            el = Array.from(document.querySelectorAll(sel.split(':contains')[0]))
              .find(el => el.textContent.includes(text));
          } else {
            el = document.querySelector(sel);
          }
        } catch (e) {
          continue;
        }
        if (el && this.isVisible(el) && this.isUsableElement(el, type)) {
            return el;
          }
               }

        // If predefined strategies fail, try dynamic discovery
        const dynamicElement = await this.dynamicElementDiscovery(type);
        if (dynamicElement) {
          return dynamicElement;
        }

      await new Promise(r => setTimeout(r, 200));
    }
    return null;
  }

  async dynamicElementDiscovery(type) {
    switch (type) {
      case 'input':
        return this.findLargestInputElement();
      case 'submitButton':
        return this.findMostLikelySubmitButton();
      case 'responseContainer':
        return this.findLatestResponseContainer();
      default:
        return null;
    }
  }

  findLargestInputElement() {
    const inputs = Array.from(document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]'));
    return inputs
      .filter(el => this.isVisible(el) && !el.disabled && !el.readOnly)
      .sort((a, b) => {
        const aSize = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
        const bSize = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
        return bSize - aSize;
      })[0] || null;
  }

  findMostLikelySubmitButton() {
    // Enhanced button detection with scoring system
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));
    const scoredButtons = buttons
      .filter(el => this.isVisible(el) && !el.disabled)
      .map(button => ({
        element: button,
        score: this.calculateSubmitButtonScore(button)
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return scoredButtons.length > 0 ? scoredButtons[0].element : null;
  }

  calculateSubmitButtonScore(button) {
    let score = 0;
    const text = (button.textContent || '').toLowerCase().trim();
    const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
    const title = (button.title || '').toLowerCase();
    const className = (button.className || '').toLowerCase();
    const id = (button.id || '').toLowerCase();

    // High-value indicators
    const submitKeywords = ['send', 'submit', 'search', 'ask', 'go', 'enter'];
    const submitRegex = /\b(send|submit|search|ask|go|enter)\b/;

    // Text content scoring
    if (submitRegex.test(text)) score += 50;
    if (submitKeywords.some(keyword => text.includes(keyword))) score += 30;

    // Aria-label scoring (important for accessibility)
    if (submitRegex.test(ariaLabel)) score += 40;
    if (submitKeywords.some(keyword => ariaLabel.includes(keyword))) score += 25;

    // Title scoring
    if (submitRegex.test(title)) score += 30;
    if (submitKeywords.some(keyword => title.includes(keyword))) score += 20;

    // Class and ID scoring
    if (submitKeywords.some(keyword => className.includes(keyword))) score += 15;
    if (submitKeywords.some(keyword => id.includes(keyword))) score += 15;

    // Type and form context
    if (button.type === 'submit') score += 40;
    if (button.closest('form')) score += 20;

    // Visual indicators
    if (button.querySelector('svg')) score += 25; // Has icon

    // Position-based scoring (buttons on the right are often submit)
    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    if (rect.right > viewportWidth * 0.7) score += 10; // Right side of screen

    // Size-based scoring (very small buttons are unlikely to be submit)
    const area = rect.width * rect.height;
    if (area < 100) score -= 20; // Too small
    if (area > 500) score += 10; // Good size

    return score;
  }

  findLatestResponseContainer() {
    // Find containers that likely contain AI responses
    const potentialContainers = Array.from(document.querySelectorAll([
      '[data-message-author="ai"]',
      '[data-author="ai"]',
      '.conversation-thread [data-author]',
      '.markdown',
      '.prose',
      '[class*="message" i]',
      '[class*="response" i]',
      '[class*="answer" i]',
      'main div[class*="conversation" i]'
    ].join(',')));

    // Return the last visible container that contains substantial text
    return potentialContainers
      .filter(el => this.isVisible(el) && el.textContent.trim().length > 50)
      .pop() || null;
  }

     isVisible(el) {
       const rect = el.getBoundingClientRect();
       return rect.width > 0 && rect.height > 0;
     }

  isUsableElement(el, type) {
    switch (type) {
      case 'input':
        return !el.disabled && !el.readOnly;
      case 'submitButton':
        return !el.disabled && el.offsetParent !== null;
      default:
        return true;
    }
  }
}

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
    // NEW: Initialize adaptive selector manager for robust element discovery
    this.adaptiveSelector = new AdaptiveSelectorManager({
      input: [
        // Primary strategies for input elements
        'textarea',
        'textarea[placeholder*="Ask" i]',
        'textarea[placeholder*="search" i]',
        'textarea[placeholder*="question" i]',
        '[role="textbox"]',
        'input[type="text"]',
        'input[placeholder*="Ask" i]',
        'input[placeholder*="search" i]',
        '[contenteditable="true"]',
        '[data-testid*="search" i]',
        '[data-testid*="input" i]',
        '.search-box input',
        '.search-box textarea',
        '#search-input'
      ],
      submitButton: [
        // Enhanced strategies for submit buttons
        'button[type="submit"]',
        'button[aria-label*="send" i]',
        'button[aria-label*="submit" i]',
        'button[aria-label*="search" i]',
        'button[title*="send" i]',
        'button[title*="submit" i]',
        'button:contains("Send")',
        'button:contains("Submit")',
        'button:contains("Search")',
        'button:contains("Ask")',
        'button:contains("Go")',
        '[role="button"][aria-label*="send" i]',
        '[role="button"] svg[data-icon]',
        'form button:last-child',
        '.submit-button',
        '[data-testid*="submit" i]',
        '[data-testid*="send" i]'
      ],
      responseContainer: [
        // Enhanced strategies for AI response containers
        '[data-message-author="ai"]',
        '[data-author="ai"]',
        '.conversation-thread [data-author="ai"]',
        '.conversation-message[data-author="ai"]',
        'main .markdown',
        '.markdown-body',
        '.prose',
        'main div[class*="Message" i]',
        'main div[class*="message" i]',
        'div[data-testid*="ai-response" i]'
      ]
    });

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

  // Create and show status overlay (single‐instance)
  showStatusOverlay(status, message) {
    // Always clear any existing overlay elements
    document.querySelectorAll('.perplexity-automator-overlay')
      .forEach(el => el.remove());

    // Reset state for this new status
    this.overlayVisible = true;
    this.currentStatus = status;

    // Create and append new overlay
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
    // Remove all overlays and clear state
    document.querySelectorAll('.perplexity-automator-overlay')
      .forEach(el => el.remove());
    this.overlay = null;
    this.overlayVisible = false;
    this.currentStatus = null;
  }

  // Hide overlay programmatically
  hideStatusOverlay() {
    // Simply remove any existing overlay nodes
    document.querySelectorAll('.perplexity-automator-overlay').forEach(el => {
      el.style.animation = 'slideOutToRight 0.3s ease-in';
      setTimeout(() => el.remove(), 300);
    });

    // Reset internal references
    this.overlay = null;
    this.currentStatus = null;
    this.overlayVisible = true;
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
    // Use adaptive selector for robust discovery
    return await this.adaptiveSelector.findElement('input', timeout);
  }

  async waitForSubmitButton(timeout = this.waitTimeout) {
    // Use adaptive selector for robust discovery
    return await this.adaptiveSelector.findElement('submitButton', timeout);
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
    const initial = new Set(document.querySelectorAll(this.adaptiveSelector.strategies.responseContainer.join(',')));
    return new Promise(resolve => {
      let stable = 0, lastLen = 0;
      const check = () => {
        const nodes = Array.from(document.querySelectorAll(this.adaptiveSelector.strategies.responseContainer.join(',')));
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
