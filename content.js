/**
 * Perplexity AI Automator - Content Script
 * Runs on perplexity.ai pages to automate prompt input and submission and now extracts responses
 *
 * MODIFIED: Now includes robust AI response extraction, formatting, and communication to background
 */

class PerplexityAutomator {
    constructor() {
        this.isReady = false;
        this.currentPrompt = null;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.submitDelay = 1500;
        this.waitTimeout = 10000;
        this.responseTimeout = 30000; // Max 30s for AI response

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
                // Try typical Perplexity response containers, increasing specificity as needed
                'main .conversation-thread [data-message-author="ai"]',
                // Classic markdown body
                'main .markdown, .markdown-body, .prose, .conversation-message[data-author="ai"]',
                // Single message containers
                'div[data-message-author="ai"]',
                'div[data-author="ai"]',
                // Try chat window fallback
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
        this.log(`Executing prompt ${index + 1}: ${prompt.substring(0, 50)}...`);
        this.currentPrompt = prompt;
        this.retryCount = 0;

        try {
            await this.processPrompt(prompt);
            // Extract AI response and send to background
            const { responseText, rawNodes, error } = await this.waitForResponseText();
            if (error) throw new Error(error);

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
        } catch (error) {
            this.logError('Failed to execute prompt:', error);
            await browser.runtime.sendMessage({
                type: 'prompt-failed',
                error: error.message
            });
        }
    }

    async processPrompt(prompt) {
        const inputElement = await this.waitForInputElement();
        if (!inputElement) throw new Error('Input element not found');
        await this.insertText(inputElement, prompt);
        await this.sleep(500);
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
            document.execCommand('selectAll');
            if (!document.execCommand('insertText', false, value)) {
                if (element.tagName.toLowerCase() === 'textarea' || element.tagName.toLowerCase() === 'input') {
                    element.value = value;
                } else if (element.contentEditable === 'true') {
                    element.textContent = value;
                }
            }
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
            if (!this.isVisibleAndInteractive(button)) throw new Error('Submit button is not clickable');
            button.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await this.sleep(200);
            button.click();
            this.log('Submit button clicked');
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

            // Attempt to find the new/latest AI response node before and after the prompt is sent
            const getLatestResponseNode = () => {
                for (const selector of this.selectors.responseContainers) {
                    const nodes = Array.from(document.querySelectorAll(selector));
                    // Heuristic: last visible node is newest
                    if (nodes.length > 0) {
                        for (let i = nodes.length - 1; i >= 0; i--) {
                            if (this.isVisibleAndInteractive(nodes[i])) {
                                return nodes[i];
                            }
                        }
                        return nodes[nodes.length - 1];
                    }
                }
                return null;
            };
            let latestNode = getLatestResponseNode();
            let lastResponseNode = latestNode;

            // Handler for when a new AI response appears or is updated
            const tryExtractResponse = () => {
                let responseNode = getLatestResponseNode();
                if (!responseNode) return null;
                // Perplexity usually animates out responses, so look for loading spinners inside
                const loadingSpinner = responseNode.querySelector('[role="progressbar"], [aria-busy="true"], .Loader, svg[aria-label="Loading"], [data-testid*="spinner"]');
                if (loadingSpinner) return null; // Still loading

                // Heuristic: response is ready if present and not in animation state
                const raw = this.extractRawResponse(responseNode);
                const text = this.extractCleanedResponseText(raw);
                if (text && text.length > 0) {
                    return { text, raw, responseNode };
                }
                return null;
            };

            // MutationObserver setup
            const observer = new MutationObserver((mutationsList) => {
                if (resolved) return;
                for (const mutation of mutationsList) {
                    // Only check for childList or subtree changes
                    if (mutation.type === 'childList' || mutation.type === 'subtree' || mutation.type === 'characterData') {
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
                    }
                }
            });

            // Observe the main content node or body for changes
            const targetNode = document.querySelector('main') || document.body;
            observer.observe(targetNode, { childList: true, subtree: true, characterData: true });

            // Fallback polling (in case MutationObserver misses something)
            let pollTries = 0;
            const pollInterval = 500;
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
                    // Timed out
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
            poll();

            // Set timeout to avoid infinite waiting
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
        // Return the DOM node for possible future use
        return responseNode?.cloneNode(true) || null;
    }

    extractCleanedResponseText(rawNode) {
        if (!rawNode) return '';
        // Extract text and code blocks, including lists
        let parts = [];
        const traverse = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                parts.push(node.textContent.trim());
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // Code blocks
                if (node.tagName === 'PRE' && node.textContent) {
                    parts.push('\n``````\n');
                    return;
                }
                if (node.tagName === 'CODE' && node.textContent) {
                    // If part of a pre already, skip, else include inline
                    if (!node.closest('pre')) {
                        parts.push('`' + node.textContent.trim() + '`');
                        return;
                    }
                }
                // Lists
                if (node.tagName === 'UL' || node.tagName === 'OL') {
                    let isOrdered = node.tagName === 'OL';
                    let items = Array.from(node.children)
                        .filter(child => child.tagName === 'LI')
                        .map((li, idx) =>
                            (isOrdered ? (idx + 1) + '. ' : '- ') + (li.innerText || li.textContent).trim()
                        );
                    parts.push('\n' + items.join('\n') + '\n');
                    return;
                }
                // Other elements: recurse
                for (let child of node.childNodes) traverse(child);
            }
        };
        traverse(rawNode);
        let result = parts
            .map(t => t.replace(/\n{3,}/g, '\n\n')) // Remove excessive newlines
            .filter(Boolean)
            .join(' ')
            .replace(/[ \n]{2,}/g, '\n') // Compact newlines
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
    // Only initialize once
    if (!automator) {
        automator = new PerplexityAutomator();
    }
}
// SPA navigation detection
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PerplexityAutomator;
}
