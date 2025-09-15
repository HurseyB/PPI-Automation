/**
 * Enhanced Perplexity AI Automator - Background Script
 * Fixed: Increased timeouts and proper sequencing
 */

class AutomationManager {
    constructor() {
        this.isRunning = false;
        this.isPaused = false;
        this.currentTabId = null;
        this.prompts = [];
        this.currentPromptIndex = 0;
        this.automationId = null;
        this.processedResults = [];
        this.retryAttempts = new Map();
        this.isProcessingPrompt = false;
        this.completedPrompts = new Set();
        this.settings = {
            delay: 5000, // Increased delay between prompts
            maxRetries: 3,
            timeout: 120000, // Increased to 2 minutes
            retryDelay: 10000, // Increased retry delay
            responseTimeout: 90000, // Increased response timeout
            enableRetries: true,
            pauseOnError: false
        };
        this.tabAutomations = new Map(); // tabId -> automation state
        this.tabDocumentManagers = new Map(); // tabId -> DocumentManager (CHANGED from BackgroundDocumentManager)
        this.tabCompanyNames = new Map(); // tabId -> company name
        this.tabTimeouts = new Map(); // tabId -> timeout reference
        this.initializeBackground();
    }

    getTabState(tabId) {
        return this.tabAutomations.get(tabId) || null;
    }

    updateTabState(tabId, updates) {
        const state = this.getTabState(tabId);
        if (state) {
            Object.assign(state, updates);
        }
    }

    hasRunningAutomation(tabId = null) {
        if (tabId) {
            const state = this.getTabState(tabId);
            return state && state.isRunning;
        }
        // Check if any tab has running automation
        return Array.from(this.tabAutomations.values()).some(state => state.isRunning);
    }

    initializeBackground() {
        this.setupMessageListeners();
        this.setupTabListeners();
        this.loadSettings();
        this.log('Enhanced background script initialized');
    }

    setupMessageListeners() {
        browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true;
        });
    }

    setupTabListeners() {
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
            this.log('Received message:', message.type);
            switch (message.type) {
                case 'start-automation':
                    await this.startAutomation(message.prompts, message.tabId);
                    // Show overlay when automation starts
                    await this.updateStatusOverlay(message.tabId, 'progress', 'In Progress');
                    sendResponse({ success: true });
                    break;
                case 'reset-automation':
                    // Stop all running automations or specific tab
                    await this.stopAutomation(message.tabId);
                    // Hide overlay when automation is reset
                    await this.hideStatusOverlay(message.tabId);
                    sendResponse({ success: true });
                    break;
                case 'pause-automation':
                    // Need to determine which tab to pause - use current active tab or pass tabId
                    const pauseTabId = message.tabId || this.currentTabId;
                    await this.pauseAutomation(pauseTabId);
                    sendResponse({ success: true });
                    break;
                case 'resume-automation':
                    // Need to determine which tab to resume
                    const resumeTabId = message.tabId || this.currentTabId;
                    await this.resumeAutomation(resumeTabId);
                    sendResponse({ success: true });
                    break;
                case 'get-automation-status':
                    // NEW: Get tab-specific status if tabId provided
                    const statusTabId = message.tabId || this.currentTabId;
                    const tabState = statusTabId ? this.getTabState(statusTabId) : null;

                    if (tabState) {
                        // Return tab-specific status
                        sendResponse({
                            isRunning: tabState.isRunning,
                            isPaused: tabState.isPaused,
                            currentPromptIndex: tabState.currentPromptIndex,
                            totalPrompts: tabState.prompts.length,
                            processedResults: tabState.processedResults.length,
                            automationId: tabState.automationId,
                            tabId: statusTabId
                        });
                    } else {
                        // Fallback to global status for backward compatibility
                        sendResponse({
                            isRunning: this.isRunning,
                            isPaused: this.isPaused,
                            currentPromptIndex: this.currentPromptIndex,
                            totalPrompts: this.prompts.length,
                            processedResults: this.processedResults.length,
                            automationId: this.automationId,
                            tabId: null
                        });
                    }
                    break;
                case 'get-results':
                    sendResponse({
                        results: this.processedResults,
                        automationId: this.automationId
                    });
                    break;
                case 'export-results':
                    await this.exportResults(message.format);
                    sendResponse({ success: true });
                    break;
                case 'content-script-ready':
                    await this.handleContentScriptReady(sender.tab.id);
                    // If automation already running on this tab, show overlay
                    const contentTabState = this.getTabState(sender.tab.id);
                    if (contentTabState && contentTabState.isRunning) {
                        const status = contentTabState.isPaused ? 'paused' : 'progress';
                        const text = contentTabState.isPaused ? 'Analysis Paused' : 'In Progress';
                        await this.updateStatusOverlay(sender.tab.id, status, text);
                    }
                    sendResponse({ success: true });
                    break;
                case 'prompt-completed':
                    // Pass the sender.tab.id so we know which tab this result is for
                    await this.handlePromptCompleted(message.result, sender.tab.id);
                    sendResponse({ success: true });
                    break;
                case 'prompt-failed':
                    // Pass the sender.tab.id here as well
                    await this.handlePromptFailed(message.error, message.promptIndex, sender.tab.id);
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
                case 'update-notification-settings':
                    await this.updateNotificationSettings(message.settings);
                    sendResponse({ success: true });
                    break;
                case 'show-notification':
                    await this.handleShowNotification(message.data);
                    sendResponse({ success: true });
                    break;
                case 'request-notification-permission':
                    const permissionGranted = await this.ensureNotificationPermission();
                    sendResponse({ success: permissionGranted });
                    break;
                case 'get-document-data':
                    // Use tab-specific document data if tabId provided
                    // NEW: Require tabId to be explicitly provided
                    const requestedTabId = message.tabId;
                    if (!requestedTabId) {
                        sendResponse({ error: 'tabId is required for get-document-data' });
                        break;
                    }
                    const documentData = await this.getTabDocumentData(requestedTabId);
                    sendResponse(documentData);
                    break;
                case 'clear-background-document':
                    const clearTabId = message.tabId || this.currentTabId;
                    const clearManager = this.getTabDocumentManager(clearTabId);
                    clearManager.clearDocument();
                    sendResponse({ success: true });
                    break;
                case 'set-tab-company-name':
                    await this.setTabCompanyName(message.tabId, message.companyName);
                    // Also update tab title when company name is set
                    await this.updateTabTitle(message.tabId, message.companyName);
                    sendResponse({ success: true });
                    break;
                case 'update-tab-title':
                    await this.updateTabTitle(message.tabId, message.companyName);
                    sendResponse({ success: true });
                    break;
                case 'get-tab-document-data':
                    const tabDocumentData = await this.getTabDocumentData(message.tabId);
                    sendResponse(tabDocumentData);
                    break;
                case 'clear-tab-document':
                    const manager = this.getTabDocumentManager(message.tabId);
                    manager.clearDocument();
                    sendResponse({ success: true });
                    break;
                // NEW: Handle download document request from popup
                case 'download-document':
                    const downloadTabId = message.tabId;
                    const downloadManager = this.getTabDocumentManager(downloadTabId);
                    if (message.companyName) {
                        downloadManager.companyName = message.companyName;
                        downloadManager.updateDocumentTitle();
                    }
                    await downloadManager.downloadDocx();
                    sendResponse({ success: true });
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

    // NEW: Update status overlay via content script
    async updateStatusOverlay(tabId, status, message) {
        try {
            await browser.tabs.sendMessage(tabId, {
                type: 'show-status-overlay',
                status: status,
                message: message
            });
            this.log(`Status overlay updated for tab ${tabId}: ${status} - ${message}`);
        } catch (error) {
            this.logError(`Failed to update status overlay for tab ${tabId}:`, error);
        }
    }

    // NEW: Hide status overlay via content script
    async hideStatusOverlay(tabId) {
        try {
            await browser.tabs.sendMessage(tabId, {
                type: 'hide-status-overlay'
            });
            this.log(`Status overlay hidden for tab ${tabId}`);
        } catch (error) {
            this.logError(`Failed to hide status overlay for tab ${tabId}:`, error);
        }
    }

    // NEW: Update tab title via content script
    async updateTabTitle(tabId, companyName) {
        try {
            await browser.tabs.sendMessage(tabId, {
                type: 'update-tab-title',
                companyName: companyName || ''
            });
            this.log(`Tab ${tabId} title updated for company: ${companyName || 'Default'}`);
        } catch (error) {
            this.logError(`Failed to update tab ${tabId} title:`, error);
        }
    }

    async startAutomation(prompts /* array of { text, pauseAfter } */, tabId, companyName = '') {
        // Check if this specific tab is already running
        if (this.tabAutomations.has(tabId) && this.tabAutomations.get(tabId).isRunning) {
            throw new Error(`Automation is already running on tab ${tabId}`);
        }

        if (!prompts || prompts.length === 0) {
            throw new Error('No prompts provided');
        }

        // Validate tab
        const isValid = await this.validateTab(tabId);
        if (!isValid) {
            throw new Error('Invalid tab or not on Perplexity.ai');
        }

        // Store company name for this tab
        await this.setTabCompanyName(tabId, companyName);

        // Initialize per-tab automation state
        const tabState = {
            isRunning: true,
            isPaused: false,
            prompts: prompts.map(p => ({ text: p.text, pauseAfter: !!p.pauseAfter })),
            currentPromptIndex: 0,
            automationId: Date.now(),
            processedResults: [],
            retryAttempts: new Map(),
            completedPrompts: new Set(),
            processingCompletions: new Set(), // ✅ Track actively processing completions
            isProcessingPrompt: false,
            currentTimeout: null
        };

        this.tabAutomations.set(tabId, tabState);

        // Update minimal global state for backward compatibility
        this.isRunning = this.hasRunningAutomation();
        this.currentTabId = tabId; // Track most recent tab for fallbacks only

        this.log(`Starting automation with ${prompts.length} prompts on tab ${tabId} for company: ${companyName || 'Company'}`);

        // Initialize per-tab document collection
        const documentManager = this.getTabDocumentManager(tabId);
        documentManager.initializeDocument(prompts.length);

        // Save automation state
        await this.saveAutomationState();

        // Notify popup of start
        await this.sendMessageToPopup('automation-started', {
            total: prompts.length,
            tabId: tabId,
            automationId: tabState.automationId
        });

        // Start processing prompts
        await this.processNextPrompt(tabId);

        // Show overlay status
        await this.updateStatusOverlay(tabId, 'progress', 'In Progress');
    }


    async stopAutomation(tabId = null) {
        // If no tabId specified, stop all running automations
        if (tabId === null) {
            const runningTabs = Array.from(this.tabAutomations.keys())
                .filter(id => this.tabAutomations.get(id).isRunning);

            if (runningTabs.length === 0) {
                this.log('No automation is running');
                return;
            }

            // Stop all running automations
            for (const runningTabId of runningTabs) {
                await this.stopAutomation(runningTabId);
            }
            return;
        }

        const tabState = this.getTabState(tabId);
        if (!tabState || !tabState.isRunning) {
            this.log(`Automation is not running on tab ${tabId}`);
            return;
        }

        this.log(`Stopping automation on tab ${tabId}`);

        // Update per-tab state
        this.updateTabState(tabId, {
            isRunning: false,
            isPaused: false,
            isProcessingPrompt: false
        });

        // ✅ CLEANUP - Clear processing completion tracker
        if (tabState.processingCompletions) {
            tabState.processingCompletions.clear();
        }


        // Update global state
        this.isRunning = this.hasRunningAutomation();

        // // Clear tab-specific timeout
        this.clearCurrentTimeout(tabId);

        // Notify content script to stop
        try {
            await browser.tabs.sendMessage(tabId, {
                type: 'stop-automation'
            });
        } catch (error) {
            this.logError('Failed to notify content script of stop:', error);
        }

        // Save final results
        await this.saveFinalResults(tabId);
        // // Clear tab-specific automation state only
        await this.clearAutomationState(tabId);

        // Notify popup
        await this.sendMessageToPopup('automation-stopped', {
            completed: tabState.processedResults.length,
            total: tabState.prompts.length,
            results: tabState.processedResults,
            tabId: tabId
        });
        // Hide overlay when automation is stopped
        await this.hideStatusOverlay(tabId);
    }

    async pauseAutomation(tabId) {
        // state.currentPromptIndex points to next prompt
        const tabState = this.getTabState(tabId);
        if (!tabState || !tabState.isRunning) {
            throw new Error(`Automation is not running on tab ${tabId}`);
        }

        this.updateTabState(tabId, { isPaused: true });
        this.clearTabTimeout(tabId);

        this.log(`Automation paused on tab ${tabId}`);
        await this.saveAutomationState();
        await this.sendMessageToPopup('automation-paused', {
            currentIndex: tabState.currentPromptIndex,
            total: tabState.prompts.length,
            tabId: tabId
        });
        // Update overlay status
        await this.updateStatusOverlay(tabId, 'paused', 'Analysis Paused');
    }

    async resumeAutomation(tabId) {
        const tabState = this.getTabState(tabId);
        if (!tabState || !tabState.isRunning || !tabState.isPaused) {
            throw new Error(`Automation is not paused on tab ${tabId}`);
        }

        this.updateTabState(tabId, { isPaused: false });
        this.log(`Automation resumed on tab ${tabId}`);
        await this.saveAutomationState();
        await this.sendMessageToPopup('automation-resumed', {
            currentIndex: tabState.currentPromptIndex,
            total: tabState.prompts.length,
            tabId: tabId
        });

        // Continue processing next prompt (index was already advanced)
        if (!tabState.isProcessingPrompt) {
            await this.processNextPrompt(tabId);
        }
        // Update overlay status
        await this.updateStatusOverlay(tabId, 'progress', 'In Progress');
    }

    async processNextPrompt(tabId) {
        const tabState = this.getTabState(tabId);
        if (!tabState) {
            this.log(`No tab state found for tab ${tabId}`);
            return;
        }

        // Check if we should stop or pause
        if (!tabState.isRunning) {
            this.log('Automation stopped, exiting processNextPrompt');
            return;
        }

        if (tabState.isPaused) {
            this.log('Automation paused, waiting for resume');
            return;
        }

        // Check if already processing a prompt
        if (tabState.isProcessingPrompt) {
            this.log('Already processing a prompt, skipping');
            return;
        }

        // Check if we've completed all prompts
        if (tabState.currentPromptIndex >= tabState.prompts.length) {
            await this.completeAutomation(tabId);
            return;
        }

        const currentPrompt = tabState.prompts[tabState.currentPromptIndex];
        const promptNumber = tabState.currentPromptIndex + 1;

        this.log(`Processing prompt ${promptNumber}/${tabState.prompts.length}: ${currentPrompt.text.substring(0, 50)}...`);
        this.updateTabState(tabId, { isProcessingPrompt: true });

        // Update progress - show current processing prompt number
        await this.sendMessageToPopup('automation-progress', {
            current: promptNumber,
            total: tabState.prompts.length,
            prompt: currentPrompt.text,
            status: 'processing'
        });

        try {
            // Validate tab is still valid
            const isValid = await this.validateTab(tabId);
            if (!isValid) {
                throw new Error('Tab is no longer valid or not on Perplexity.ai');
            }

            // Send prompt to content script with increased timeouts
            await browser.tabs.sendMessage(tabId, {
                type: 'execute-prompt',
                prompt: currentPrompt.text,
                index: tabState.currentPromptIndex,
                timeout: this.settings.timeout,
                responseTimeout: this.settings.responseTimeout,
                automationId: tabState.automationId
            });

            // Set tab-specific timeout for prompt execution
            this.setTabTimeout(tabId, () => {
                this.handlePromptTimeout(tabId);
            }, this.settings.timeout);


        } catch (error) {
            this.logError('Failed to send prompt to content script:', error);
            await this.handlePromptFailed(error.message, tabState.currentPromptIndex, tabId);
        }
    }

    // Now accept tabId directly from the content script sender
    async handlePromptCompleted(result, tabId) {
        const tabState = this.getTabState(tabId);
        if (!tabState) {
            this.logError(`No tab state found for tab ${tabId}`);
            return;
        }
        //if (!tabState) {
        //    this.logError(`No tab state found for tab ${targetTabId}`);
        //    return;
        //}
        const idx = result.index;
        const promptNumber = idx + 1;

        // ✅ ATOMIC CHECK AND LOCK MECHANISM
        // Initialize processing completion tracker if needed
        if (!tabState.processingCompletions) {
            tabState.processingCompletions = new Set();
        }

        // ✅ COMPREHENSIVE DUPLICATE DETECTION
        // Check all possible duplicate conditions atomically
        if (tabState.completedPrompts.has(idx) ||
            tabState.processingCompletions.has(idx) ||
            tabState.processedResults.some(r => r.index === idx)) {
            this.log(`Prompt ${promptNumber} completion already processed, ignoring duplicate`);
            return;
        }

        // ✅ IMMEDIATE LOCK - Mark as both completed and processing
        tabState.completedPrompts.add(idx);
        tabState.processingCompletions.add(idx);

        this.log(`Prompt ${promptNumber} completed successfully`);

        // Clear tab-specific timeout and processing flag
        this.clearTabTimeout(tabId);
        this.updateTabState(tabId, { isProcessingPrompt: false });
        try {
            // Process and store result using the idx
            const processedResult = {
                index: idx,
                promptNumber: promptNumber,
                prompt: tabState.prompts[idx],
                response: result.response || '',
                timestamp: result.timestamp || Date.now(),
                success: true,
                retryCount: tabState.retryAttempts.get(idx) || 0,
                processingTime: Date.now() - (result.startTime || Date.now()),
                automationId: tabState.automationId
            };

            tabState.processedResults.push(processedResult);

            // Save result
            await this.savePromptResult(tabId, idx, processedResult);

            // Update progress with completion count
            await this.sendMessageToPopup('automation-progress', {
                current: tabState.processedResults.length,
                total: tabState.prompts.length,
                prompt: tabState.prompts[idx].text,
                status: 'completed',
                response: result.response,
                hasResponse: !!result.response
            });

            // NEW: Add response to background document manager BEFORE pauseAfter check
            if (result.response && result.response.length > 0) {
                const documentManager = this.getTabDocumentManager(tabId);
                documentManager.addResponse(idx, tabState.prompts[idx], result.response);
                // Notify popup about document update (if popup is open)
                const docMgr = this.getTabDocumentManager(tabId);
                await this.sendMessageToPopup('document-updated', {
                    responseCount: docMgr.getResponseCount(),
                    status: 'collecting',
                    message: 'Collecting responses...'
                });
            }


            // Advance index
            this.updateTabState(tabId, {
                currentPromptIndex: tabState.currentPromptIndex + 1
            });
            tabState.retryAttempts.delete(idx);
            await this.saveAutomationState();

            // **Auto-pause after submission if flagged**
            if (tabState.prompts[idx].pauseAfter) {
                this.log(`Pausing after prompt ${idx + 1} as requested`);
                await this.pauseAutomation(tabId);
                return; // stop before processing next
            }

            // Wait before next prompt or complete
            if (tabState.currentPromptIndex < tabState.prompts.length) {
                this.setTabTimeout(tabId, () => {
                    if (tabState.isRunning && !tabState.isPaused) {
                        this.processNextPrompt(tabId);
                    }
                }, this.settings.delay);
            } else {
                await this.completeAutomation(tabId);
            }
        } catch (error) {
            this.logError(`Error processing completion for prompt ${promptNumber}:`, error);
            // Don't re-throw - we've already marked as completed to prevent retries
        } finally {
            // ✅ CLEANUP - Always remove from processing set
            if (tabState.processingCompletions) {
                tabState.processingCompletions.delete(idx);
            }
        }
    }

    async handlePromptFailed(error, promptIndex, tabId) {
        const tabState = this.getTabState(tabId);
        if (!tabState) {
            this.logError(`No tab state found for tab ${tabId}`);
            return;
        }

        // Use the correct prompt index - either passed or current for this tab
        const actualIndex = promptIndex !== undefined ? promptIndex : tabState.currentPromptIndex;
        const promptNumber = actualIndex + 1;

        // Check if we've already processed this failure to prevent duplicates
        if (tabState.completedPrompts.has(actualIndex) ||
            (tabState.processingCompletions && tabState.processingCompletions.has(actualIndex))) {
            this.log(`Prompt ${promptNumber} failure already processed, ignoring duplicate`);
            return;
        }

        this.logError(`Prompt ${promptNumber} failed:`, error);

        // Clear tab-specific timeout and processing flag
        this.clearTabTimeout(tabId);

        this.updateTabState(tabId, { isProcessingPrompt: false });

        // Get current retry count for this specific prompt
        const currentRetries = tabState.retryAttempts.get(actualIndex) || 0;
        const shouldRetry = this.settings.enableRetries &&
            currentRetries < this.settings.maxRetries &&
            this.isRetryableError(error);

        if (shouldRetry) {
            // Increment retry count for this prompt
            tabState.retryAttempts.set(actualIndex, currentRetries + 1);
            this.log(`Retrying prompt ${promptNumber} (attempt ${currentRetries + 1}/${this.settings.maxRetries})`);

            // Update progress with retry status
            await this.sendMessageToPopup('automation-progress', {
                current: promptNumber,
                total: tabState.prompts.length,
                prompt: tabState.prompts[actualIndex],
                status: 'retrying',
                retryCount: currentRetries + 1,
                maxRetries: this.settings.maxRetries,
                error: error
            });

            // Wait longer before retry (don't increment currentPromptIndex)
            this.setTabTimeout(tabId, () => {
                if (tabState.isRunning && !tabState.isPaused) {
                    this.processNextPrompt(tabId); // Retry same prompt
                }
            }, this.settings.retryDelay);

        } else {
            // Mark this prompt as completed (failed)
            tabState.completedPrompts.add(actualIndex);

            // Save failed result
            const failedResult = {
                index: actualIndex,
                promptNumber: promptNumber,
                prompt: tabState.prompts[actualIndex],
                response: '',
                timestamp: Date.now(),
                success: false,
                error: error,
                retryCount: currentRetries,
                automationId: tabState.automationId
            };

            tabState.processedResults.push(failedResult);
            await this.savePromptResult(tabId, actualIndex, failedResult);

            // Update progress with failure
            await this.sendMessageToPopup('automation-progress', {
                current: tabState.processedResults.length,
                total: tabState.prompts.length,
                prompt: tabState.prompts[actualIndex],
                status: 'failed',
                error: error,
                retryCount: currentRetries
            });

            if (this.settings.pauseOnError) {
                await this.pauseAutomation(tabId);
                await this.sendMessageToPopup('automation-error', {
                    error: `Prompt ${promptNumber} failed: ${error}`,
                    promptIndex: actualIndex,
                    paused: true
                });
            } else {
                // Skip to next prompt
                this.updateTabState(tabId, { currentPromptIndex: tabState.currentPromptIndex + 1 });
                tabState.retryAttempts.delete(actualIndex);
                await this.saveAutomationState();

                this.setTabTimeout(tabId, () => {
                    if (tabState.isRunning && !tabState.isPaused) {
                        this.processNextPrompt(tabId);
                    }
                }, this.settings.delay);
            }
        }
    }

    async handlePromptTimeout(tabId) {
        const tabState = this.getTabState(tabId);
        if (!tabState) {
            this.logError(`No tab state found for tab ${tabId} during timeout`);
            return;
        }
        this.logError(`Prompt ${tabState.currentPromptIndex + 1} timed out`);
        await this.handlePromptFailed('Timeout - prompt execution exceeded time limit', tabState.currentPromptIndex, tabId);
    }

    isRetryableError(error) {
        const retryableErrors = [
            'timeout',
            'network',
            'connection',
            'input element not found',
            'submit button not found',
            'rate limit',
            'temporary',
            'loading'
        ];
        const errorLower = error.toLowerCase();
        return retryableErrors.some(retryable => errorLower.includes(retryable));
    }

    async completeAutomation(tabId) {
        const tabState = this.getTabState(tabId);
        if (!tabState) {
            this.logError(`No tab state found for tab ${tabId} during completion`);
            return;
        }

        this.log('Automation completed');

        // Update per-tab state
        this.updateTabState(tabId, {
            isRunning: false,
            isPaused: false,
            isProcessingPrompt: false
        });

        // Update global state
        this.isRunning = this.hasRunningAutomation();

        // Save final results
        await this.saveFinalResults(tabId);

        // Generate summary
        const summary = this.generateAutomationSummary(tabId);

        // Finalize background document
        const documentManager = this.getTabDocumentManager(tabId);
        documentManager.finalizeDocument(summary);

        // Clear automation state
        await this.clearAutomationState();

        // Notify popup
        await this.sendMessageToPopup('automation-complete', {
            completed: tabState.processedResults.length,
            total: tabState.prompts.length,
            results: tabState.processedResults,
            summary: summary,
            automationId: tabState.automationId
        });

        // ✅ Schedule automatic cleanup of this automation's data after 5 minutes
        this.scheduleAutomationCleanup(tabId, tabState.automationId);
        await this.showCompletionNotification(summary);

        // Update overlay status
        await this.updateStatusOverlay(tabId, 'complete', 'Analyses Complete');
    }

    /**
     * Schedule cleanup of tab state and stored results after delay
     */
    scheduleAutomationCleanup(tabId, automationId, delayMs = 5 * 60 * 1000) {
        setTimeout(async () => {
            // Clear in-memory tab state
            this.cleanupTabState(tabId);

            // Remove storage keys for this automation
            try {
                // Remove automation summary
                await browser.storage.local.remove(`automation_${automationId}`);
                // Remove per-prompt results
                const allKeys = Object.keys(await browser.storage.local.get());
                const keysToRemove = allKeys.filter(key =>
                    key.startsWith(`promptResult_${automationId}_`)
                );
                if (keysToRemove.length) {
                    await browser.storage.local.remove(keysToRemove);
                }
                this.log(`Scheduled cleanup complete for automation ${automationId}`);
            } catch (err) {
                this.logError(`Error during scheduled cleanup for ${automationId}:`, err);
            }
        }, delayMs);
    }

    generateAutomationSummary(tabId) {
        const tabState = this.getTabState(tabId);
        if (!tabState) {
            return { total: 0, successful: 0, failed: 0, withResponses: 0, totalRetries: 0, successRate: 0, responseRate: 0, duration: 0 };
        }

        const total = tabState.prompts.length;
        const successful = tabState.processedResults.filter(r => r.success).length;
        const failed = tabState.processedResults.filter(r => !r.success).length;
        const withResponses = tabState.processedResults.filter(r => r.response && r.response.length > 0).length;
        const totalRetries = Array.from(tabState.retryAttempts.values()).reduce((sum, count) => sum + count, 0);

        return {
            total,
            successful,
            failed,
            withResponses,
            totalRetries,
            successRate: total > 0 ? (successful / total * 100).toFixed(1) : 0,
            responseRate: total > 0 ? (withResponses / total * 100).toFixed(1) : 0,
            duration: Date.now() - tabState.automationId
        };
    }

    async showCompletionNotification(summary) {
        try {
            // Check if user has enabled notifications
            const notificationSettings = await this.getNotificationSettings();
            if (!notificationSettings.enabled) {
                this.log('Notifications disabled by user');
                return;
            }

            // Request notification permission if needed
            const hasPermission = await this.ensureNotificationPermission();
            if (!hasPermission) {
                this.log('Notification permission not granted');
                return;
            }

            // Create enhanced notification
            const notificationId = await browser.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon-48.png',
                title: 'Perplexity AI Automator - Complete!',
                message: `✅ Processed ${summary.successful}/${summary.total} prompts successfully (${summary.successRate}% success rate)`,
                contextMessage: `${summary.withResponses} responses collected • Completed in ${this.formatDuration(summary.duration)}`,
                priority: 1
            });

            // Set up notification click handler
            this.setupNotificationClickHandler(notificationId);

            this.log('Completion notification shown:', notificationId);

        } catch (error) {
            this.logError('Failed to show completion notification:', error);
            // Fallback: try simple notification
            try {
                await browser.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon-48.png',
                    title: 'Automation Complete',
                    message: `Processed ${this.processedResults.length}/${this.prompts.length} prompts`
                });
            } catch (fallbackError) {
                this.logError('Fallback notification also failed:', fallbackError);
            }
        }
    }

    async getNotificationSettings() {
        try {
            const result = await browser.storage.local.get(['notificationSettings']);
            return result.notificationSettings || { enabled: true };
        } catch (error) {
            this.logError('Failed to get notification settings:', error);
            return { enabled: true }; // Default to enabled
        }
    }

    async ensureNotificationPermission() {
        try {
            // Extension notifications don't require user permission
            // They're granted automatically with the "notifications" permission in manifest.json
            if (typeof browser.notifications === 'undefined') {
                this.log('Notifications API not available');
                return false;
            }

            this.log('Extension notifications available');
            return true;
        } catch (error) {
            this.logError('Error checking notification availability:', error);
            return false;
        }
    }


    setupNotificationClickHandler(notificationId) {
        // Handle notification click to focus on extension
        const clickHandler = (clickedNotificationId) => {
            if (clickedNotificationId === notificationId) {
                this.handleNotificationClick();
                browser.notifications.onClicked.removeListener(clickHandler);
            }
        };

        browser.notifications.onClicked.addListener(clickHandler);

        // Auto-clear notification after 10 seconds
        setTimeout(() => {
            browser.notifications.clear(notificationId).catch(() => {});
        }, 10000);
    }

    async handleNotificationClick() {
        try {
            // Try to focus on the automation tab
            if (this.currentTabId) {
                await browser.tabs.update(this.currentTabId, { active: true });
                const window = await browser.tabs.get(this.currentTabId);
                await browser.windows.update(window.windowId, { focused: true });
            }
        } catch (error) {
            this.log('Could not focus automation tab on notification click');
        }
    }

    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    async saveFinalResults(tabId) {
        const tabState = this.getTabState(tabId);
        if (!tabState) {
            this.logError(`No tab state found for saving results on tab ${tabId}`);
            return;
        }

        try {
            const finalResults = {
                automationId: tabState.automationId,
                timestamp: Date.now(),
                prompts: tabState.prompts,
                results: tabState.processedResults,
                summary: this.generateAutomationSummary(tabId),
                settings: this.settings
            };

            await browser.storage.local.set({
                [`automation_${tabState.automationId}`]: finalResults,
                lastAutomation: finalResults
            });

            this.log('Final results saved');
        } catch (error) {
            this.logError('Failed to save final results:', error);
        }
    }

    async exportResults(format = 'json') {
        try {
            const results = {
                automationId: this.automationId,
                timestamp: new Date().toISOString(),
                results: this.processedResults,
                summary: this.generateAutomationSummary()
            };

            let content, filename, mimeType;

            switch (format.toLowerCase()) {
                case 'csv':
                    content = this.resultsToCSV(results);
                    filename = `perplexity_automation_${this.automationId}.csv`;
                    mimeType = 'text/csv';
                    break;
                case 'txt':
                    content = this.resultsToText(results);
                    filename = `perplexity_automation_${this.automationId}.txt`;
                    mimeType = 'text/plain';
                    break;
                default:
                    content = JSON.stringify(results, null, 2);
                    filename = `perplexity_automation_${this.automationId}.json`;
                    mimeType = 'application/json';
            }

            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);

            await browser.downloads.download({
                url: url,
                filename: filename,
                saveAs: true
            });

            this.log(`Results exported as ${format.toUpperCase()}`);
        } catch (error) {
            this.logError('Failed to export results:', error);
        }
    }

    resultsToCSV(data) {
        const headers = ['Index', 'Prompt', 'Response', 'Success', 'Error', 'Retry Count', 'Timestamp'];
        const rows = [headers.join(',')];

        data.results.forEach(result => {
            const row = [
                result.index,
                `"${result.prompt.replace(/"/g, '""')}"`,
                `"${(result.response || '').replace(/"/g, '""')}"`,
                result.success,
                `"${(result.error || '').replace(/"/g, '""')}"`,
                result.retryCount || 0,
                new Date(result.timestamp).toISOString()
            ];
            rows.push(row.join(','));
        });

        return rows.join('\n');
    }

    resultsToText(data) {
        let content = `Perplexity AI Automation Results\n`;
        content += `Generated: ${data.timestamp}\n`;
        content += `Automation ID: ${data.automationId}\n\n`;
        content += `Summary:\n`;
        content += `- Total Prompts: ${data.summary.total}\n`;
        content += `- Successful: ${data.summary.successful}\n`;
        content += `- Failed: ${data.summary.failed}\n`;
        content += `- Success Rate: ${data.summary.successRate}%\n\n`;
        content += `Results:\n`;
        content += `${'='.repeat(50)}\n\n`;

        data.results.forEach(result => {
            content += `Prompt ${result.promptNumber}:\n`;
            content += `${result.prompt}\n\n`;
            content += `Response:\n`;
            content += `${result.response || 'No response'}\n\n`;
            content += `Status: ${result.success ? 'Success' : 'Failed'}\n`;
            if (result.error) content += `Error: ${result.error}\n`;
            if (result.retryCount > 0) content += `Retries: ${result.retryCount}\n`;
            content += `Timestamp: ${new Date(result.timestamp).toISOString()}\n`;
            content += `${'-'.repeat(30)}\n\n`;
        });

        return content;
    }

    // Tab-specific timeout management
    setTabTimeout(tabId, callback, delay) {
        // Clear any existing timeout for this tab
        this.clearTabTimeout(tabId);

        // Set new timeout
        const timeoutId = setTimeout(callback, delay);
        this.tabTimeouts.set(tabId, timeoutId);

        return timeoutId;
    }

    clearTabTimeout(tabId) {
        const timeoutId = this.tabTimeouts.get(tabId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.tabTimeouts.delete(tabId);
        }
    }

    // Clear tab-specific automation state
    async clearTabAutomationState(tabId) {
        try {
            // Only clear state for this specific tab
            const tabState = this.getTabState(tabId);
            if (tabState) {
                await browser.storage.local.remove(`tabAutomationState_${tabId}`);
                this.log(`Tab ${tabId} automation state cleared`);
            }
        } catch (error) {
            this.logError(`Failed to clear tab ${tabId} automation state:`, error);
        }
    }

    async handleContentScriptReady(tabId) {
        this.log(`Content script ready on tab ${tabId}`);
        const tabState = this.getTabState(tabId);
        if (tabState && tabState.isRunning && !tabState.isPaused && !tabState.isProcessingPrompt) {
            await this.processNextPrompt(tabId);
        }
    }

    async handleTabActivated(activeInfo) {
        if (this.isRunning && activeInfo.tabId !== this.currentTabId) {
            this.log('User switched away from automation tab');
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
        // Clean up per-tab state
        this.cleanupTabState(tabId);

        if (this.isRunning && tabId === this.currentTabId) {
            this.log('Automation tab was closed');
            await this.sendMessageToPopup('automation-error', {
                error: 'Automation tab was closed'
            });
            await this.stopAutomation();
        }

        // Clean up overlay when tab is removed
        await this.hideStatusOverlay(tabId);
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

    async saveAutomationState() {
        try {
            const state = {
                isRunning: this.isRunning,
                isPaused: this.isPaused,
                currentTabId: this.currentTabId,
                prompts: this.prompts,
                currentPromptIndex: this.currentPromptIndex,
                automationId: this.automationId,
                processedResults: this.processedResults,
                retryAttempts: Array.from(this.retryAttempts.entries()),
                completedPrompts: Array.from(this.completedPrompts),
                isProcessingPrompt: this.isProcessingPrompt,
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

    async savePromptResult(tabId, index, result) {
        try {
            const tabState = this.getTabState(tabId);
            const automationId = tabState ? tabState.automationId : this.automationId;
            const key = `promptResult_${automationId}_${index}`;
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

    async updateNotificationSettings(settings) {
        try {
            await browser.storage.local.set({ notificationSettings: settings });
            this.log('Notification settings updated:', settings);
        } catch (error) {
            this.logError('Failed to update notification settings:', error);
        }
    }

    async handleShowNotification(data) {
        try {
            // Check if user has enabled notifications
            const notificationSettings = await this.getNotificationSettings();
            if (!notificationSettings.enabled) {
                this.log('Notifications disabled by user');
                return;
            }

            // Request notification permission if needed
            const hasPermission = await this.ensureNotificationPermission();
            if (!hasPermission) {
                this.log('Notification permission not granted');
                return;
            }

            // Create the notification
            const notificationId = await browser.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon-48.png',
                title: data.title || 'Perplexity AI Automator',
                message: data.message,
                priority: data.notificationType === 'error' ? 2 : 1
                // Firefox does not support requireInteraction
            });

            this.log('Notification shown:', notificationId);

            // Auto-clear notification after delay (except for errors)
            if (data.notificationType !== 'error') {
                setTimeout(() => {
                    browser.notifications.clear(notificationId).catch(() => {});
                }, 5000);
            }

        } catch (error) {
            this.logError('Failed to show notification:', error);
        }
    }


    async sendMessageToPopup(type, data) {
        try {
            await browser.runtime.sendMessage({ type, data });
        } catch (error) {
            this.log('Could not send message to popup (popup may be closed)');
        }
    }

    log(message, ...args) {
        console.log(`[Perplexity Automator Background] ${message}`, ...args);
    }

    logError(message, error) {
        console.error(`[Perplexity Automator Background ERROR] ${message}`, error);
    }

    // Per-tab company name management
    async setTabCompanyName(tabId, companyName) {
        this.tabCompanyNames.set(tabId, companyName || 'Company');
        this.log(`Company name set for tab ${tabId}: ${companyName || 'Company'}`);
    }

    // Get per-tab document manager
    getTabDocumentManager(tabId) {
        if (!this.tabDocumentManagers.has(tabId)) {
            const manager = new DocumentManager(); // CHANGED: from BackgroundDocumentManager to DocumentManager
            manager.tabId = tabId; // Track which tab this belongs to
            this.tabDocumentManagers.set(tabId, manager);
        }
        return this.tabDocumentManagers.get(tabId);
    }

    // Get per-tab document data
    async getTabDocumentData(tabId) {
        const manager = this.getTabDocumentManager(tabId);
        const data = manager.getDocumentData();
        // Include company name in response
        return {
            ...data,
            companyName: this.tabCompanyNames.get(tabId) || 'Company'
        };
    }

    // Clean up tab state when tab is removed
    cleanupTabState(tabId) {
        this.clearTabTimeout(tabId);
        this.tabAutomations.delete(tabId);
        this.tabDocumentManagers.delete(tabId);
        this.tabCompanyNames.delete(tabId);
        this.tabTimeouts.delete(tabId);
        this.log(`Cleaned up state for tab ${tabId}`);
    }
}

/**
 * MOVED: Complete DocumentManager class from popup.js to background.js
 * Enhanced Document Manager for Microsoft Word Layout
 * Formats DOCX with Times New Roman index, Aptos Display headings
 */
class DocumentManager {
    constructor() {
        this.companyName = 'Company';
        this.tabId = null; // Track which tab this belongs to
        this.document = {
            title: `Business Analyses for ${this.companyName}`,
            timestamp: null,
            responses: [],
            summary: null
        };
    }

    // NEW: Set the tab ID for this document manager
    setTabId(tabId) {
        this.tabId = tabId;
    }

    // NEW: Get tab-specific storage key
    getStorageKey() {
        return this.tabId ? `backgroundDocument_tab_${this.tabId}` : 'backgroundDocument';
    }

    async loadDocumentState() {
        try {
            const storageKey = this.getStorageKey();
            const result = await browser.storage.local.get([storageKey]);
            if (result[storageKey]) {
                this.document = result[storageKey];
                console.log('Background document state loaded:', this.getResponseCount(), 'responses');
            }
        } catch (error) {
            console.error('Failed to load background document state:', error);
        }
    }

    async saveDocumentState() {
        try {
            const storageKey = this.getStorageKey();
            await browser.storage.local.set({ [storageKey]: this.document });
        } catch (error) {
            console.error('Failed to save background document state:', error);
        }
    }

    initializeDocument(totalPrompts) {
        this.document = {
            title: 'Business Analyses for ' + this.companyName,
            timestamp: new Date().toISOString(),
            prompts: [],
            responses: [],
            summary: null,
            totalPrompts: totalPrompts,
            completedPrompts: 0
        };
        this.saveDocumentState();
    }

    addResponse(promptIndex, promptText, responseText) {
        const responseData = {
            index: promptIndex,
            prompt: promptText,
            response: responseText,
            timestamp: new Date().toISOString()
        };

        // Add or update response
        const existingIndex = this.document.responses.findIndex(r => r.index === promptIndex);
        if (existingIndex >= 0) {
            this.document.responses[existingIndex] = responseData;
        } else {
            this.document.responses.push(responseData);
        }

        // Sort responses by index
        this.document.responses.sort((a, b) => a.index - b.index);

        this.document.completedPrompts = this.document.responses.length;
        this.saveDocumentState();

        console.log(`Background document: Added response ${promptIndex + 1}, total: ${this.getResponseCount()}`);
    }

    getResponseCount() {
        return this.document.responses.length;
    }

    hasResponses() {
        return this.getResponseCount() > 0;
    }

    finalizeDocument(summary) {
        this.document.summary = summary;
        this.saveDocumentState();
    }

    clearDocument() {
        this.document = {
            title: 'Business Analyses for ' + this.companyName,
            timestamp: null,
            prompts: [],
            responses: [],
            summary: null,
            totalPrompts: 0,
            completedPrompts: 0
        };
        this.saveDocumentState();
    }

    // Export document data for popup
    getDocumentData() {
        return {
            document: this.document,
            responseCount: this.getResponseCount(),
            hasResponses: this.hasResponses()
        };
    }

    // MOVED: All document generation and download methods from popup.js
    updateDocumentTitle() {
        this.document.title = `Business Analyses for ${this.companyName}`;
        this.saveDocumentState();
    }

    /**
     * Load brand icon as base64 data URL
     * @returns {Promise} Base64 data URL of the icon
     */
    async loadBrandIcon() {
        try {
            const iconUrl = browser.runtime.getURL('icons/logo-icon.png');
            const response = await fetch(iconUrl);

            if (!response.ok) {
                throw new Error(`Failed to load icon: ${response.status}`);
            }

            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            console.warn('Failed to load brand icon:', error);
            return null; // Return null if icon fails to load
        }
    }

    /**
     * MOVED: Generate structured HTML document
     */
    async generateHTMLDocument() {
        const title = this.document.title;

        const iconDataUrl = await this.loadBrandIcon();
        // Explicitly build "dd Month yyyy" to ensure correct order
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = now.toLocaleString(undefined, { month: 'long' });
        const year = now.getFullYear();
        const timestamp = `${day} ${month} ${year}`;

        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>${title}</title>
                <style>
                    body {
                        font-family: 'Times New Roman', serif;
                        font-size: 12pt;
                        line-height: 1.5;
                        color: #000000;
                    }
                    .brand-icon {
                                    position: absolute;
                                    top: 0;
                                    left: 0;
                                    width: 60px;
                                    height: auto;
                                    z-index: 10;
                                }
                    .response-content {
                        font-family: 'Times New Roman', serif;
                        margin-bottom: 12pt;
                        line-height: 1.5;
                    }
                    p { font-family: 'Times New Roman', serif; font-size: 12pt; margin-bottom: 6pt; }
                    h1 { font-style: normal; font-weight: normal;  font-family: 'Aptos Display', serif; color: #0F4761; font-size: 20pt; margin-bottom: 6pt; }
                    h2 { font-style: normal; font-weight: normal; font-family: 'Aptos Display', serif; color: #0F4761; font-size: 16pt; margin-bottom: 6pt; }
                    h3 { font-style: normal; font-weight: normal; font-family: 'Times New Roman', serif; color: #0F4761; font-size: 14pt; margin-bottom: 6pt; }
                    ul, ol { margin-bottom: 12pt; }
                    li { margin-bottom: 3pt; }
                    strong, b { font-weight: bold; }
                    em, i { font-style: italic; }
                    code {
                        font-family: 'Courier New', monospace;
                        background-color: #f0f0f0;
                        padding: 2px 4px;
                    }
                    pre {
                        font-family: 'Courier New', monospace;
                        background-color: #f0f0f0;
                        padding: 12pt;
                        margin: 12pt 0;
                        white-space: pre-wrap;
                    }
                    blockquote {
                        margin-left: 24pt;
                        padding-left: 12pt;
                        border-left: 3pt solid #cccccc;
                        font-style: italic;
                    }
                </style>
            </head>
            <body>
                <div class="header-container">
                    ${iconDataUrl ? `<img src="${iconDataUrl}" alt="Brand Logo" class="brand-icon">` : ''}
                    </div>
                </div>
                <br style="font-size: 20pt;"></br>
                <br style="font-size: 20pt;"></br>
                <br style="font-size: 20pt;"></br>
                <br style="font-size: 20pt;"></br>
                <br style="font-size: 20pt;"></br>
                <br style="font-size: 20pt;"></br>
                <h1 style="color: #000000;font-family: 'Aptos';font-size: 20pt;height: 100vh;display: flex;flex-direction: column;justify-content: center;text-align: left; margin: 0;padding: 0;">${title}</h1>
                <p style="font-family: 'Aptos';font-size: 12pt;text-align: left; margin-bottom: 24pt;">${timestamp}</p>
            `;

            html += `
                <!-- First page break -->
                <br clear="all" style="page-break-before: always" />
                <!-- Second page break -->
                <br clear="all" style="page-break-before: always" />
            `;


            // Add main content with HTML formatting - HEADERS AND PAGE BREAKS REMOVED
                this.document.responses.forEach((response, index) => {
                    // Process the response text for HTML formatting
                    const processedResponse = this.processResponseText(response.responseText);
                    html += `<div class="response-content">${processedResponse}</div>`;
                    html += `<br clear="all" style="page-break-before: always"`;
                });

            html += `</body></html>`;
            return html;
    }

    /**
     * MOVED: Process response text to preserve HTML formatting
     */
    processResponseText(responseText) {
        if (!responseText) return '';

        // If the response already contains HTML tags, return as-is
        if (responseText.includes('<') && responseText.includes('>')) {
            return responseText;
        }

        // Convert plain text to HTML with basic formatting
        let processed = responseText
            // Escape any existing HTML entities first
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')

            // Convert markdown-style formatting to HTML
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
            .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italic
            .replace(/`(.*?)`/g, '<code>$1</code>') // Inline code

            // Convert line breaks to paragraphs
            .split('\n\n')
            .map(paragraph => paragraph.trim())
            .filter(paragraph => paragraph.length > 0)
            .map(paragraph => {
                // Handle lists
                if (paragraph.includes('\n- ') || paragraph.includes('\n• ')) {
                    const lines = paragraph.split('\n');
                    let listHtml = '';
                    let inList = false;

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('• ')) {
                            if (!inList) {
                                listHtml += '<ul>';
                                inList = true;
                            }
                            listHtml += `<li>${trimmedLine.substring(2)}</li>`;
                        } else if (trimmedLine.match(/^\d+\.\s/)) {
                            if (!inList) {
                                listHtml += '<ol>';
                                inList = true;
                            }
                            listHtml += `<li>${trimmedLine.replace(/^\d+\.\s/, '')}</li>`;
                        } else {
                            if (inList) {
                                listHtml += inList ? '</ul>' : '</ol>';
                                inList = false;
                            }
                            if (trimmedLine) {
                                listHtml += `<p>${trimmedLine}</p>`;
                            }
                        }
                    }

                    if (inList) {
                        listHtml += '</ul>';
                    }

                    return listHtml;
                }

                // Regular paragraph
                return `<p>${paragraph.replace(/\n/g, '<br>')}</p>`;
            })
            .join('');

        return processed;
    }

    async downloadDocx() {
        if (!this.hasResponses()) {
            console.warn('No responses to download');
            return;
        }

        try {
            // Check if html-docx library is available
            if (typeof htmlDocx === 'undefined') {
                console.warn('html-docx library not found, falling back to plain text');
                return this.downloadDocxPlainText();
            }

            // Build HTML document structure
            const htmlContent = await this.generateHTMLDocument();

            // Convert HTML to DOCX using html-docx library
            const docxBlob = htmlDocx.asBlob(htmlContent, {
                orientation: 'portrait',
                margins: {
                    top: 720, // 0.5 inch in twips (1440 twips = 1 inch)
                    right: 720,
                    bottom: 720,
                    left: 720
                }
            });

            // Use the companyName stored in this DocumentManager instance for filename prefix
            const safeName = (this.companyName || 'Company')
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
                .replace(/\s+/g, '-');

            // 2. Format date/time as MM.DD.YYYY-HH.MM.SS
            const now = new Date();
            const pad2 = n => String(n).padStart(2,'0');
            const datePart = `${pad2(now.getMonth()+1)}.${pad2(now.getDate())}.${now.getFullYear()}`;
            const timePart = `${pad2(now.getHours())}.${pad2(now.getMinutes())}.${pad2(now.getSeconds())}`;

            // 3. Build filename
            const filename = `${safeName}-${datePart}-${timePart}.docx`;

            const url = URL.createObjectURL(docxBlob);

            // Use downloads API for background script
            await browser.downloads.download({
                url: url,
                filename: filename,
                saveAs: true
            });

            console.log('HTML-formatted DOCX downloaded successfully:', filename);

        } catch (error) {
            console.error('Failed to generate HTML DOCX:', error);
            console.log('Falling back to plain text method');
            return this.downloadDocxPlainText();
        }
    }

    /**
     * MOVED: Generate and download DOCX with Microsoft Word formatting
     */
    async downloadDocxPlainText() {
        if (!this.hasResponses()) {
            console.warn('No responses to download');
            return;
        }

        try {
            // Import docx library (ensure it's loaded)
            if (typeof docx === 'undefined') {
                throw new Error('DOCX library not loaded. Please include docx.js in your extension.');
            }

            const { Document, Paragraph, TextRun, Packer, HeadingLevel, AlignmentType, UnderlineType } = docx;

            // Create document sections
            const sections = [];

            // Title Page
            sections.push(
                new Paragraph({
                    children: [
                        new TextRun({
                            text: this.document.title,
                            font: "Aptos",
                            size: 40, // 20pt = 40 half-points
                            bold: true
                        })
                    ],
                    heading: HeadingLevel.HEADING_1,
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 400 }
                })
            );

            // Timestamp
            if (this.document.timestamp) {
                sections.push(
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: `Generated: ${new Date(this.document.timestamp).toLocaleString()}`,
                                font: "Aptos",
                                size: 24, // 12pt
                                italics: true
                            })
                        ],
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 600 }
                    })
                );
            }

            // Table of Contents / Index
            sections.push(
                new Paragraph({
                    children: [
                        new TextRun({
                            text: "Index",
                            font: "Times New Roman",
                            size: 24, // 12pt
                            underline: {
                                type: UnderlineType.SINGLE
                            }
                        })
                    ],
                    spacing: { before: 400, after: 200 }
                })
            );

            // Index entries - Clean business document style
            this.document.responses.forEach((response, index) => {
                const pageNumber = index + 2; // Start from page 2 (after title page)
                sections.push(
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: `Question ${response.index + 1}`,
                                font: "Times New Roman",
                                size: 24 // 12pt
                            }),
                            new TextRun({
                                text: `${'.'.repeat(Math.max(1, 50 - `Question ${response.index + 1}`.length))} ${pageNumber}`,
                                font: "Times New Roman",
                                size: 24 // 12pt
                            })
                        ],
                        spacing: { after: 100 }
                    })
                );
            });

            // Page break before content
            sections.push(
                new Paragraph({
                    children: [new TextRun({ text: "", break: 1 })],
                    pageBreakBefore: true
                })
            );

            // Main Content
            this.document.responses.forEach((response, index) => {
                // H1 - Question/Prompt heading
                sections.push(
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: `Question ${response.index + 1}`,
                                font: "Aptos Display",
                                size: 40, // 20pt
                                bold: true
                            })
                        ],
                        heading: HeadingLevel.HEADING_1,
                        spacing: { before: 600, after: 200 }
                    })
                );

                // H2 - Response heading
                sections.push(
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: "Response",
                                font: "Aptos Display",
                                size: 32, // 16pt
                                bold: true
                            })
                        ],
                        heading: HeadingLevel.HEADING_2,
                        spacing: { before: 400, after: 200 }
                    })
                );

                // Response content - split into paragraphs
                const responseLines = response.response.split('\n\n');
                responseLines.forEach(line => {
                    if (line.trim()) {
                        sections.push(
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: line.trim(),
                                        font: "Times New Roman",
                                        size: 24 // 12pt for body text
                                    })
                                ],
                                spacing: { after: 200 }
                            })
                        );
                    }
                });

                // Add spacing between questions
                if (index < this.document.responses.length - 1) {
                    sections.push(
                        new Paragraph({
                            children: [new TextRun({ text: "" })],
                            spacing: { after: 400 }
                        })
                    );
                }
            });

            // Summary section if available
            if (this.document.summary) {
                sections.push(
                    new Paragraph({
                        children: [new TextRun({ text: "", break: 1 })],
                        pageBreakBefore: true
                    })
                );

                sections.push(
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: "Summary",
                                font: "Aptos Display",
                                size: 40, // 20pt
                                bold: true
                            })
                        ],
                        heading: HeadingLevel.HEADING_1,
                        spacing: { before: 400, after: 300 }
                    })
                );

                sections.push(
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: `Total Prompts: ${this.document.summary.total || this.document.responses.length}`,
                                font: "Aptos Display",
                                size: 24
                            })
                        ],
                        spacing: { after: 100 }
                    })
                );

                if (this.document.summary.successful !== undefined) {
                    sections.push(
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: `Successful: ${this.document.summary.successful}`,
                                    font: "Aptos Display",
                                    size: 24
                                })
                            ],
                            spacing: { after: 100 }
                        })
                    );
                }

                if (this.document.summary.successRate) {
                    sections.push(
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: `Success Rate: ${this.document.summary.successRate}%`,
                                    font: "Aptos Display",
                                    size: 24
                                })
                            ],
                            spacing: { after: 100 }
                        })
                    );
                }
            }

            // Create the document
            const doc = new Document({
                sections: [{
                    properties: {},
                    children: sections
                }]
            });

            // Generate and download using Blob (background-compatible)
            const blob = await Packer.toBlob(doc);
            const url = URL.createObjectURL(blob);

            // Use the companyName stored in this DocumentManager instance for filename prefix
            const safeName = (this.companyName || 'Company')
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
                .replace(/\s+/g, '-');

            // Format date/time as MM.DD.YYYY-HH.MM.SS
            const now = new Date();
            const pad2 = n => String(n).padStart(2,'0');
            const datePart = `${pad2(now.getMonth()+1)}.${pad2(now.getDate())}.${now.getFullYear()}`;
            const timePart = `${pad2(now.getHours())}.${pad2(now.getMinutes())}.${pad2(now.getSeconds())}`;

            const filename = `${safeName}-${datePart}-${timePart}.docx`;

            // Use downloads API for background script
            await browser.downloads.download({
                url: url,
                filename: filename,
                saveAs: true
            });

            console.log('DOCX downloaded successfully:', filename);

        } catch (error) {
            console.error('Failed to generate DOCX:', error);
            throw new Error('Failed to generate DOCX file: ' + error.message);
        }
    }
}

// Initialize the automation manager
const automationManager = new AutomationManager();

// Handle extension lifecycle
browser.runtime.onInstalled.addListener((details) => {
    console.log('Perplexity AI Automator installed/updated:', details.reason);
    if (details.reason === 'install') {
        console.log('First time installation - setting up defaults');
    } else if (details.reason === 'update') {
        console.log('Extension updated from version:', details.previousVersion);
    }
});

browser.runtime.onStartup.addListener(() => {
    console.log('Browser started - Perplexity AI Automator background script loaded');
});

browser.browserAction.onClicked.addListener(async (tab) => {
    try {
        console.log('Browser action clicked, opening popup manually');
        await browser.browserAction.openPopup();
    } catch (error) {
        console.error('Failed to open popup:', error);
    }
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AutomationManager;
}