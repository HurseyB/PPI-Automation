/**
 * Enhanced Perplexity AI Automator - Fixed Popup Script  
 * Fixed: Added proper error handling for connection issues
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

  addPrompt() {
    const promptText = this.promptInput.value.trim();
    if (!promptText) return;

    this.prompts.push(promptText);
    this.promptInput.value = '';
    this.renderPrompts();
    this.savePrompts();
    this.validateInput();
  }

  clearAllPrompts() {
    if (this.prompts.length === 0) return;
    
    if (confirm('Are you sure you want to clear all prompts?')) {
      this.prompts = [];
      this.renderPrompts();
      this.savePrompts();
      this.validateInput();
    }
  }

  deletePrompt(index) {
    this.prompts.splice(index, 1);
    this.renderPrompts();
    this.savePrompts();
    this.validateInput();
  }

  editPrompt(index) {
    const currentText = this.prompts[index];
    const newText = prompt('Edit prompt:', currentText);
    if (newText !== null && newText.trim() !== '') {
      this.prompts[index] = newText.trim();
      this.renderPrompts();
      this.savePrompts();
    }
  }

  togglePromptExpansion(index) {
    const contentElement = document.querySelector(`[data-prompt-content="${index}"]`);
    if (contentElement) {
      contentElement.classList.toggle('expanded');
    }
  }

  toggleAllPrompts() {
    this.collapsedAll = !this.collapsedAll;
    const contentElements = document.querySelectorAll('.prompt-content');
    
    if (this.collapsedAll) {
      contentElements.forEach(el => el.classList.remove('expanded'));
      this.toggleViewBtn.textContent = 'Expand All';
    } else {
      contentElements.forEach(el => el.classList.add('expanded'));
      this.toggleViewBtn.textContent = 'Collapse All';
    }
  }

  renderPrompts() {
    this.promptCount.textContent = this.prompts.length;
    
    if (this.prompts.length === 0) {
      this.promptsList.innerHTML = '<div class="empty-state">No prompts added yet. Add your first prompt above!</div>';
      return;
    }

    const promptsHTML = this.prompts.map((prompt, index) => `
      <div class="prompt-item">
        <div class="prompt-header" onclick="automator.togglePromptExpansion(${index})">
          <span class="prompt-number">#${index + 1}</span>
          <span class="prompt-preview">${this.escapeHtml(prompt.substring(0, 60))}${prompt.length > 60 ? '...' : ''}</span>
          <div class="prompt-actions" onclick="event.stopPropagation();">
            <button class="btn btn-edit btn-icon" onclick="automator.editPrompt(${index})" title="Edit">✏️</button>
            <button class="btn btn-delete btn-icon" onclick="automator.deletePrompt(${index})" title="Delete">🗑️</button>
          </div>
        </div>
        <div class="prompt-content" data-prompt-content="${index}">
          <div class="prompt-text">${this.escapeHtml(prompt)}</div>
        </div>
      </div>
    `).join('');

    this.promptsList.innerHTML = promptsHTML;
  }

  async startAutomation() {
    if (this.prompts.length === 0) {
      this.showNotification('Please add at least one prompt before starting automation.', 'error');
      return;
    }

    if (this.isRunning) {
      this.showNotification('Automation is already running.', 'warning');
      return;
    }

    try {
      // Get current tab
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        throw new Error('Could not get current tab');
      }

      // Check if it's a Perplexity tab
      if (!tab.url.includes('perplexity.ai')) {
        this.showNotification('Please navigate to perplexity.ai first.', 'error');
        return;
      }

      // Disable the start button
      this.startAutomationBtn.disabled = true;
      
      // Send start automation message to background script
      const response = await browser.runtime.sendMessage({
        type: 'start-automation',
        prompts: this.prompts,
        tabId: tab.id
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to start automation');
      }
      
    } catch (error) {
      this.startAutomationBtn.disabled = false;
      this.logError('Failed to start automation:', error);
      
      // Check for specific connection errors
      if (error.message.includes('Could not establish connection') || 
          error.message.includes('Receiving end does not exist')) {
        this.showNotification('Extension connection error. Please try reloading the page and reopening this popup.', 'error');
      } else {
        this.showNotification('Failed to start automation: ' + error.message, 'error');
      }
    }
  }

  async stopAutomation() {
    if (!this.isRunning) {
      this.showNotification('No automation is currently running.', 'warning');
      return;
    }

    try {
      const response = await browser.runtime.sendMessage({
        type: 'stop-automation'
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to stop automation');
      }
    } catch (error) {
      this.logError('Failed to stop automation:', error);
      this.showNotification('Failed to stop automation: ' + error.message, 'error');
    }
  }

  updateAutomationButton() {
    if (this.isRunning) {
      this.startAutomationBtn.style.display = 'none';
      this.stopAutomationBtn.style.display = 'block';
    } else {
      this.startAutomationBtn.style.display = 'block';
      this.startAutomationBtn.disabled = false;
      this.stopAutomationBtn.style.display = 'none';
    }
  }

  validateInput() {
    const hasText = this.promptInput.value.trim().length > 0;
    const hasPrompts = this.prompts.length > 0;
    
    this.addPromptBtn.disabled = !hasText;
    this.clearAllBtn.style.display = hasPrompts ? 'inline-flex' : 'none';
    this.toggleViewBtn.style.display = hasPrompts ? 'inline-flex' : 'none';
    
    // Update start button state
    if (!this.isRunning) {
      this.startAutomationBtn.disabled = !hasPrompts;
    }
  }

  savePrompts() {
    try {
      browser.storage.local.set({ prompts: this.prompts });
    } catch (error) {
      this.logError('Failed to save prompts:', error);
    }
  }

  async loadPrompts() {
    try {
      const result = await browser.storage.local.get(['prompts']);
      if (result.prompts && Array.isArray(result.prompts)) {
        this.prompts = result.prompts;
        this.renderPrompts();
        this.validateInput();
      }
    } catch (error) {
      this.logError('Failed to load prompts:', error);
    }
  }

  showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification--${type}`;
    notification.textContent = message;
    
    // Style the notification
    Object.assign(notification.style, {
      position: 'fixed',
      top: '10px',
      right: '10px',
      padding: '10px 15px',
      borderRadius: '5px',
      color: 'white',
      fontSize: '14px',
      zIndex: '10000',
      maxWidth: '300px',
      wordWrap: 'break-word'
    });

    // Set background color based on type
    const colors = {
      info: '#3498db',
      success: '#2ecc71',
      warning: '#f39c12',
      error: '#e74c3c'
    };
    notification.style.backgroundColor = colors[type] || colors.info;

    // Add to page
    document.body.appendChild(notification);

    // Remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 5000);

    // Also log the message
    this.logMessage(`${type.toUpperCase()}: ${message}`);
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

// Initialize the automator when the popup loads
const automator = new PerplexityAutomator();