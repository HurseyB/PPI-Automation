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
            logMessages: this.automationLog ? this.automationLog.innerHTML : '',
            companyName: this.companyNameInput ? this.companyNameInput.value : ''
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
        this.documentManager = new DocumentManager(); // Document management
        // Initialize company name in DocumentManager (populated from tab state or UI state)
        this.documentManager.companyName = '';
        // NEW: Set current tab ID for document manager
        browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
          this.documentManager.setTabId(tab.id);
        });
        this.initializeElements();
        this.initializeNotificationSettings();
        this.bindEventListeners();
        this.loadPrompts();
    // ADDED: Load document manager state first
        // ENHANCED: Load document manager state with background sync
        this.documentManager.loadDocumentState().then(async () => {
            // Try to sync with background if no data locally
            if (!this.documentManager.hasResponses()) {
              // Sync only for current active tab
              const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
              // Ensure document manager has the correct tab ID
              this.documentManager.setTabId(tab.id);
              const response = await browser.runtime.sendMessage({
                type: 'get-tab-document-data',
                tabId: tab.id
              });
              if (response && response.document && response.document.responses.length > 0) {
                this.documentManager.document = {
                  ...response.document,
                  responses: response.document.responses.map(bg => ({
                    promptNumber: bg.index + 1,
                    promptText: bg.prompt,
                    responseText: bg.response,
                    timestamp: bg.timestamp
                  }))
                };
                this.documentManager.companyName = response.companyName || this.documentManager.companyName;
                this.documentManager.updateDocumentTitle();
                this.documentManager.saveDocumentState();

                // ✅ ADD: Also update the input field if we have a stored company name
                if (response.companyName && response.companyName !== 'Company' && this.companyNameInput) {
                    this.companyNameInput.value = response.companyName;
                    console.log('Restored company name from background:', response.companyName);
                }
              }
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

            // Retrieve tab-specific company name from background or UI state
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            const tabData = await browser.runtime.sendMessage({ type: 'get-tab-document-data', tabId: tab.id });
            let name = '';
            if (tabData && tabData.companyName) {
                name = tabData.companyName;
            } else if (state.companyName !== undefined && this.companyNameInput) {
                name = state.companyName;
            }
            if (name) {
                this.companyNameInput.value = name;
                this.documentManager.companyName = name;
                // Update tab title when loading existing company name
                await this.updateTabTitle(name);
            }

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
                if (this.progressText) {
                    this.progressText.textContent = `${state.current} of ${state.total} completed`;
                }
                if (this.progressFill) {
                    this.progressFill.style.width = `${state.percentage}%`;
                }
                if (this.currentPrompt) {
                    this.currentPrompt.textContent = state.currentPromptText;
                }

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
      // Only keep elements that exist in simplified popup
      this.openPromptManagerBtn = document.getElementById('openPromptManagerBtn');
      this.promptCount = document.getElementById('promptCount');

      // Document management elements
      this.downloadDocxBtn = document.getElementById('downloadDocxBtn');
      this.clearDocumentBtn = document.getElementById('clearDocumentBtn');
      this.documentStatus = document.getElementById('documentStatus');
      this.responseCount = document.getElementById('responseCount');

      // Automation elements
      this.startAutomationBtn = document.getElementById('startAutomationBtn');
      this.pauseAutomationBtn = document.getElementById('pauseAutomationBtn');
      this.resumeAutomationBtn = document.getElementById('resumeAutomationBtn');
      this.resetAutomationBtn = document.getElementById('resetAutomationBtn');
      this.runningControls = document.querySelector('.running-controls');
      this.companyNameInput = document.getElementById('companyNameInput');

      // Progress elements (these don't exist in popup, but needed for compatibility)
      this.progressText = null;
      this.progressFill = null;
      this.currentPrompt = null;
      this.automationLog = null;

      // Initialize notification elements
      this.enableNotifications = document.getElementById('enableNotifications');

      // Log missing elements for debugging
        if (!this.resetAutomationBtn) {
          console.warn('resetAutomationBtn element not found in DOM');
        }
        if (!this.runningControls) {
          console.warn('runningControls element not found in DOM');
        }
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
      // Open prompt manager
      if (this.openPromptManagerBtn) {
        this.openPromptManagerBtn.addEventListener('click', () => this.openPromptManager());
      }

      // Document management events
      this.downloadDocxBtn.addEventListener('click', async () => {
          console.log('=== DOWNLOAD DEBUG START ===');

          // Get tab and background data (existing logic)
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          const tabData = await browser.runtime.sendMessage({ type: 'get-tab-document-data', tabId: tab.id });

          // Company name resolution (existing logic preserved)
          const uiState = await browser.storage.local.get('popupUIState');
          const uiCompanyName = uiState.popupUIState?.companyName;
          const storedName = tabData?.companyName;
          const inputName = this.companyNameInput ? this.companyNameInput.value.trim() : '';

          let finalName = 'Company';
          if (uiCompanyName && uiCompanyName !== 'Company') {
              finalName = uiCompanyName;
          } else if (storedName && storedName !== 'Company') {
              finalName = storedName;
          } else if (inputName && inputName !== 'Company') {
              finalName = inputName;
          }

          this.documentManager.companyName = finalName;
          this.documentManager.updateDocumentTitle();

          if (this.companyNameInput) {
              this.companyNameInput.value = finalName;
          }

          await browser.runtime.sendMessage({
              type: 'set-tab-company-name',
              tabId: tab.id,
              companyName: finalName
          });

          // NEW: Get automation ID for tracking
          const automationStatus = await browser.runtime.sendMessage({
              type: 'get-automation-status',
              tabId: tab.id
          });
          const automationId = automationStatus?.automationId;

          // NEW: Notify background that download is starting
          if (automationId) {
              await browser.runtime.sendMessage({
                  type: 'docx-download-started',
                  automationId: automationId
              });
          }

          console.log('=== DOWNLOAD DEBUG END ===');

          // Perform download with automation ID
          await this.documentManager.downloadDocx(automationId);
      });
      this.clearDocumentBtn.addEventListener('click', () => this.clearDocument());


      // ✅ TEMPORARY: Add debug trigger (double-click company input field)
      if (this.companyNameInput) {
          this.companyNameInput.addEventListener('dblclick', () => {
              this.debugCompanyName();
          });
      }
      // Automation controls
      this.startAutomationBtn.addEventListener('click', () => this.startAutomation());
      this.pauseAutomationBtn.addEventListener('click', () => this.pauseAutomation());
      this.resumeAutomationBtn.addEventListener('click', () => this.resumeAutomation());
      this.resetAutomationBtn.addEventListener('click', () => this.resetAutomation());

      // Notification settings
      if (this.enableNotifications) {
        this.enableNotifications.addEventListener('change', () => this.saveNotificationSettings());
      }

      // Persist company name on change
      if (this.companyNameInput) {
        this.companyNameInput.addEventListener('input', async () => {
          // Get current tab and update title immediately
          const companyName = this.companyNameInput.value.trim();

          this.documentManager.companyName = companyName || 'Company';
          this.documentManager.updateDocumentTitle();

          // Update tab title in real-time
          await this.updateTabTitle(companyName);

          // Save only the companyName in UI state
          this.saveUIState({
            // Minimal state object; other fields will be merged internally
            current: this.current || 0,
            total: this.total || 0,
            percentage: this.percentage || 0,
            currentPromptText: this.currentPromptText || '',
            responseCount: this.documentManager.getResponseCount(),
            documentStatus: this.documentStatus ? this.documentStatus.textContent : 'Ready'
          });
        });
      }
    }

    // ✅ ADD THIS DEBUG METHOD (for testing)
    async debugCompanyName() {
        console.log('=== COMPANY NAME SOURCES DEBUG ===');

        try {
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            const tabData = await browser.runtime.sendMessage({ type: 'get-tab-document-data', tabId: tab.id });

            console.log('1. Tab ID:', tab.id);
            console.log('2. Background tabData:', tabData);
            console.log('3. Background companyName:', tabData?.companyName);
            console.log('4. Document manager companyName:', this.documentManager.companyName);
            console.log('5. Document title:', this.documentManager.document.title);
            console.log('6. Input field value:', this.companyNameInput?.value);
            console.log('7. Response count:', this.documentManager.getResponseCount());

            // Check UI state
            const uiState = await browser.storage.local.get('popupUIState');
            console.log('8. UI State companyName:', uiState.popupUIState?.companyName);

        } catch (error) {
            console.error('Debug error:', error);
        }

        console.log('=== END DEBUG ===');
    }

    // NEW: Update tab title helper function
    async updateTabTitle(companyName) {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        await browser.runtime.sendMessage({
          type: 'update-tab-title',
          tabId: tab.id,
          companyName: companyName || ''
        });
      } catch (error) {
        console.error('Failed to update tab title:', error);
      }
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
        this.updateAutomationButton();

        // Show progress info using document status
        this.updateDocumentStatus('collecting', `Automation started: 0 of ${data.total} completed`);

        // Log for debugging
        this.logMessage('Automation started with ' + data.total + ' prompts');

        // Show notification to user
        this.showNotification(`Automation started with ${data.total} prompts`, 'success');
    }


    handleProgressUpdate(data) {
      const current = data.current;
      const total = data.total;

      // Update document status to show progress
      const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

      if (data.status === 'processing' && data.prompt) {
        this.updateDocumentStatus('collecting', `Processing ${current}/${total}: ${data.prompt.substring(0, 30)}...`);
        this.logMessage(`Processing prompt ${current}/${total}: ${data.prompt.substring(0, 30)}...`);

        // NULL-SAFE: Check if currentPrompt exists before using it
        if (this.currentPrompt) {
          this.currentPrompt.textContent = `Processing ${current}/${total}: ${data.prompt.substring(0,30)}...`;
        }
      } else if (data.status === 'completed') {
        this.updateDocumentStatus('collecting', `Completed ${current}/${total} (${percentage}%)`);
        this.logMessage(`✓ Prompt ${current} completed successfully`);

        // NULL-SAFE: Check if currentPrompt exists before using it
        if (this.currentPrompt) {
          this.currentPrompt.textContent = `Completed ${current}/${total} (${percentage}%)`;
        }

        // NEW: Response collection handled by background script, just update UI
        if (data.response && data.prompt) {
          this.updateResponseCount();
        }
      } else if (data.status === 'failed') {
        // NULL-SAFE: Check if currentPrompt exists before using it
        if (this.currentPrompt) {
          this.currentPrompt.textContent = `Failed prompt ${current}/${total}`;
        }
        this.logMessage(`✗ Prompt ${current} failed: ${data.error || 'Unknown error'}`);
      } else if (data.status === 'retrying') {
        // NULL-SAFE: Check if currentPrompt exists before using it
        if (this.currentPrompt) {
          this.currentPrompt.textContent = `Retrying prompt ${current}/${total} (${data.retryCount}/${data.maxRetries})`;
        }
        this.logMessage(`🔄 Retrying prompt ${current} (attempt ${data.retryCount}/${data.maxRetries})`);
      }

      const uiState = {
        current: data.current,
        total: data.total,
        percentage,
        currentPromptText: this.currentPrompt ? this.currentPrompt.textContent : '',
        responseCount: this.documentManager.getResponseCount(),
        documentStatus: this.documentStatus ? this.documentStatus.textContent : ''
      };
      this.saveUIState(uiState);
    }


    handleAutomationComplete(data) {
      this.isRunning = false;
      this.updateAutomationButton();

      // NULL-SAFE: Check if currentPrompt exists before using it
      if (this.currentPrompt) {
        this.currentPrompt.textContent = `Automation completed! ${data.completed}/${data.total} prompts processed`;
      }

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
        percentage: Math.round((data.completed/data.total) * 100),
        currentPromptText: this.currentPrompt ? this.currentPrompt.textContent : '',
        responseCount: this.documentManager.getResponseCount(),
        documentStatus: this.documentStatus.textContent
      });
    }


    handleAutomationStopped(data) {
      this.isRunning = false;
      this.updateAutomationButton();

      // NULL-SAFE: Check if currentPrompt exists before using it
      if (this.currentPrompt) {
        this.currentPrompt.textContent = 'Automation stopped';
      }

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
        currentPromptText: this.currentPrompt ? this.currentPrompt.textContent : '',
        responseCount: this.documentManager.getResponseCount(),
        documentStatus: this.documentStatus.textContent
      });
    }


    handleAutomationError(data) {
      this.isRunning = false;
      this.updateAutomationButton();

      // NULL-SAFE: Check if currentPrompt exists before using it
      if (this.currentPrompt) {
        this.currentPrompt.textContent = 'Automation error occurred';
      }

      this.logMessage(`❌ Error: ${data.error || 'Unknown error occurred'}`);
      this.showNotification('Automation error: ' + (data.error || 'Unknown error'), 'error');
    }


    handleAutomationPaused(data) {
      // NULL-SAFE: Check if currentPrompt exists before using it
      if (this.currentPrompt) {
        this.currentPrompt.textContent = 'Automation paused';
      }

      this.logMessage(`⏸️ Automation paused at prompt ${data.currentIndex + 1}/${data.total}`);
      this.updateAutomationButton(); // This will show/hide correct buttons based on state

      // Save paused state
      this.saveUIState({
        current: data.currentIndex,
        total: data.total,
        percentage: Math.round((data.currentIndex / data.total) * 100),
        currentPromptText: this.currentPrompt ? this.currentPrompt.textContent : '',
        responseCount: this.documentManager.getResponseCount(),
        documentStatus: this.documentStatus.textContent,
        isPaused: true
      });
    }


    handleAutomationResumed(data) {
      // NULL-SAFE: Check if currentPrompt exists before using it
      if (this.currentPrompt) {
        this.currentPrompt.textContent = `Resuming automation...`;
      }

      this.logMessage(`▶️ Automation resumed from prompt ${data.currentIndex + 1}/${data.total}`);
      this.updateAutomationButton();

      // Save resumed state
      this.saveUIState({
        current: data.currentIndex,
        total: data.total,
        percentage: Math.round((data.currentIndex / data.total) * 100),
        currentPromptText: this.currentPrompt ? this.currentPrompt.textContent : '',
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
                const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
                await browser.runtime.sendMessage({
                  type: 'clear-tab-document',
                  tabId: tab.id
                });
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

    // Progress section methods (compatibility for popup-only interface)
    showProgressSection() {
        // Update button states
        this.updateAutomationButton();
    }

    clearLog() {
        // Compatibility method - log is in prompt manager
        console.log('Log cleared (popup interface)');
    }

    logMessage(message) {
        // Compatibility method - log is in prompt manager
        console.log(`[Automation] ${message}`);
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
        // Get current tab to check tab-specific automation status
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

        // Get current automation status from background
        const response = await browser.runtime.sendMessage({
          type: 'get-automation-status',
          tabId: tab.id
        });
        const status = response || {};

        // Check if THIS TAB has running automation (not global)
        const isThisTabRunning = status.tabId === tab.id && status.isRunning;

        if (isThisTabRunning) {
          // Hide start button, show running controls
          this.startAutomationBtn.style.display = 'none';
          if (this.runningControls) {
            this.runningControls.style.display = 'flex';
          }
          if (this.resetAutomationBtn) {
            this.resetAutomationBtn.style.display = 'inline-flex';
            this.resetAutomationBtn.disabled = false;
          }

          if (status.isPaused) {
            // Show resume, hide pause
            if (this.pauseAutomationBtn) {
              this.pauseAutomationBtn.style.display = 'none';
            }
            if (this.resumeAutomationBtn) {
              this.resumeAutomationBtn.style.display = 'inline-flex';
              this.resumeAutomationBtn.disabled = false;
            }
          } else {
            // Show pause, hide resume
            if (this.pauseAutomationBtn) {
              this.pauseAutomationBtn.style.display = 'inline-flex';
              this.pauseAutomationBtn.disabled = false;
            }
            if (this.resumeAutomationBtn) {
              this.resumeAutomationBtn.style.display = 'none';
            }
          }
        } else {
          // This tab is not running - show start button only
          this.startAutomationBtn.style.display = 'inline-flex';
          this.startAutomationBtn.disabled = this.prompts.length === 0;

          // Hide running controls
          if (this.runningControls) {
            this.runningControls.style.display = 'none';
          }
        }
      } catch (error) {
        this.logError('Failed to update button states:', error);

        // Enable start button by default on error
        this.startAutomationBtn.style.display = 'inline-flex';
        this.startAutomationBtn.disabled = this.prompts.length === 0;

        // Hide running controls on error
        if (this.runningControls) {
          this.runningControls.style.display = 'none';
        }
      }

      if (this.prompts.length > 0) {
        this.renderPrompts();
      }
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

            const companyName = this.companyNameInput ? this.companyNameInput.value.trim() : '';
            this.documentManager.companyName = companyName || 'Company';
            this.documentManager.updateDocumentTitle(); // ← ADD THIS LINE
            // Update tab title when starting automation
            if (companyName) {
              await this.updateTabTitle(companyName);

            }
            const promptsToSend = this.prompts.map(prompt => {
              // prompt is now an object with { text, pauseAfter }
              let txt = prompt.text;
              if (companyName) {
                // replace company placeholder if desired
                // txt = txt.replace(/\[Company\]/g, companyName);
                txt = txt.replace(/\[Company Name\]/g, companyName);
              }
              return { text: txt, pauseAfter: !!prompt.pauseAfter };
            });

            await browser.runtime.sendMessage({
              type: 'start-automation',
              prompts: promptsToSend,
              tabId: tab.id,
              companyName: companyName || ''
            });

            this.updateAutomationButton();
            
        } catch (error) {
            this.logError('Failed to start automation:', error);
            this.showNotification('Failed to start automation', 'error');
        }
    }

    async resetAutomation() {
      // Show confirmation dialog
      const confirmed = confirm(
        'Are you sure you want to reset the automation?\n\n' +
        'This will stop the current automation and clear all progress. ' +
        'Any responses collected so far will be preserved in the document.'
      );

      if (!confirmed) {
        return;
      }
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        await browser.runtime.sendMessage({
          type: 'reset-automation',
          tabId: tab.id
        });
        this.showNotification('Automation reset successfully', 'info');
      } catch (error) {
        this.logError('Failed to reset automation:', error);
        this.showNotification('Failed to reset automation', 'error');
      }
    }

    async pauseAutomation() {
        try {
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            const response = await browser.runtime.sendMessage({
                type: 'pause-automation',
                tabId: tab.id
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
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            const response = await browser.runtime.sendMessage({
                type: 'resume-automation',
                tabId: tab.id
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
      // Update prompt count
      this.updatePromptCount();

      // In simplified popup, we don't show the prompt list
      // The prompts are managed in the separate prompt manager page
      // This method is kept minimal to avoid errors
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

    // Update prompt count display
    updatePromptCount() {
      const count = this.prompts.length;
      if (this.promptCount) {
        this.promptCount.textContent = count;
      }
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
        this.updatePromptCount(); // Update the display counter
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
      return this.tabId ? `popupDocument_tab_${this.tabId}` : 'popupDocument';
    }

    async loadDocumentState() {
      try {
        const storageKey = this.getStorageKey();
        const result = await browser.storage.local.get([storageKey]);
        if (result[storageKey]) {
          this.document = result[storageKey];
          console.log('Document state loaded:', this.getResponseCount(), 'responses');
        }
      } catch (error) {
        console.error('Failed to load document state:', error);
      }
    }

    async saveDocumentState() {
        try {
            const storageKey = this.getStorageKey();
            await browser.storage.local.set({ [storageKey]: this.document });
        } catch (error) {
            console.error('Failed to save document state:', error);
        }
    }

    async syncWithBackground() {
        try {
            // NEW: Pass current tab ID to get tab-specific document data
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            const response = await browser.runtime.sendMessage({
              type: 'get-document-data',
              tabId: tab.id
            });
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
            title: `Business Analyses for ${this.companyName}`,
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

    async downloadDocx(automationId = null) {
        if (!this.hasResponses()) {
            alert('No responses to download');
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
                    top: 720,    // 0.5 inch in twips (1440 twips = 1 inch)
                    right: 720,
                    bottom: 720,
                    left: 720
                }
            });

            // Use the companyName stored in this DocumentManager instance for filename prefix
            const safeName = (this.companyName || 'Company')
                .replace(/[<>:"\/\\|?*\x00-\x1F]/g, '')
                .replace(/\s+/g, '-');

            // 2. Format date/time as MM.DD.YYYY-HH.MM.SS
            const now = new Date();
            const pad2 = n => String(n).padStart(2,'0');
            const datePart = `${pad2(now.getMonth()+1)}.${pad2(now.getDate())}.${now.getFullYear()}`;
            const timePart = `${pad2(now.getHours())}.${pad2(now.getMinutes())}.${pad2(now.getSeconds())}`;

            // 3. Build filename
            const filename = `${safeName}-${datePart}-${timePart}.docx`;

            const url = URL.createObjectURL(docxBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            console.log('HTML-formatted DOCX downloaded successfully:', filename);

            // NEW: Notify background that download completed
            if (automationId) {
                setTimeout(async () => {
                    await browser.runtime.sendMessage({
                        type: 'docx-download-completed',
                        automationId: automationId
                    });
                }, 1000);
            }

        } catch (error) {
            console.error('Failed to generate HTML DOCX:', error);
            console.log('Falling back to plain text method');
            return this.downloadDocxPlainText(automationId);
        }
    }

    updateDocumentTitle() {
        this.document.title = `Business Analyses for ${this.companyName}`;
        this.saveDocumentState();
    }

    /**
     * Load brand icon as base64 data URL
     * @returns {Promise<string>} Base64 data URL of the icon
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
     * NEW METHOD: Generate structured HTML document
     * Add this new method to the DocumentManager class
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
     * Process response text to preserve HTML formatting
     * Add this new method to the DocumentManager class
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
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')  // Bold
            .replace(/\*(.*?)\*/g, '<em>$1</em>')              // Italic
            .replace(/`(.*?)`/g, '<code>$1</code>')            // Inline code

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

    /**
     * Generate and download DOCX with Microsoft Word formatting
     * Follows screenshot specifications:
     * - Index: Times New Roman, 12pt, underlined
     * - H1: Aptos Display, 20pt, Heading style
     * - H2: Aptos Display, 16pt, Strong style
     */
    async downloadDocxPlainText() {
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