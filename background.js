/**
 * Perplexity AI Automator - Background Script
 * Handles automation orchestration, message passing, and state management
 */

class AutomationManager {
    constructor() {
        this.isRunning = false;
        this.currentTabId = null;
        this.prompts = [];
        this.currentPromptIndex = 0;
        this.automationId = null;
        this.settings = {
            delay: 3000, // Default 3 second delay between prompts
            maxRetries: 3,
            timeout: 30000 // 30 second timeout per prompt
        };
        
        this.initializeBackground();
    }

    initializeBackground() {
        this.setupMessageListeners();
        this.setupTabListeners();
        this.loadSettings();
        this.log('Background script initialized');
    }

    setupMessageListeners() {
        // Listen for messages from popup and content script
        browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true; // Keep message channel open for async responses
        });
    }

    setupTabListeners() {
        // Monitor tab changes and updates
        browser.tabs.onActivated.addListener((activeInfo) => {
            this.handleTabActivated(activeInfo);
        });

        browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            this.handleTabUpdated(tabId, changeInfo, tab);
        });

        browser.tabs.onRemoved.addListener((tabId) => {
            this.handleTabRemoved(tabId);
        });
    }

    async loadSettings() {
        try {
            const result = await browser.storage.local.get(['settings']);
            if (result.settings) {
                this.settings = { ...this.settings, ...result.settings };
            }
            this.log('Settings loaded:', this.settings);
        } catch (error) {
            this.logError('Failed to load settings:', error);
        }
    }

    async saveSettings() {
        try {
            await browser.storage.local.set({ settings: this.settings });
            this.log('Settings saved');
        } catch (error) {
            this.logError('Failed to save settings:', error);
        }
    }

    async handleMessage(message, sender, sendResponse) {
        try {
            this.log('Received message:', message.type, message);

            switch (message.type) {
                case 'start-automation':
                    await this.startAutomation(message.prompts, message.tabId);
                    sendResponse({ success: true });
                    break;

                case 'stop-automation':
                    await this.stopAutomation();
                    sendResponse({ success: true });
                    break;

                case 'get-automation-status':
                    sendResponse({
                        isRunning: this.isRunning,
                        currentPromptIndex: this.currentPromptIndex,
                        totalPrompts: this.prompts.length
                    });
                    break;

                case 'content-script-ready':
                    await this.handleContentScriptReady(sender.tab.id);
                    sendResponse({ success: true });
                    break;

                case 'prompt-completed':
                    await this.handlePromptCompleted(message.result);
                    sendResponse({ success: true });
                    break;

                case 'prompt-failed':
                    await this.handlePromptFailed(message.error);
                    sendResponse({ success: true });
                    break;

                case 'update-settings':
                    await this.updateSettings(message.settings);
                    sendResponse({ success: true });
                    break;

                case 'check-perplexity-tab':
                    const isPerplexity = await this.checkPerplexityTab(message.tabId);
                    sendResponse({ isPerplexity });
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

    async startAutomation(prompts, tabId) {
        if (this.isRunning) {
            throw new Error('Automation is already running');
        }

        if (!prompts || prompts.length === 0) {
            throw new Error('No prompts provided');
        }

        // Validate tab
        const isValid = await this.validateTab(tabId);
        if (!isValid) {
            throw new Error('Invalid tab or not on Perplexity.ai');
        }

        this.isRunning = true;
        this.currentTabId = tabId;
        this.prompts = [...prompts];
        this.currentPromptIndex = 0;
        this.automationId = Date.now();

        this.log(`Starting automation with ${prompts.length} prompts on tab ${tabId}`);

        // Save automation state
        await this.saveAutomationState();

        // Notify popup of start
        await this.sendMessageToPopup('automation-started', {
            total: this.prompts.length,
            tabId: this.currentTabId
        });

        // Start processing prompts
        await this.processNextPrompt();
    }

    async stopAutomation() {
        if (!this.isRunning) {
            this.log('Automation is not running');
            return;
        }

        this.log('Stopping automation');
        this.isRunning = false;

        // Clear any pending timeouts
        if (this.currentTimeout) {
            clearTimeout(this.currentTimeout);
            this.currentTimeout = null;
        }

        // Notify content script to stop
        if (this.currentTabId) {
            try {
                await browser.tabs.sendMessage(this.currentTabId, {
                    type: 'stop-automation'
                });
            } catch (error) {
                this.logError('Failed to notify content script of stop:', error);
            }
        }

        // Clear automation state
        await this.clearAutomationState();

        // Notify popup
        await this.sendMessageToPopup('automation-stopped', {});
    }

    async processNextPrompt() {
        if (!this.isRunning || this.currentPromptIndex >= this.prompts.length) {
            await this.completeAutomation();
            return;
        }

        const currentPrompt = this.prompts[this.currentPromptIndex];
        this.log(`Processing prompt ${this.currentPromptIndex + 1}/${this.prompts.length}: ${currentPrompt.substring(0, 50)}...`);

        // Update progress
        await this.sendMessageToPopup('automation-progress', {
            current: this.currentPromptIndex + 1,
            total: this.prompts.length,
            prompt: currentPrompt
        });

        try {
            // Send prompt to content script
            await browser.tabs.sendMessage(this.currentTabId, {
                type: 'execute-prompt',
                prompt: currentPrompt,
                index: this.currentPromptIndex,
                timeout: this.settings.timeout
            });

            // Set timeout for prompt execution
            this.currentTimeout = setTimeout(() => {
                this.handlePromptTimeout();
            }, this.settings.timeout);

        } catch (error) {
            this.logError('Failed to send prompt to content script:', error);
            await this.handlePromptFailed(error.message);
        }
    }

    async handlePromptCompleted(result) {
        this.log(`Prompt ${this.currentPromptIndex + 1} completed successfully`);

        // Clear timeout
        if (this.currentTimeout) {
            clearTimeout(this.currentTimeout);
            this.currentTimeout = null;
        }

        // Save result if needed
        await this.savePromptResult(this.currentPromptIndex, result);

        // Move to next prompt after delay
        this.currentPromptIndex++;
        await this.saveAutomationState();

        // Wait before processing next prompt
        setTimeout(() => {
            if (this.isRunning) {
                this.processNextPrompt();
            }
        }, this.settings.delay);
    }

    async handlePromptFailed(error) {
        this.logError(`Prompt ${this.currentPromptIndex + 1} failed:`, error);

        // Clear timeout
        if (this.currentTimeout) {
            clearTimeout(this.currentTimeout);
            this.currentTimeout = null;
        }

        // Implement retry logic or skip to next prompt
        const shouldRetry = await this.shouldRetryPrompt();
        
        if (shouldRetry) {
            this.log(`Retrying prompt ${this.currentPromptIndex + 1}`);
            setTimeout(() => {
                if (this.isRunning) {
                    this.processNextPrompt();
                }
            }, this.settings.delay * 2); // Longer delay for retries
        } else {
            // Skip to next prompt
            this.currentPromptIndex++;
            await this.saveAutomationState();
            
            setTimeout(() => {
                if (this.isRunning) {
                    this.processNextPrompt();
                }
            }, this.settings.delay);
        }
    }

    async handlePromptTimeout() {
        this.logError(`Prompt ${this.currentPromptIndex + 1} timed out`);
        await this.handlePromptFailed('Timeout');
    }

    async completeAutomation() {
        this.log('Automation completed');
        this.isRunning = false;

        // Clear automation state
        await this.clearAutomationState();

        // Notify popup
        await this.sendMessageToPopup('automation-complete', {
            completed: this.currentPromptIndex,
            total: this.prompts.length
        });
    }

    async handleContentScriptReady(tabId) {
        this.log(`Content script ready on tab ${tabId}`);
        
        if (this.isRunning && this.currentTabId === tabId) {
            // Content script reloaded during automation, continue from current prompt
            await this.processNextPrompt();
        }
    }

    async handleTabActivated(activeInfo) {
        if (this.isRunning && activeInfo.tabId !== this.currentTabId) {
            this.log('User switched away from automation tab');
            // Could pause automation or show warning
        }
    }

    async handleTabUpdated(tabId, changeInfo, tab) {
        if (this.isRunning && tabId === this.currentTabId) {
            if (changeInfo.status === 'loading') {
                this.log('Automation tab is reloading');
            } else if (changeInfo.url && !changeInfo.url.includes('perplexity.ai')) {
                this.log('User navigated away from Perplexity.ai');
                await this.sendMessageToPopup('automation-error', {
                    error: 'User navigated away from Perplexity.ai'
                });
                await this.stopAutomation();
            }
        }
    }

    async handleTabRemoved(tabId) {
        if (this.isRunning && tabId === this.currentTabId) {
            this.log('Automation tab was closed');
            await this.sendMessageToPopup('automation-error', {
                error: 'Automation tab was closed'
            });
            await this.stopAutomation();
        }
    }

    async validateTab(tabId) {
        try {
            const tab = await browser.tabs.get(tabId);
            return tab && tab.url && tab.url.includes('perplexity.ai');
        } catch (error) {
            this.logError('Error validating tab:', error);
            return false;
        }
    }

    async checkPerplexityTab(tabId) {
        return await this.validateTab(tabId);
    }

    async shouldRetryPrompt() {
        // Simple retry logic - could be enhanced
        return false; // For now, don't retry failed prompts
    }

    async saveAutomationState() {
        try {
            const state = {
                isRunning: this.isRunning,
                currentTabId: this.currentTabId,
                prompts: this.prompts,
                currentPromptIndex: this.currentPromptIndex,
                automationId: this.automationId,
                timestamp: Date.now()
            };

            await browser.storage.local.set({ automationState: state });
            this.log('Automation state saved');
        } catch (error) {
            this.logError('Failed to save automation state:', error);
        }
    }

    async clearAutomationState() {
        try {
            await browser.storage.local.remove('automationState');
            this.log('Automation state cleared');
        } catch (error) {
            this.logError('Failed to clear automation state:', error);
        }
    }

    async savePromptResult(index, result) {
        try {
            const key = `promptResult_${this.automationId}_${index}`;
            await browser.storage.local.set({ [key]: result });
        } catch (error) {
            this.logError('Failed to save prompt result:', error);
        }
    }

    async updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        await this.saveSettings();
        this.log('Settings updated:', this.settings);
    }

    async sendMessageToPopup(type, data) {
        try {
            // Try to send to popup if it's open
            await browser.runtime.sendMessage({ type, data });
        } catch (error) {
            // Popup might not be open, which is fine
            this.log('Could not send message to popup (popup may be closed)');
        }
    }

    log(message, ...args) {
        console.log(`[Perplexity Automator Background] ${message}`, ...args);
    }

    logError(message, error) {
        console.error(`[Perplexity Automator Background ERROR] ${message}`, error);
    }
}

// Initialize the automation manager
const automationManager = new AutomationManager();

// Handle extension lifecycle
browser.runtime.onInstalled.addListener((details) => {
    console.log('Perplexity AI Automator installed/updated:', details.reason);
    
    if (details.reason === 'install') {
        // First time installation
        console.log('First time installation - setting up defaults');
    } else if (details.reason === 'update') {
        // Extension updated
        console.log('Extension updated from version:', details.previousVersion);
    }
});

browser.runtime.onStartup.addListener(() => {
    console.log('Browser started - Perplexity AI Automator background script loaded');
});

// Handle browser action click (if popup fails to load)
browser.browserAction.onClicked.addListener(async (tab) => {
    try {
        // This will only fire if popup fails to load
        console.log('Browser action clicked, opening popup manually');
        await browser.browserAction.openPopup();
    } catch (error) {
        console.error('Failed to open popup:', error);
    }
});

// Export for potential testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AutomationManager;
}