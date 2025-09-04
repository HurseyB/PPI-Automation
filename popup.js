/**
 * Enhanced Perplexity AI Automator - Fixed Popup Script
 * Fixes premature progress counting and UI state management
 */

class PerplexityAutomator {
  constructor() {
    this.prompts = [];
    this.isRunning = false;
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
  }

  handleProgressUpdate(data) {
    // Use exact values from background script
    const current = data.current;
    const total = data.total;
    
    // Update progress display
    this.progressText.textContent = `${current} of ${total} completed`;
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    this.progressFill.style.width = `${percentage}%`;

    // Update current prompt display based on status
    if (data.status === 'processing' && data.prompt) {
      this.currentPrompt.textContent = `Processing: ${data.prompt.substring(0, 50)}...`;
      this.logMessage(`Processing prompt ${current}/${total}: ${data.prompt.substring(0, 30)}...`);
    } else if (data.status === 'completed') {
      this.currentPrompt.textContent = `Completed prompt ${current}/${total}`;
      this.logMessage(`✓ Prompt ${current} completed successfully`);
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
  }

  handleAutomationStopped(data) {
    this.isRunning = false;
    this.updateAutomationButton();
    this.currentPrompt.textContent = 'Automation stopped';
    this.logMessage(`⏹️ Automation stopped. Processed ${data.completed || 0}/${data.total || 0} prompts`);
  }

  handleAutomationError(data) {
    this.isRunning = false;
    this.updateAutomationButton();
    this.currentPrompt.textContent = 'Automation error occurred';
    this.logMessage(`❌ Error: ${data.error || 'Unknown error occurred'}`);
    this.showNotification('Automation error: ' + (data.error || 'Unknown error'), 'error');
  }

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
    this.automationLog.innerHTML += `<div>[${timestamp}] ${message}</div>`;
    this.automationLog.scrollTop = this.automationLog.scrollHeight;
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

  async startAutomation() {
    if (this.prompts.length === 0) {
      this.showNotification('Please add at least one prompt', 'error');
      return;
    }

    if (this.isRunning) {
      this.showNotification('Automation is already running', 'error');
      return;
    }

    try {
      // Get current active tab
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];

      if (!currentTab) {
        this.showNotification('No active tab found', 'error');
        return;
      }

      // Check if it's a Perplexity.ai tab
      const response = await browser.runtime.sendMessage({
        type: 'check-perplexity-tab',
        tabId: currentTab.id
      });

      if (!response.isPerplexity) {
        this.showNotification('Please navigate to perplexity.ai first', 'error');
        return;
      }

      // Extract prompt texts from prompt objects
      const promptTexts = this.prompts.map(prompt => prompt.text);

      // Start automation
      await browser.runtime.sendMessage({
        type: 'start-automation',
        prompts: promptTexts,
        tabId: currentTab.id
      });

      this.showNotification('Automation started!', 'success');

    } catch (error) {
      this.logError('Failed to start automation:', error);
      this.showNotification('Failed to start automation: ' + error.message, 'error');
    }
  }

  async stopAutomation() {
    if (!this.isRunning) {
      this.showNotification('No automation is running', 'error');
      return;
    }

    try {
      await browser.runtime.sendMessage({
        type: 'stop-automation'
      });

      this.showNotification('Automation stopped', 'success');
    } catch (error) {
      this.logError('Failed to stop automation:', error);
      this.showNotification('Failed to stop automation: ' + error.message, 'error');
    }
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
    this.promptCount.style.color = this.prompts.length >= 50 ? 'var(--color-error)' : 'var(--color-text-secondary)';
  }

  updatePromptsList() {
    if (this.prompts.length === 0) {
      this.promptsList.innerHTML = `
        <div class="empty-state">
          No prompts saved yet. Add your first prompt above.
        </div>
      `;
      return;
    }

    this.promptsList.innerHTML = this.prompts.map((prompt, index) => {
      const preview = prompt.text.length > 80 ? prompt.text.substring(0, 80) + '...' : prompt.text;
      
      return `
        <div class="prompt-item">
          <div class="prompt-header" onclick="window.automator.togglePrompt(${prompt.id})">
            <span class="prompt-number">#${index + 1}</span>
            <span class="prompt-preview">${this.escapeHtml(preview)}</span>
            <div class="prompt-actions">
              <button class="btn btn-edit" onclick="event.stopPropagation(); window.automator.editPrompt(${prompt.id})" title="Edit prompt">
                ✏️
              </button>
              <button class="btn btn-delete" onclick="event.stopPropagation(); window.automator.deletePrompt(${prompt.id})" title="Delete prompt">
                🗑️
              </button>
            </div>
          </div>
          <div class="prompt-content ${prompt.expanded ? 'expanded' : ''}">
            <div class="prompt-text">${this.escapeHtml(prompt.text)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  updateAutomationButton() {
    if (this.isRunning) {
      this.startAutomationBtn.style.display = 'none';
      this.stopAutomationBtn.style.display = 'block';
    } else {
      this.startAutomationBtn.style.display = 'block';
      this.stopAutomationBtn.style.display = 'none';
    }

    this.startAutomationBtn.disabled = this.prompts.length === 0 || this.isRunning;
  }

  updateToggleButton() {
    if (this.prompts.length === 0) {
      this.toggleViewBtn.style.display = 'none';
      return;
    }

    this.toggleViewBtn.style.display = 'block';
    this.toggleViewBtn.textContent = this.collapsedAll ? 'Expand All' : 'Collapse All';
  }

  showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      padding: 10px 15px;
      border-radius: 4px;
      color: white;
      font-weight: 500;
      z-index: 10000;
      max-width: 300px;
      word-wrap: break-word;
    `;

    // Set background color based on type
    switch (type) {
      case 'success':
        notification.style.backgroundColor = 'var(--color-success)';
        break;
      case 'error':
        notification.style.backgroundColor = 'var(--color-error)';
        break;
      case 'warning':
        notification.style.backgroundColor = 'var(--color-warning)';
        break;
      default:
        notification.style.backgroundColor = 'var(--color-info)';
    }

    document.body.appendChild(notification);

    // Remove notification after 3 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  log(message, ...args) {
    console.log(`[Perplexity Automator Popup] ${message}`, ...args);
  }

  logError(message, error) {
    console.error(`[Perplexity Automator Popup ERROR] ${message}`, error);
  }
}

// Initialize automator when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.automator = new PerplexityAutomator();
});