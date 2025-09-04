/**
 * Enhanced Perplexity AI Automator - Popup Script with Document Management
 * Added: Document management system for collecting and downloading responses
 */

class PerplexityAutomator {
    async saveUIState(state) {
        // state: { current, total, percentage, currentPromptText, responseCount, documentStatus, isPaused }
        const uiState = {
            ...state,
            // NEW: Save document data
            documentData: {
                document: this.documentManager.document,
                timestamp: Date.now()
            },
            // NEW: Save log messages
            logMessages: this.automationLog ? this.automationLog.innerHTML : ''
        };
        await browser.storage.local.set({ popupUIState: uiState });
    }

    async loadUIState() {
      const result = await browser.storage.local.get('popupUIState');
      return result.popupUIState || null;
    }

    constructor() {
        this.prompts = [];
        this.isRunning = false;
        this.collapsedAll = false;
        this.documentManager = new DocumentManager(); // NEW: Document management
        this.initializeElements();
        this.initializeNotificationSettings();
        this.bindEventListeners();
        this.setupPromptListEventHandlers();
        this.loadPrompts();
    // ADDED: Load document manager state first
        // ENHANCED: Load document manager state with background sync
        this.documentManager.loadDocumentState().then(async () => {
            // Try to sync with background if no data locally
            if (!this.documentManager.hasResponses()) {
                await this.documentManager.syncWithBackground();
            }

            this.updateResponseCount();
            if (this.documentManager.hasResponses()) {
                this.enableDownloadButtons();
                if (this.documentManager.document.summary) {
                    this.updateDocumentStatus('ready', 'Document ready for download');
                } else {
                    this.updateDocumentStatus('partial', 'Partial document available');
                }
            }
        });


        this.loadUIState().then(async state => {  // <- ADD 'async' HERE
            if (!state) return;

            // Restore document data FIRST if it exists, but prioritize background sync
            if (state.documentData && state.documentData.document) {
                // First try to sync with background for latest data
                const synced = await this.documentManager.syncWithBackground();
                if (!synced) {
                    // Fallback to UI state data if background sync fails
                    // Check if we need to map the structure (in case UI state has background structure)
                    if (state.documentData.document.responses.length > 0 &&
                        state.documentData.document.responses[0].prompt !== undefined) {
                        // UI state has background structure, need to map it
                        this.documentManager.document = {
                            ...state.documentData.document,
                            responses: state.documentData.document.responses.map(bgResponse => ({
                                promptNumber: bgResponse.index + 1,
                                promptText: bgResponse.prompt,
                                responseText: bgResponse.response,
                                timestamp: bgResponse.timestamp
                            }))
                        };
                    } else {
                        // UI state already has correct structure
                        this.documentManager.document = state.documentData.document;
                    }
                    console.log('Document data restored from UI state:', this.documentManager.getResponseCount(), 'responses');
                }
            }


            // Show progress if there's ongoing automation
            // Show progress if there's ongoing automation
            if (state.total > 0) {
                this.showProgressSection();

                // Reconstruct progress bar
                this.progressText.textContent = `${state.current} of ${state.total} completed`;
                this.progressFill.style.width = `${state.percentage}%`;
                this.currentPrompt.textContent = state.currentPromptText;

                // Restore document status and count
                this.responseCount.textContent = state.responseCount;
                this.documentStatus.textContent = state.documentStatus;

                // Set status class
                const cls = state.documentStatus === 'Document ready for download' ? 'status status--success' :
                            state.documentStatus === 'collecting' ? 'status status--info' :
                            'status status--partial';
                this.documentStatus.className = cls;

                // NEW: Restore log messages if they exist
                if (state.logMessages && this.automationLog) {
                    this.automationLog.innerHTML = state.logMessages;
                }

                // Enable download buttons if responses exist
                if (state.responseCount > 0) {
                    // Ensure DOM is ready before enabling buttons
                    setTimeout(() => this.enableDownloadButtons(), 100);
                }
            }

            // NEW: Update button states based on current automation status
            setTimeout(() => this.updateAutomationButton(), 200);

        });
        this.setupMessageListener();
    }

    initializeElements() {
        // Input elements
        this.promptInput = document.getElementById('promptInput');
        this.addPromptBtn = document.getElementById('addPromptBtn');
        this.clearAllBtn = document.getElementById('clearAllBtn');

        // Display elements
        this.promptsList = document.getElementById('promptsList');
        this.promptCount = document.getElementById('promptCount');
        this.toggleViewBtn = document.getElementById('toggleViewBtn');
        this.openPromptManagerBtn = document.getElementById('openPromptManagerBtn');

        // Document management elements - NEW
        //this.downloadTxtBtn = document.getElementById('downloadTxtBtn'); // -- This is unused, and removed from html. Keeping comment for my records.
        this.downloadDocxBtn = document.getElementById('downloadDocxBtn');
        this.clearDocumentBtn = document.getElementById('clearDocumentBtn');
        this.documentStatus = document.getElementById('documentStatus');
        this.responseCount = document.getElementById('responseCount');

        // Automation elements
        this.startAutomationBtn = document.getElementById('startAutomationBtn');
        this.pauseAutomationBtn = document.getElementById('pauseAutomationBtn');
        this.resumeAutomationBtn = document.getElementById('resumeAutomationBtn');
        this.stopAutomationBtn = document.getElementById('stopAutomationBtn');

        // Progress elements
        this.progressSection = document.querySelector('.progress-section');
        this.progressText = document.getElementById('progressText');
        this.progressFill = document.getElementById('progressFill');
        this.currentPrompt = document.getElementById('currentPrompt');
        this.automationLog = document.getElementById('automationLog');
    }

    initializeNotificationSettings() {
      // Initialize notification elements
      this.enableNotifications = document.getElementById('enableNotifications');

      // Load notification settings
      this.loadNotificationSettings();
    }

    async loadNotificationSettings() {
      try {
        const result = await browser.storage.local.get(['notificationSettings']);
        const settings = result.notificationSettings || { enabled: true };

        if (this.enableNotifications) {
          this.enableNotifications.checked = settings.enabled;
        }
      } catch (error) {
        console.error('Failed to load notification settings:', error);
      }
    }

    async saveNotificationSettings() {
      try {
        const settings = {
          enabled: this.enableNotifications ? this.enableNotifications.checked : true
        };

        await browser.storage.local.set({ notificationSettings: settings });

        // Send updated settings to background script
        browser.runtime.sendMessage({
          type: 'update-notification-settings',
          settings: settings
        });

        // If user just enabled notifications, request permission
        if (settings.enabled) {
          await this.requestNotificationPermission();
        }
      } catch (error) {
        console.error('Failed to save notification settings:', error);
      }
    }

    async requestNotificationPermission() {
        try {
            // Extension notifications are automatically available with manifest permission
            // Just test if the API is available
            const response = await browser.runtime.sendMessage({
                type: 'request-notification-permission'
            });
            if (response.success) {
                this.showNotification('Notifications are ready!', 'success');
            } else {
                console.log('Notification API not available');
            }
        } catch (error) {
            console.error('Failed to check notification availability:', error);
        }
    }


    bindEventListeners() {
        // Input events
        this.addPromptBtn.addEventListener('click', () => this.addPrompt());
        this.clearAllBtn.addEventListener('click', () => this.clearAllPrompts());
        this.promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                this.addPrompt();
            }
        });

        // View toggle
        this.toggleViewBtn.addEventListener('click', () => this.toggleAllPrompts());

        // Open prompt manager
        if (this.openPromptManagerBtn) {
            this.openPromptManagerBtn.addEventListener('click', () => this.openPromptManager());
        }


        // Document management events - NEW
        //this.downloadTxtBtn.addEventListener('click', () => this.documentManager.downloadTxt()); // -- This is unused, and removed from html. Keeping comment for my records.
        this.downloadDocxBtn.addEventListener('click', () => this.documentManager.downloadDocx());
        this.clearDocumentBtn.addEventListener('click', () => this.clearDocument());

        // Automation controls
        // Automation controls
        this.startAutomationBtn.addEventListener('click', () => this.startAutomation());
        this.pauseAutomationBtn.addEventListener('click', () => this.pauseAutomation());
        this.resumeAutomationBtn.addEventListener('click', () => this.resumeAutomation());
        this.stopAutomationBtn.addEventListener('click', () => this.stopAutomation());

        // Input validation
        this.promptInput.addEventListener('input', () => this.validateInput());

        // Notification settings
        if (this.enableNotifications) {
          this.enableNotifications.addEventListener('change', () => this.saveNotificationSettings());
        }
    }

    setupPromptListEventHandlers() {
        // Use event delegation for dynamically created prompt buttons
        this.promptsList.addEventListener('click', async (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button) return;

            event.stopPropagation(); // Prevent triggering the prompt expansion

            const action = button.dataset.action;
            const index = parseInt(button.dataset.index);

            try {
                if (action === 'edit') {
                    await this.editPrompt(index);
                } else if (action === 'delete') {
                    await this.deletePrompt(index);
                }
            } catch (error) {
                console.error(`Error performing ${action} action:`, error);
                this.showNotification(`Error: Could not ${action} prompt`, 'error');
            }
        });
    }

    setupMessageListener() {
        browser.runtime.onMessage.addListener((message) => {
            try {
                switch (message.type) {
                    case 'automation-started':
                        this.handleAutomationStarted(message.data);
                        break;
                    case 'automation-progress':
                        this.handleProgressUpdate(message.data);
                        break;
                    case 'automation-complete':
                        this.handleAutomationComplete(message.data);
                        break;
                    case 'automation-stopped':
                        this.handleAutomationStopped(message.data);
                        break;
                    case 'automation-error':
                        this.handleAutomationError(message.data);
                        break;
                    case 'automation-paused':
                        this.handleAutomationPaused(message.data);
                        break;
                    case 'automation-resumed':
                        this.handleAutomationResumed(message.data);
                        break;
                    case 'document-updated': // NEW: Handle document updates
                        this.handleDocumentUpdated(message.data);
                        break;
                }
            } catch (error) {
                this.logError('Error handling message:', error);
            }
        });
    }

    handleAutomationStarted(data) {
        this.isRunning = true;
        this.showProgressSection();
        this.updateAutomationButton();
        this.progressText.textContent = '0 of ' + data.total + ' completed';
        this.progressFill.style.width = '0%';
        this.currentPrompt.textContent = 'Starting automation...';
        // Only clear log if this is a truly new automation (not a restoration)
        if (!this.automationLog.innerHTML.includes('Automation started')) {
            this.clearLog();
        }
        this.logMessage('Automation started with ' + data.total + ' prompts');
        
        // NEW: Document initialization handled by background script
        this.updateDocumentStatus('collecting', 'Collecting responses...');
    }

    handleProgressUpdate(data) {
        const current = data.current;
        const total = data.total;

        this.progressText.textContent = `${current} of ${total} completed`;
        const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
        this.progressFill.style.width = `${percentage}%`;

        if (data.status === 'processing' && data.prompt) {
            this.currentPrompt.textContent = `Processing: ${data.prompt.substring(0, 50)}...`;
            this.logMessage(`Processing prompt ${current}/${total}: ${data.prompt.substring(0, 30)}...`);
        } else if (data.status === 'completed') {
            this.currentPrompt.textContent = `Completed prompt ${current}/${total}`;
            this.logMessage(`✓ Prompt ${current} completed successfully`);

            // NEW: Response collection handled by background script, just update UI
            if (data.response && data.prompt) {
                this.updateResponseCount();
            }

        } else if (data.status === 'failed') {
            this.currentPrompt.textContent = `Failed prompt ${current}/${total}`;
            this.logMessage(`✗ Prompt ${current} failed: ${data.error || 'Unknown error'}`);
        } else if (data.status === 'retrying') {
            this.currentPrompt.textContent = `Retrying prompt ${current}/${total} (${data.retryCount}/${data.maxRetries})`;
            this.logMessage(`🔄 Retrying prompt ${current} (attempt ${data.retryCount}/${data.maxRetries})`);
        }
        const uiState = {
          current: data.current,
          total: data.total,
          percentage,
          currentPromptText: this.currentPrompt.textContent,
          responseCount: this.documentManager.getResponseCount(),
          documentStatus: this.documentStatus.textContent
        };
        this.saveUIState(uiState);
    }

    handleAutomationComplete(data) {
        this.isRunning = false;
        this.updateAutomationButton();
        this.currentPrompt.textContent = `Automation completed! ${data.completed}/${data.total} prompts processed`;
        this.logMessage(`🎉 Automation completed! Processed ${data.completed}/${data.total} prompts`);
        
        if (data.summary) {
            this.logMessage(`Success rate: ${data.summary.successRate}% (${data.summary.successful} successful, ${data.summary.failed} failed)`);
        }

        // NEW: Finalize document
        this.documentManager.finalizeDocument(data.summary);
        this.updateDocumentStatus('ready', 'Document ready for download');
        this.enableDownloadButtons();
        
        // Persist final state
        this.saveUIState({
          current: data.completed,
          total: data.total,
          percentage: Math.round((data.completed/data.total)*100),
          currentPromptText: this.currentPrompt.textContent,
          responseCount: this.documentManager.getResponseCount(),
          documentStatus: this.documentStatus.textContent
        });

    }

    handleAutomationStopped(data) {
        this.isRunning = false;
        this.updateAutomationButton();
        this.currentPrompt.textContent = 'Automation stopped';
        this.logMessage(`⏹️ Automation stopped. Processed ${data.completed || 0}/${data.total || 0} prompts`);
        
        // NEW: Partial document available
        if (this.documentManager.hasResponses()) {
            this.updateDocumentStatus('partial', 'Partial document available');
            this.enableDownloadButtons();
        }

        // Persist final state
         this.saveUIState({
          current: data.completed,
          total: data.total,
          percentage: Math.round((data.completed/data.total)*100),
          currentPromptText: this.currentPrompt.textContent,
          responseCount: this.documentManager.getResponseCount(),
          documentStatus: this.documentStatus.textContent
        });

    }

    handleAutomationError(data) {
        this.isRunning = false;
        this.updateAutomationButton();
        this.currentPrompt.textContent = 'Automation error occurred';
        this.logMessage(`❌ Error: ${data.error || 'Unknown error occurred'}`);
        this.showNotification('Automation error: ' + (data.error || 'Unknown error'), 'error');
    }

    handleAutomationPaused(data) {
        this.currentPrompt.textContent = 'Automation paused';
        this.logMessage(`⏸️ Automation paused at prompt ${data.currentIndex + 1}/${data.total}`);
        this.updateAutomationButton(); // This will show/hide correct buttons based on state

        // Save paused state
        this.saveUIState({
            current: data.currentIndex,
            total: data.total,
            percentage: Math.round((data.currentIndex / data.total) * 100),
            currentPromptText: this.currentPrompt.textContent,
            responseCount: this.documentManager.getResponseCount(),
            documentStatus: this.documentStatus.textContent,
            isPaused: true
        });
    }

    handleAutomationResumed(data) {
        this.currentPrompt.textContent = `Resuming automation...`;
        this.logMessage(`▶️ Automation resumed from prompt ${data.currentIndex + 1}/${data.total}`);
        this.updateAutomationButton();

        // Save resumed state
        this.saveUIState({
            current: data.currentIndex,
            total: data.total,
            percentage: Math.round((data.currentIndex / data.total) * 100),
            currentPromptText: this.currentPrompt.textContent,
            responseCount: this.documentManager.getResponseCount(),
            documentStatus: this.documentStatus.textContent,
            isPaused: false
        });
    }


    // NEW: Handle document update notifications
    handleDocumentUpdated(data) {
        this.updateResponseCount();
        if (data.status) {
            this.updateDocumentStatus(data.status, data.message);
        }
    }

    // NEW: Document management methods
    updateDocumentStatus(status, message) {
        this.documentStatus.textContent = message;
        this.documentStatus.className = `status status--${status === 'error' ? 'error' : status === 'ready' ? 'success' : 'info'}`;
    }

    updateResponseCount() {
        const count = this.documentManager.getResponseCount();
        this.responseCount.textContent = count;
        
        // Enable clear button if responses exist
        this.clearDocumentBtn.disabled = count === 0;
    }

    enableDownloadButtons() {
        if (this.documentManager.hasResponses()) {
            this.downloadDocxBtn.disabled = false;
            console.log('Download buttons enabled -', this.documentManager.getResponseCount(), 'responses available');
        } else {
            console.log('Download buttons NOT enabled - no responses available');
        }
    }

    async clearDocument() {
        if (confirm('Are you sure you want to clear the document? This will remove all collected responses.')) {
            // Clear background document as well
            try {
                await browser.runtime.sendMessage({ type: 'clear-background-document' });
            } catch (error) {
                console.error('Failed to clear background document:', error);
            }

            this.documentManager.clearDocument();
            this.updateResponseCount();
            this.updateDocumentStatus('ready', 'Ready');
            this.downloadDocxBtn.disabled = true;
            this.showNotification('Document cleared', 'info');
        }
    }


    // Existing methods remain unchanged...
    showProgressSection() {
        this.progressSection.style.display = 'block';
    }

    hideProgressSection() {
        this.progressSection.style.display = 'none';
    }

    clearLog() {
        this.automationLog.innerHTML = '';
    }

    logMessage(message) {
        const timestamp = new Date().toLocaleTimeString();
        this.automationLog.innerHTML += `<div class="log-entry">[${timestamp}] ${message}</div>`;
        this.automationLog.scrollTop = this.automationLog.scrollHeight;
    }

    logError(message, error) {
        console.error(`[Perplexity Automator] ${message}`, error);
        this.logMessage(`❌ ${message}: ${error}`);
    }

    showNotification(message, type = 'info') {
      // Send notification request to background script
      try {
        browser.runtime.sendMessage({
          type: 'show-notification',
          data: {
            message: message,
            notificationType: type,
            title: 'Perplexity AI Automator'
          }
        }).catch(error => {
          // Fallback to console if messaging fails
          console.log(`[${type.toUpperCase()}] ${message}`);
        });
      } catch (error) {
        // Fallback to console if notifications fail
        console.log(`[${type.toUpperCase()}] ${message}`);
      }
    }

    async updateAutomationButton() {
        try {
            // Get current automation status from background
            const response = await browser.runtime.sendMessage({
                type: 'get-automation-status'
            });

            const status = response || {};

            if (status.isRunning) {
                this.startAutomationBtn.disabled = true;
                this.stopAutomationBtn.disabled = false;

                if (status.isPaused) {
                    // Show resume, hide pause
                    this.pauseAutomationBtn.style.display = 'none';
                    this.resumeAutomationBtn.style.display = 'inline-flex';
                    this.resumeAutomationBtn.disabled = false;
                } else {
                    // Show pause, hide resume
                    this.pauseAutomationBtn.style.display = 'inline-flex';
                    this.pauseAutomationBtn.disabled = false;
                    this.resumeAutomationBtn.style.display = 'none';
                }
            } else {
                // Not running - show only start button
                this.startAutomationBtn.disabled = false;
                this.stopAutomationBtn.disabled = true;
                this.pauseAutomationBtn.style.display = 'none';
                this.resumeAutomationBtn.style.display = 'none';
            }
        } catch (error) {
            this.logError('Failed to update button states:', error);
            // Fallback to basic state if status check fails
            this.startAutomationBtn.disabled = this.isRunning;
            this.stopAutomationBtn.disabled = !this.isRunning;
            this.pauseAutomationBtn.style.display = 'none';
            this.resumeAutomationBtn.style.display = 'none';
        }
        if (this.prompts.length > 0) {
            this.renderPrompts();
        }
    }

    validateInput() {
        const isEmpty = !this.promptInput.value.trim();
        this.addPromptBtn.disabled = isEmpty;
    }

    async addPrompt() {
        const text = this.promptInput.value.trim();
        if (!text) return;

        if (this.prompts.length >= 50) {
            this.showNotification('Maximum 50 prompts allowed', 'warning');
            return;
        }

        this.prompts.push(text);
        this.promptInput.value = '';
        this.validateInput();
        
        await this.savePrompts();
        this.renderPrompts();
        this.updatePromptCount();
        this.updateStartButton();
    }

    async clearAllPrompts() {
        if (this.prompts.length === 0) return;
        
        if (confirm('Are you sure you want to clear all prompts?')) {
            this.prompts = [];
            await this.savePrompts();
            this.renderPrompts();
            this.updatePromptCount();
            this.updateStartButton();
        }
    }

    toggleAllPrompts() {
        this.collapsedAll = !this.collapsedAll;
        const items = document.querySelectorAll('.prompt-item');
        
        items.forEach(item => {
            const content = item.querySelector('.prompt-content');
            if (content) {
                if (this.collapsedAll) {
                    content.classList.remove('expanded');
                } else {
                    content.classList.add('expanded');
                }
            }
        });

        this.toggleViewBtn.textContent = this.collapsedAll ? 'Expand All' : 'Collapse All';
    }

    openPromptManager() {
        // Open the prompt manager in a new tab
        const url = browser.runtime.getURL('prompt-manager.html');
        browser.tabs.create({ url: url }).catch(error => {
            console.error('Failed to open prompt manager:', error);
            this.showNotification('Failed to open prompt manager', 'error');
        });
    }

    async startAutomation() {
        if (this.prompts.length === 0) {
            this.showNotification('No prompts to run', 'warning');
            return;
        }

        try {
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            
            if (!tab.url.includes('perplexity.ai')) {
                this.showNotification('Please navigate to Perplexity.ai first', 'error');
                return;
            }

            await browser.runtime.sendMessage({
                type: 'start-automation',
                prompts: this.prompts,
                tabId: tab.id
            });
            
        } catch (error) {
            this.logError('Failed to start automation:', error);
            this.showNotification('Failed to start automation', 'error');
        }
    }

    async stopAutomation() {
        try {
            await browser.runtime.sendMessage({ type: 'stop-automation' });
        } catch (error) {
            this.logError('Failed to stop automation:', error);
        }
    }

    async pauseAutomation() {
        try {
            const response = await browser.runtime.sendMessage({
                type: 'pause-automation'
            });

            if (response.success) {
                this.showNotification('Automation paused', 'info');
            } else {
                this.showNotification('Failed to pause automation', 'error');
            }
        } catch (error) {
            this.logError('Failed to pause automation:', error);
            this.showNotification('Error pausing automation', 'error');
        }
    }

    async resumeAutomation() {
        try {
            const response = await browser.runtime.sendMessage({
                type: 'resume-automation'
            });

            if (response.success) {
                this.showNotification('Automation resumed', 'info');
            } else {
                this.showNotification('Failed to resume automation', 'error');
            }
        } catch (error) {
            this.logError('Failed to resume automation:', error);
            this.showNotification('Error resuming automation', 'error');
        }
    }

    renderPrompts() {
        if (this.prompts.length === 0) {
            this.promptsList.innerHTML = '<div class="empty-state"><p>No prompts saved yet. Add your first prompt above.</p></div>';
            return;
        }

        this.promptsList.innerHTML = this.prompts.map((prompt, index) => `
            <div class="prompt-item">
                <div class="prompt-header" onclick="this.parentElement.querySelector('.prompt-content').classList.toggle('expanded')">
                    <span class="prompt-number">#{index + 1}</span>
                    <span class="prompt-preview">${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}</span>
                    <div class="prompt-actions" onclick="event.stopPropagation()">
                        <button class="btn btn-edit" data-action="edit" data-index="${index}" title="Edit" ${this.isRunning ? 'disabled' : ''}>✏️</button>
                        <button class="btn btn-delete" data-action="delete" data-index="${index}" title="Delete" ${this.isRunning ? 'disabled' : ''}>🗑️</button>
                    </div>
                </div>
                <div class="prompt-content">
                    <div class="prompt-text">${prompt}</div>
                </div>
            </div>
        `).join('');
    }

    async editPrompt(index) {
        // Prevent editing during automation
        if (this.isRunning) {
            alert('Cannot edit prompts while automation is running. Please stop the automation first.');
            return;
        }

        const newText = prompt('Edit prompt:', this.prompts[index]);
        if (newText !== null && newText.trim()) {
            this.prompts[index] = newText.trim();
            await this.savePrompts();
            this.renderPrompts();
        }
    }

    async deletePrompt(index) {
        // Prevent deleting during automation
        if (this.isRunning) {
            alert('Cannot delete prompts while automation is running. Please stop the automation first.');
            return;
        }

        if (confirm('Delete this prompt?')) {
            this.prompts.splice(index, 1);
            await this.savePrompts();
            this.renderPrompts();
            this.updatePromptCount();
            this.updateStartButton();
        }
    }

    updatePromptCount() {
        this.promptCount.textContent = this.prompts.length;
    }

    updateStartButton() {
        this.startAutomationBtn.disabled = this.prompts.length === 0;
    }

    async savePrompts() {
        try {
            await browser.storage.local.set({ prompts: this.prompts });
        } catch (error) {
            this.logError('Failed to save prompts:', error);
        }
    }

    async loadPrompts() {
        try {
            const result = await browser.storage.local.get(['prompts']);
            this.prompts = result.prompts || [];
            this.renderPrompts();
            this.updatePromptCount();
            this.updateStartButton();
            this.validateInput();
        } catch (error) {
            this.logError('Failed to load prompts:', error);
        }
    }
}

// NEW: Document Management Class
/**
 * Enhanced Document Manager for Microsoft Word Layout
 * Formats DOCX with Times New Roman index, Aptos Display headings
 */
class DocumentManager {
    constructor() {
        this.document = {
            title: 'Perplexity AI Automation Results',
            timestamp: null,
            responses: [],
            summary: null
        };
    }

    async loadDocumentState() {
        try {
            const result = await browser.storage.local.get(['popupDocument']);
            if (result.popupDocument) {
                this.document = result.popupDocument;
                console.log('Document state loaded:', this.getResponseCount(), 'responses');
            }
        } catch (error) {
            console.error('Failed to load document state:', error);
        }
    }

    async saveDocumentState() {
        try {
            await browser.storage.local.set({ popupDocument: this.document });
        } catch (error) {
            console.error('Failed to save document state:', error);
        }
    }

    async syncWithBackground() {
        try {
            const response = await browser.runtime.sendMessage({ type: 'get-document-data' });
            if (response && response.document && response.document.responses.length > 0) {
                // Map background document structure to popup structure
                this.document = {
                    ...this.document,
                    responses: response.document.responses.map(bgResponse => ({
                        promptNumber: bgResponse.index + 1,
                        promptText: bgResponse.prompt,
                        responseText: bgResponse.response,
                        timestamp: bgResponse.timestamp
                    }))
                };
                await this.saveDocumentState();
                console.log('Synced with background:', this.getResponseCount(), 'responses');
                return true;
            }
        } catch (error) {
            console.error('Failed to sync with background:', error);
        }
        return false;
    }

    addResponse(promptNumber, promptText, responseText) {
        const response = {
            promptNumber,
            promptText,
            responseText,
            timestamp: new Date().toISOString()
        };

        const existingIndex = this.document.responses.findIndex(r => r.promptNumber === promptNumber);
        if (existingIndex >= 0) {
            this.document.responses[existingIndex] = response;
        } else {
            this.document.responses.push(response);
        }

        this.document.responses.sort((a, b) => a.promptNumber - b.promptNumber);
        this.saveDocumentState();
    }

    getResponseCount() {
        return this.document.responses.length;
    }

    hasResponses() {
        return this.getResponseCount() > 0;
    }

    clearDocument() {
        this.document = {
            title: 'Perplexity AI Automation Results',
            timestamp: null,
            responses: [],
            summary: null
        };
        this.saveDocumentState();
    }

    finalizeDocument(summary) {
        this.document.summary = summary;
        this.saveDocumentState();
    }

    /**
     * Generate and download DOCX with Microsoft Word formatting
     * Follows screenshot specifications:
     * - Index: Times New Roman, 12pt, underlined
     * - H1: Aptos Display, 20pt, Heading style
     * - H2: Aptos Display, 16pt, Strong style
     */
    async downloadDocx() {
        if (!this.hasResponses()) {
            alert('No responses to download');
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
                            font: "Aptos Display",
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
                                font: "Aptos Display",
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
                                text: `Question ${response.promptNumber}`,
                                font: "Times New Roman",
                                size: 24 // 12pt
                            }),
                            new TextRun({
                                text: `${'.'.repeat(Math.max(1, 50 - `Question ${response.promptNumber}`.length))} ${pageNumber}`,
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
                                text: `Question ${response.promptNumber}`,
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
                const responseLines = response.responseText.split('\n\n');
                responseLines.forEach(line => {
                    if (line.trim()) {
                        sections.push(
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: line.trim(),
                                        font: "Aptos Display",
                                        size: 22 // 11pt for body text
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

            // FIXED: Generate and download using Blob (browser-compatible)
            const blob = await Packer.toBlob(doc);

            const url = URL.createObjectURL(blob);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `perplexity-automation-${timestamp}.docx`;

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            console.log('DOCX downloaded successfully:', filename);

        } catch (error) {
            console.error('Failed to generate DOCX:', error);
            alert('Failed to generate DOCX file: ' + error.message);
        }
    }
}


// Initialize the automator
window.automator = new PerplexityAutomator();