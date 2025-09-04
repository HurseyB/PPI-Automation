class PerplexityAutomator {
    constructor() {
        this.prompts = [];
        this.isRunning = false;
        this.currentPromptIndex = 0;
        this.collapsedAll = false;
        
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
        
        // Automation controls
        this.startAutomationBtn.addEventListener('click', () => this.startAutomation());
        this.stopAutomationBtn.addEventListener('click', () => this.stopAutomation());
        
        // Input validation
        this.promptInput.addEventListener('input', () => this.validateInput());
    }

    setupMessageListener() {
        browser.runtime.onMessage.addListener(message => {
          switch (message.type) {
            case 'automation-progress':
              // Only update progress display; do NOT internally increment
              this.setProgress(message.data.current, message.data.total, message.data);
              break;
            case 'automation-complete':
              this.automationComplete();
              break;
            case 'automation-error':
              this.handleAutomationError(message.error);
              break;
          }
        });
      }

    async loadPrompts() {
        try {
            const result = await browser.storage.local.get('prompts');
            this.prompts = result.prompts || [];
            this.updateUI();
        } catch (error) {
            this.logError('Failed to load prompts:', error);
        }
    }

    async savePrompts() {
        try {
            await browser.storage.local.set({ prompts: this.prompts });
        } catch (error) {
            this.logError('Failed to save prompts:', error);
        }
    }

    validateInput() {
        const text = this.promptInput.value.trim();
        const isValid = text.length > 0 && this.prompts.length < 50;
        this.addPromptBtn.disabled = !isValid;
    }

    addPrompt() {
        const text = this.promptInput.value.trim();
        
        if (!text) {
            this.showNotification('Please enter a prompt', 'error');
            return;
        }
        
        if (this.prompts.length >= 50) {
            this.showNotification('Maximum of 50 prompts allowed', 'error');
            return;
        }

        const prompt = {
            id: Date.now(),
            text: text,
            createdAt: new Date().toISOString(),
            expanded: false
        };

        this.prompts.push(prompt);
        this.promptInput.value = '';
        this.savePrompts();
        this.updateUI();
        this.showNotification('Prompt added successfully', 'success');
    }

    editPrompt(id) {
        const prompt = this.prompts.find(p => p.id === id);
        if (!prompt) return;

        const newText = window.prompt('Edit prompt:', prompt.text);
        if (newText !== null && newText.trim()) {
            prompt.text = newText.trim();
            this.savePrompts();
            this.updateUI();
            this.showNotification('Prompt updated successfully', 'success');
        }
    }

    deletePrompt(id) {
        if (!window.confirm('Are you sure you want to delete this prompt?')) {
            return;
        }

        this.prompts = this.prompts.filter(p => p.id !== id);
        this.savePrompts();
        this.updateUI();
        this.showNotification('Prompt deleted successfully', 'success');
    }

    clearAllPrompts() {
        if (!window.confirm(`Are you sure you want to delete all ${this.prompts.length} prompts?`)) {
            return;
        }

        this.prompts = [];
        this.savePrompts();
        this.updateUI();
        this.showNotification('All prompts cleared', 'success');
    }

    togglePrompt(id) {
        const prompt = this.prompts.find(p => p.id === id);
        if (prompt) {
            prompt.expanded = !prompt.expanded;
            this.updateUI();
        }
    }

    toggleAllPrompts() {
        this.collapsedAll = !this.collapsedAll;
        this.prompts.forEach(prompt => {
            prompt.expanded = !this.collapsedAll;
        });
        this.updateUI();
    }

    updateUI() {
        this.updatePromptCount();
        this.updatePromptsList();
        this.updateAutomationButton();
        this.updateToggleButton();
        this.validateInput();
    }

    updatePromptCount() {
        this.promptCount.textContent = this.prompts.length;
        this.promptCount.style.color = this.prompts.length >= 50 ? '#dc3545' : '#6c757d';
    }

    updatePromptsList() {
        if (this.prompts.length === 0) {
            this.promptsList.innerHTML = `
                <div class="empty-state">
                    <p>No prompts saved yet. Add your first prompt above.</p>
                </div>
            `;
            return;
        }

        this.promptsList.innerHTML = this.prompts.map((prompt, index) => `
            <div class="prompt-item" data-id="${prompt.id}">
                <div class="prompt-header" onclick="automator.togglePrompt(${prompt.id})">
                    <span class="prompt-number">#${index + 1}</span>
                    <span class="prompt-preview">${this.truncateText(prompt.text, 40)}</span>
                    <div class="prompt-actions" onclick="event.stopPropagation()">
                        <button class="btn btn-edit" onclick="automator.editPrompt(${prompt.id})">
                            Edit
                        </button>
                        <button class="btn btn-delete" onclick="automator.deletePrompt(${prompt.id})">
                            Delete
                        </button>
                    </div>
                </div>
                <div class="prompt-content ${prompt.expanded ? 'expanded' : ''}">
                    <div class="prompt-text">${this.escapeHtml(prompt.text)}</div>
                </div>
            </div>
        `).join('');
    }

    updateAutomationButton() {
        this.startAutomationBtn.disabled = this.prompts.length === 0 || this.isRunning;
    }

    updateToggleButton() {
        this.toggleViewBtn.textContent = this.collapsedAll ? 'Expand All' : 'Collapse All';
    }

    async startAutomation() {
        if (this.prompts.length === 0) {
            this.showNotification('No prompts to run', 'error');
            return;
        }

        // Check if we're on a Perplexity.ai page
        try {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            const activeTab = tabs[0];
            
            if (!activeTab.url.includes('perplexity.ai')) {
                this.showNotification('Please navigate to Perplexity.ai first', 'error');
                return;
            }

            this.isRunning = true;
            this.currentPromptIndex = 0;
            this.showProgressSection();
            this.updateAutomationControls();
            
            // Send message to background script to start automation
            await browser.runtime.sendMessage({
                type: 'start-automation',
                prompts: this.prompts.map(p => p.text),
                tabId: activeTab.id
            });

            this.logMessage('Automation started...');
            
        } catch (error) {
            this.logError('Failed to start automation:', error);
            this.isRunning = false;
            this.updateAutomationControls();
        }
    }

    async stopAutomation() {
        try {
            await browser.runtime.sendMessage({ type: 'stop-automation' });
            this.automationComplete();
            this.logMessage('Automation stopped by user');
        } catch (error) {
            this.logError('Failed to stop automation:', error);
        }
    }

    setProgress(current, total, data) {
        // Show the progress section if hidden
        if (this.progressSection.style.display === 'none') {
          this.progressSection.style.display = 'block';
        }
        // Update text and bar based strictly on incoming values
        this.progressText.textContent = `${current} of ${total} completed`;
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        this.progressFill.style.width = `${pct}%`;

        // Only show the “current-prompt” text when starting processing,
        // not when finishing or retrying:
        if (data.status === 'processing') {
          this.currentPrompt.textContent = `Current: ${data.prompt}`;
        }

        // Log messages verbatim (keeps scrollbar at bottom)
        this.automationLog.innerHTML += `[${new Date().toLocaleTimeString()}] ${data.status} ${current}/${total}` + '<br>';
        this.automationLog.scrollTop = this.automationLog.scrollHeight;
      }



    automationComplete() {
        this.isRunning = false;
        this.updateAutomationControls();
        this.logMessage('Automation completed successfully!');
        this.showNotification('Automation completed!', 'success');
    }

    handleAutomationError(error) {
        this.isRunning = false;
        this.updateAutomationControls();
        this.logError('Automation error:', error);
        this.showNotification('Automation failed. Check the log for details.', 'error');
    }

    showProgressSection() {
        this.progressSection.style.display = 'block';
        this.progressFill.style.width = '0%';
        this.progressText.textContent = '0 of 0 completed';
        this.currentPrompt.textContent = '';
        this.automationLog.innerHTML = '';
    }

    updateAutomationControls() {
        if (this.isRunning) {
            this.startAutomationBtn.style.display = 'none';
            this.stopAutomationBtn.style.display = 'block';
        } else {
            this.startAutomationBtn.style.display = 'block';
            this.stopAutomationBtn.style.display = 'none';
        }
        this.updateAutomationButton();
    }

    logMessage(message) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `[${timestamp}] ${message}`;
        this.automationLog.innerHTML += logEntry + '<br>';
        this.automationLog.scrollTop = this.automationLog.scrollHeight;
    }

    logError(message, error) {
        console.error(message, error);
        this.logMessage(`ERROR: ${message} ${error?.message || error}`);
    }

    showNotification(message, type = 'info') {
        // Simple notification system - could be enhanced with toast notifications
        console.log(`${type.toUpperCase()}: ${message}`);
        
        // Visual feedback through button states or other UI elements
        if (type === 'error') {
            // Could add red border flash or other visual feedback
        }
    }

    // Utility functions
    truncateText(text, maxLength) {
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the automator when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.automator = new PerplexityAutomator();
});

// Handle popup unload
window.addEventListener('beforeunload', () => {
    if (window.automator && window.automator.isRunning) {
        // Could save state or notify background script
    }
});