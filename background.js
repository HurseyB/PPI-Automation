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
    this.currentTimeout = null;
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
    this.initializeBackground();
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
          sendResponse({ success: true });
          break;
        case 'stop-automation':
          await this.stopAutomation();
          sendResponse({ success: true });
          break;
        case 'pause-automation':
          await this.pauseAutomation();
          sendResponse({ success: true });
          break;
        case 'resume-automation':
          await this.resumeAutomation();
          sendResponse({ success: true });
          break;
        case 'get-automation-status':
          sendResponse({
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            currentPromptIndex: this.currentPromptIndex,
            totalPrompts: this.prompts.length,
            processedResults: this.processedResults.length,
            automationId: this.automationId
          });
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
          sendResponse({ success: true });
          break;
        case 'prompt-completed':
          await this.handlePromptCompleted(message.result);
          sendResponse({ success: true });
          break;
        case 'prompt-failed':
          await this.handlePromptFailed(message.error, message.promptIndex);
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

    // Initialize automation state
    this.isRunning = true;
    this.isPaused = false;
    this.currentTabId = tabId;
    this.prompts = [...prompts];
    this.currentPromptIndex = 0;
    this.automationId = Date.now();
    this.processedResults = [];
    this.retryAttempts.clear();
    this.completedPrompts.clear();
    this.isProcessingPrompt = false;

    this.log(`Starting automation with ${prompts.length} prompts on tab ${tabId}`);

    // Save automation state
    await this.saveAutomationState();

    // Notify popup of start
    await this.sendMessageToPopup('automation-started', {
      total: this.prompts.length,
      tabId: this.currentTabId,
      automationId: this.automationId
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
    this.isPaused = false;
    this.isProcessingPrompt = false;

    // Clear any pending timeouts
    this.clearCurrentTimeout();

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

    // Save final results
    await this.saveFinalResults();
    // Clear automation state
    await this.clearAutomationState();

    // Notify popup
    await this.sendMessageToPopup('automation-stopped', {
      completed: this.processedResults.length,
      total: this.prompts.length,
      results: this.processedResults
    });
  }

  async pauseAutomation() {
    if (!this.isRunning) {
      throw new Error('Automation is not running');
    }

    this.isPaused = true;
    this.clearCurrentTimeout();
    this.log('Automation paused');
    await this.saveAutomationState();
    await this.sendMessageToPopup('automation-paused', {
      currentIndex: this.currentPromptIndex,
      total: this.prompts.length
    });
  }

  async resumeAutomation() {
    if (!this.isRunning || !this.isPaused) {
      throw new Error('Automation is not paused');
    }

    this.isPaused = false;
    this.log('Automation resumed');
    await this.saveAutomationState();
    await this.sendMessageToPopup('automation-resumed', {
      currentIndex: this.currentPromptIndex,
      total: this.prompts.length
    });

    // Continue processing from current prompt if not already processing
    if (!this.isProcessingPrompt) {
      await this.processNextPrompt();
    }
  }

  async processNextPrompt() {
    // Check if we should stop or pause
    if (!this.isRunning) {
      this.log('Automation stopped, exiting processNextPrompt');
      return;
    }

    if (this.isPaused) {
      this.log('Automation paused, waiting for resume');
      return;
    }

    // Check if already processing a prompt
    if (this.isProcessingPrompt) {
      this.log('Already processing a prompt, skipping');
      return;
    }

    // Check if we've completed all prompts
    if (this.currentPromptIndex >= this.prompts.length) {
      await this.completeAutomation();
      return;
    }

    const currentPrompt = this.prompts[this.currentPromptIndex];
    const promptNumber = this.currentPromptIndex + 1;
    
    this.log(`Processing prompt ${promptNumber}/${this.prompts.length}: ${currentPrompt.substring(0, 50)}...`);
    this.isProcessingPrompt = true;

    // Update progress - show current processing prompt number
    await this.sendMessageToPopup('automation-progress', {
      current: promptNumber,
      total: this.prompts.length,
      prompt: currentPrompt,
      status: 'processing'
    });

    try {
      // Validate tab is still valid
      const isValid = await this.validateTab(this.currentTabId);
      if (!isValid) {
        throw new Error('Tab is no longer valid or not on Perplexity.ai');
      }

      // Send prompt to content script with increased timeouts
      await browser.tabs.sendMessage(this.currentTabId, {
        type: 'execute-prompt',
        prompt: currentPrompt,
        index: this.currentPromptIndex,
        timeout: this.settings.timeout,
        responseTimeout: this.settings.responseTimeout,
        automationId: this.automationId
      });

      // Set timeout for prompt execution (longer timeout)
      this.currentTimeout = setTimeout(() => {
        this.handlePromptTimeout();
      }, this.settings.timeout);

    } catch (error) {
      this.logError('Failed to send prompt to content script:', error);
      await this.handlePromptFailed(error.message, this.currentPromptIndex);
    }
  }

  async handlePromptCompleted(result) {
    const idx = result.index;
    const promptNumber = idx + 1;

    // Check if we've already processed this completion to prevent duplicates
    if (this.completedPrompts.has(idx)) {
      this.log(`Prompt ${promptNumber} completion already processed, ignoring duplicate`);
      return;
    }

    // Mark this prompt as completed
    this.completedPrompts.add(idx);
    this.log(`Prompt ${promptNumber} completed successfully`);

    // Clear timeout and processing flag
    this.clearCurrentTimeout();
    this.isProcessingPrompt = false;

    // Process and store result using the idx
    const processedResult = {
      index: idx,
      promptNumber: promptNumber,
      prompt: this.prompts[idx],
      response: result.response || '',
      timestamp: result.timestamp || Date.now(),
      success: true,
      retryCount: this.retryAttempts.get(idx) || 0,
      processingTime: Date.now() - (result.startTime || Date.now()),
      automationId: this.automationId
    };

    this.processedResults.push(processedResult);

    // Save result
    await this.savePromptResult(idx, processedResult);

    // Update progress with completion count
    await this.sendMessageToPopup('automation-progress', {
      current: this.processedResults.length,
      total: this.prompts.length,
      prompt: this.prompts[idx],
      status: 'completed',
      response: result.response,
      hasResponse: !!(result.response && result.response.length > 0)
    });

    // Move pointer forward only if idx matches currentPromptIndex
    if (idx === this.currentPromptIndex) {
      this.currentPromptIndex++;
    }
    this.retryAttempts.delete(idx);
    await this.saveAutomationState();

    // Wait before next prompt or complete
    if (this.currentPromptIndex < this.prompts.length) {
      this.log(`Waiting ${this.settings.delay}ms before next prompt...`);
      this.currentTimeout = setTimeout(() => {
        if (this.isRunning && !this.isPaused) {
          this.processNextPrompt();
        }
      }, this.settings.delay);
    } else {
      await this.completeAutomation();
    }
  }

  async handlePromptFailed(error, promptIndex) {
    // Use the correct prompt index - either passed or current
    const actualIndex = promptIndex !== undefined ? promptIndex : this.currentPromptIndex;
    const promptNumber = actualIndex + 1;
    
    // Check if we've already processed this failure to prevent duplicates
    if (this.completedPrompts.has(actualIndex)) {
      this.log(`Prompt ${promptNumber} failure already processed, ignoring duplicate`);
      return;
    }
    
    this.logError(`Prompt ${promptNumber} failed:`, error);
    
    // Clear timeout and processing flag
    this.clearCurrentTimeout();
    this.isProcessingPrompt = false;

    // Get current retry count for this specific prompt
    const currentRetries = this.retryAttempts.get(actualIndex) || 0;
    const shouldRetry = this.settings.enableRetries &&
      currentRetries < this.settings.maxRetries &&
      this.isRetryableError(error);

    if (shouldRetry) {
      // Increment retry count for this prompt
      this.retryAttempts.set(actualIndex, currentRetries + 1);
      this.log(`Retrying prompt ${promptNumber} (attempt ${currentRetries + 1}/${this.settings.maxRetries})`);

      // Update progress with retry status
      await this.sendMessageToPopup('automation-progress', {
        current: promptNumber,
        total: this.prompts.length,
        prompt: this.prompts[actualIndex],
        status: 'retrying',
        retryCount: currentRetries + 1,
        maxRetries: this.settings.maxRetries,
        error: error
      });

      // Wait longer before retry (don't increment currentPromptIndex)
      this.currentTimeout = setTimeout(() => {
        if (this.isRunning && !this.isPaused) {
          this.processNextPrompt(); // Retry same prompt
        }
      }, this.settings.retryDelay);

    } else {
      // Mark this prompt as completed (failed)
      this.completedPrompts.add(actualIndex);
      
      // Save failed result
      const failedResult = {
        index: actualIndex,
        promptNumber: promptNumber,
        prompt: this.prompts[actualIndex],
        response: '',
        timestamp: Date.now(),
        success: false,
        error: error,
        retryCount: currentRetries,
        automationId: this.automationId
      };

      this.processedResults.push(failedResult);
      await this.savePromptResult(actualIndex, failedResult);

      // Update progress with failure
      await this.sendMessageToPopup('automation-progress', {
        current: this.processedResults.length,
        total: this.prompts.length,
        prompt: this.prompts[actualIndex],
        status: 'failed',
        error: error,
        retryCount: currentRetries
      });

      if (this.settings.pauseOnError) {
        await this.pauseAutomation();
        await this.sendMessageToPopup('automation-error', {
          error: `Prompt ${promptNumber} failed: ${error}`,
          promptIndex: actualIndex,
          paused: true
        });
      } else {
        // Skip to next prompt
        this.currentPromptIndex++;
        this.retryAttempts.delete(actualIndex);
        await this.saveAutomationState();
        
        this.currentTimeout = setTimeout(() => {
          if (this.isRunning && !this.isPaused) {
            this.processNextPrompt();
          }
        }, this.settings.delay);
      }
    }
  }

  async handlePromptTimeout() {
    this.logError(`Prompt ${this.currentPromptIndex + 1} timed out`);
    await this.handlePromptFailed('Timeout - prompt execution exceeded time limit', this.currentPromptIndex);
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

  async completeAutomation() {
    this.log('Automation completed');
    this.isRunning = false;
    this.isPaused = false;
    this.isProcessingPrompt = false;

    // Save final results
    await this.saveFinalResults();

    // Generate summary
    const summary = this.generateAutomationSummary();

    // Clear automation state
    await this.clearAutomationState();

    // Notify popup
    await this.sendMessageToPopup('automation-complete', {
      completed: this.processedResults.length,
      total: this.prompts.length,
      results: this.processedResults,
      summary: summary,
      automationId: this.automationId
    });
    await this.showCompletionNotification(summary);
  }

  generateAutomationSummary() {
    const total = this.prompts.length;
    const successful = this.processedResults.filter(r => r.success).length;
    const failed = this.processedResults.filter(r => !r.success).length;
    const withResponses = this.processedResults.filter(r => r.response && r.response.length > 0).length;
    const totalRetries = Array.from(this.retryAttempts.values()).reduce((sum, count) => sum + count, 0);

    return {
      total,
      successful,
      failed,
      withResponses,
      totalRetries,
      successRate: total > 0 ? (successful / total * 100).toFixed(1) : 0,
      responseRate: total > 0 ? (withResponses / total * 100).toFixed(1) : 0,
      duration: Date.now() - this.automationId
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
        priority: 1,
        requireInteraction: false
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

  async saveFinalResults() {
    try {
      const finalResults = {
        automationId: this.automationId,
        timestamp: Date.now(),
        prompts: this.prompts,
        results: this.processedResults,
        summary: this.generateAutomationSummary(),
        settings: this.settings
      };

      await browser.storage.local.set({
        [`automation_${this.automationId}`]: finalResults,
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

  clearCurrentTimeout() {
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
      this.currentTimeout = null;
    }
  }

  async handleContentScriptReady(tabId) {
    this.log(`Content script ready on tab ${tabId}`);
    if (this.isRunning && this.currentTabId === tabId && !this.isPaused && !this.isProcessingPrompt) {
      await this.processNextPrompt();
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
        priority: data.notificationType === 'error' ? 2 : 1,
        requireInteraction: data.notificationType === 'error'
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