/**
 * Enhanced Perplexity AI Automator - Popup Script with Document Management
 * Added: Document management system for collecting and downloading responses
 */

class PerplexityAutomator {
    constructor() {
        this.prompts = [];
        this.isRunning = false;
        this.collapsedAll = false;
        this.documentManager = new DocumentManager(); // NEW: Document management
        this.initializeElements();
        this.bindEventListeners();
        this.loadPrompts();
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

        // Document management elements - NEW
        this.downloadTxtBtn = document.getElementById('downloadTxtBtn');
        this.downloadDocxBtn = document.getElementById('downloadDocxBtn');
        this.clearDocumentBtn = document.getElementById('clearDocumentBtn');
        this.documentStatus = document.getElementById('documentStatus');
        this.responseCount = document.getElementById('responseCount');

        // Automation elements
        this.startAutomationBtn = document.getElementById('startAutomationBtn');
        this.stopAutomationBtn = document.getElementById('stopAutomationBtn');

        // Progress elements
        this.progressSection = document.querySelector('.progress-section');
        this.progressText = document.getElementById('progressText');
        this.progressFill = document.getElementById('progressFill');
        this.currentPrompt = document.getElementById('currentPrompt');
        this.automationLog = document.getElementById('automationLog');
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

        // Document management events - NEW
        this.downloadTxtBtn.addEventListener('click', () => this.documentManager.downloadTxt());
        this.downloadDocxBtn.addEventListener('click', () => this.documentManager.downloadDocx());
        this.clearDocumentBtn.addEventListener('click', () => this.clearDocument());

        // Automation controls
        this.startAutomationBtn.addEventListener('click', () => this.startAutomation());
        this.stopAutomationBtn.addEventListener('click', () => this.stopAutomation());

        // Input validation
        this.promptInput.addEventListener('input', () => this.validateInput());
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
        this.clearLog();
        this.logMessage('Automation started with ' + data.total + ' prompts');
        
        // NEW: Initialize document for new automation
        this.documentManager.initializeDocument(data.total);
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
            
            // NEW: Add response to document if available
            if (data.response && data.prompt) {
                this.documentManager.addResponse(current, data.prompt, data.response);
                this.updateResponseCount();
            }
        } else if (data.status === 'failed') {
            this.currentPrompt.textContent = `Failed prompt ${current}/${total}`;
            this.logMessage(`✗ Prompt ${current} failed: ${data.error || 'Unknown error'}`);
        } else if (data.status === 'retrying') {
            this.currentPrompt.textContent = `Retrying prompt ${current}/${total} (${data.retryCount}/${data.maxRetries})`;
            this.logMessage(`🔄 Retrying prompt ${current} (attempt ${data.retryCount}/${data.maxRetries})`);
        }
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
    }

    handleAutomationError(data) {
        this.isRunning = false;
        this.updateAutomationButton();
        this.currentPrompt.textContent = 'Automation error occurred';
        this.logMessage(`❌ Error: ${data.error || 'Unknown error occurred'}`);
        this.showNotification('Automation error: ' + (data.error || 'Unknown error'), 'error');
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
            this.downloadTxtBtn.disabled = false;
            this.downloadDocxBtn.disabled = false;
        }
    }

    clearDocument() {
        if (confirm('Are you sure you want to clear the document? This will remove all collected responses.')) {
            this.documentManager.clearDocument();
            this.updateResponseCount();
            this.updateDocumentStatus('ready', 'Ready');
            this.downloadTxtBtn.disabled = true;
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
        // Simple notification - could be enhanced with proper UI notifications
        console.log(`[${type.toUpperCase()}] ${message}`);
    }

    updateAutomationButton() {
        if (this.isRunning) {
            this.startAutomationBtn.style.display = 'none';
            this.stopAutomationBtn.style.display = 'block';
        } else {
            this.startAutomationBtn.style.display = 'block';
            this.stopAutomationBtn.style.display = 'none';
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
                        <button class="btn btn-edit" onclick="window.automator.editPrompt(${index})" title="Edit">✏️</button>
                        <button class="btn btn-delete" onclick="window.automator.deletePrompt(${index})" title="Delete">🗑️</button>
                    </div>
                </div>
                <div class="prompt-content">
                    <div class="prompt-text">${prompt}</div>
                </div>
            </div>
        `).join('');
    }

    async editPrompt(index) {
        const newText = prompt('Edit prompt:', this.prompts[index]);
        if (newText !== null && newText.trim()) {
            this.prompts[index] = newText.trim();
            await this.savePrompts();
            this.renderPrompts();
        }
    }

    async deletePrompt(index) {
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
class DocumentManager {
    constructor() {
        this.document = {
            title: 'PERPLEXITY AI AUTOMATION REPORT',
            timestamp: null,
            totalPrompts: 0,
            responses: [],
            summary: null
        };
    }

    initializeDocument(totalPrompts) {
        this.document = {
            title: 'PERPLEXITY AI AUTOMATION REPORT',
            timestamp: new Date().toISOString(),
            totalPrompts: totalPrompts,
            responses: [],
            summary: null
        };
    }

    addResponse(promptNumber, promptText, responseText) {
        // Check if response already exists to prevent duplicates
        const existingIndex = this.document.responses.findIndex(r => r.promptNumber === promptNumber);
        
        if (existingIndex >= 0) {
            // Update existing response
            this.document.responses[existingIndex] = {
                promptNumber,
                promptText,
                responseText,
                timestamp: new Date().toISOString()
            };
        } else {
            // Add new response
            this.document.responses.push({
                promptNumber,
                promptText,
                responseText,
                timestamp: new Date().toISOString()
            });
        }

        // Sort responses by prompt number
        this.document.responses.sort((a, b) => a.promptNumber - b.promptNumber);
    }

    finalizeDocument(summary) {
        this.document.summary = summary;
        this.document.finalizedAt = new Date().toISOString();
    }

    hasResponses() {
        return this.document.responses.length > 0;
    }

    getResponseCount() {
        return this.document.responses.length;
    }

    clearDocument() {
        this.document.responses = [];
        this.document.summary = null;
    }

    generateTextDocument() {
        let content = `${this.document.title}\n`;
        content += `Generated: ${new Date(this.document.timestamp).toLocaleString()}\n`;
        content += `Total Prompts: ${this.document.totalPrompts}\n`;
        
        if (this.document.summary) {
            content += `Completed: ${this.document.summary.successful} successful, ${this.document.summary.failed} failed\n`;
            content += `Success Rate: ${this.document.summary.successRate}%\n`;
        }
        
        content += `${'='.repeat(80)}\n\n`;

        this.document.responses.forEach((response, index) => {
            content += `PROMPT ${response.promptNumber}: ${response.promptText}\n\n`;
            content += `RESPONSE ${response.promptNumber}:\n`;
            content += `${response.responseText}\n\n`;
            content += `${'='.repeat(80)}\n\n`;
        });

        if (this.document.summary) {
            content += `\nAUTOMATION SUMMARY\n`;
            content += `${'='.repeat(80)}\n`;
            content += `Total Prompts: ${this.document.summary.total}\n`;
            content += `Successful: ${this.document.summary.successful}\n`;
            content += `Failed: ${this.document.summary.failed}\n`;
            content += `Success Rate: ${this.document.summary.successRate}%\n`;
            content += `With Responses: ${this.document.summary.withResponses}\n`;
            content += `Response Rate: ${this.document.summary.responseRate}%\n`;
            if (this.document.summary.duration) {
                const duration = Math.round(this.document.summary.duration / 1000);
                content += `Duration: ${duration} seconds\n`;
            }
        }

        return content;
    }

    downloadTxt() {
      browser.runtime.sendMessage({ type: 'export-results', format: 'txt' });
    }

    downloadDocx() {
        try {
            // Generate RTF content (can be opened as DOCX by Word)
            const content = this.generateRichTextDocument();
            const filename = `perplexity_automation_${Date.now()}.rtf`;

            // Create blob and download
            const blob = new Blob([content], { type: 'application/rtf' });
            const url = URL.createObjectURL(blob);

            // Create a temporary download link
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Clean up
            URL.revokeObjectURL(url);

            console.log('RTF document downloaded successfully');
        } catch (error) {
            console.error('Failed to download RTF document:', error);
        }
    }

    generateRichTextDocument() {
        // Generate RTF format which can be opened by Word
        let rtf = '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}';
        
        // Title
        rtf += '{\\f0\\fs28\\b ' + this.document.title + '}\\par\\par';
        
        // Metadata
        rtf += '{\\f0\\fs20 Generated: ' + new Date(this.document.timestamp).toLocaleString() + '}\\par';
        rtf += '{\\f0\\fs20 Total Prompts: ' + this.document.totalPrompts + '}\\par\\par';
        
        if (this.document.summary) {
            rtf += '{\\f0\\fs20 Completed: ' + this.document.summary.successful + ' successful, ' + this.document.summary.failed + ' failed}\\par';
            rtf += '{\\f0\\fs20 Success Rate: ' + this.document.summary.successRate + '%}\\par\\par';
        }

        // Responses
        this.document.responses.forEach((response) => {
            rtf += '{\\f0\\fs22\\b PROMPT ' + response.promptNumber + ':}\\par';
            rtf += '{\\f0\\fs20 ' + this.escapeRtf(response.promptText) + '}\\par\\par';
            rtf += '{\\f0\\fs22\\b RESPONSE ' + response.promptNumber + ':}\\par';
            rtf += '{\\f0\\fs20 ' + this.escapeRtf(response.responseText) + '}\\par\\par';
            rtf += '\\line\\par';
        });

        rtf += '}';
        return rtf;
    }

    escapeRtf(text) {
        return text.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
    }
}

// Initialize the automator
window.automator = new PerplexityAutomator();