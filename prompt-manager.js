/**
 * Prompt Manager - Advanced Prompt Management Interface
 * Handles drag-and-drop reordering, bulk operations, import/export
 */

class PromptManager {
    constructor() {
        this.prompts = [];
        this.selectedPrompts = new Set();
        this.draggedItem = null;
        this.dragOverItem = null;

        this.initializeElements();
        this.bindEventListeners();
        this.loadPrompts();
    }

    initializeElements() {
        // Input elements
        this.promptInput = document.getElementById('promptInput');
        this.addPromptBtn = document.getElementById('addPromptBtn');
        this.clearInputBtn = document.getElementById('clearInputBtn');

        // Display elements
        this.promptsList = document.getElementById('promptsList');
        this.promptCount = document.getElementById('promptCount');

        // Action buttons
        this.selectAllBtn = document.getElementById('selectAllBtn');
        this.clearSelectedBtn = document.getElementById('clearSelectedBtn');
        this.clearAllBtn = document.getElementById('clearAllBtn');
        this.importBtn = document.getElementById('importBtn');
        this.exportBtn = document.getElementById('exportBtn');
        this.backToPopupBtn = document.getElementById('backToPopupBtn');

        // Modal elements
        this.modal = document.getElementById('importExportModal');
        this.modalTitle = document.getElementById('modalTitle');
        this.modalActionBtn = document.getElementById('modalActionBtn');
        this.modalCancelBtn = document.getElementById('modalCancelBtn');
        this.closeModalBtn = document.getElementById('closeModalBtn');
        this.importSection = document.getElementById('importSection');
        this.exportSection = document.getElementById('exportSection');
        this.fileInput = document.getElementById('fileInput');
        this.jsonInput = document.getElementById('jsonInput');
        this.exportPreview = document.getElementById('exportPreview');
        this.exportSelected = document.getElementById('exportSelected');
        this.includeMetadata = document.getElementById('includeMetadata');
    }

    bindEventListeners() {
        // Input events
        this.promptInput.addEventListener('input', () => this.validateInput());
        this.promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                this.addPrompt();
            }
        });

        this.addPromptBtn.addEventListener('click', () => this.addPrompt());
        this.clearInputBtn.addEventListener('click', () => this.clearInput());

        // Action buttons
        this.selectAllBtn.addEventListener('click', () => this.toggleSelectAll());
        this.clearSelectedBtn.addEventListener('click', () => this.clearSelectedPrompts());
        this.clearAllBtn.addEventListener('click', () => this.clearAllPrompts());
        this.importBtn.addEventListener('click', () => this.showImportModal());
        this.exportBtn.addEventListener('click', () => this.showExportModal());
        this.backToPopupBtn.addEventListener('click', () => this.goBackToPopup());

        // Modal events
        this.closeModalBtn.addEventListener('click', () => this.hideModal());
        this.modalCancelBtn.addEventListener('click', () => this.hideModal());
        this.modalActionBtn.addEventListener('click', () => this.handleModalAction());
        this.modal.querySelector('.modal-overlay').addEventListener('click', () => this.hideModal());

        // File input
        this.fileInput.addEventListener('change', () => this.handleFileSelect());

        // Export options
        this.exportSelected.addEventListener('change', () => this.updateExportPreview());
        this.includeMetadata.addEventListener('change', () => this.updateExportPreview());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));

        // Prevent default drag behaviors on the document
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => e.preventDefault());
    }

    handleKeyboardShortcuts(e) {
        // Ctrl+A - Select all
        if (e.ctrlKey && e.key === 'a' && !e.target.matches('input, textarea')) {
            e.preventDefault();
            this.selectAllPrompts();
        }

        // Delete - Delete selected
        if (e.key === 'Delete' && this.selectedPrompts.size > 0) {
            this.clearSelectedPrompts();
        }

        // Escape - Clear selection or close modal
        if (e.key === 'Escape') {
            if (!this.modal.classList.contains('hidden')) {
                this.hideModal();
            } else if (this.selectedPrompts.size > 0) {
                this.clearSelection();
            }
        }
    }

    validateInput() {
        const value = this.promptInput.value.trim();
        this.addPromptBtn.disabled = value.length === 0;
    }

    async addPrompt() {
        const text = this.promptInput.value.trim();
        if (!text) return;

        const prompt = {
            id: Date.now(),
            text: text,
            created: new Date().toISOString(),
            modified: new Date().toISOString()
        };

        this.prompts.push(prompt);
        await this.savePrompts();
        this.renderPrompts();
        this.clearInput();
        this.showNotification('Prompt added successfully', 'success');
    }

    clearInput() {
        this.promptInput.value = '';
        this.validateInput();
        this.promptInput.focus();
    }

    async editPrompt(index) {
        const prompt = this.prompts[index];
        if (!prompt) return;

        const newText = prompt('Edit prompt:', prompt.text);
        if (newText === null || newText.trim() === '') return;

        prompt.text = newText.trim();
        prompt.modified = new Date().toISOString();

        await this.savePrompts();
        this.renderPrompts();
        this.showNotification('Prompt updated successfully', 'success');
    }

    async deletePrompt(index) {
        if (!confirm('Are you sure you want to delete this prompt?')) return;

        this.prompts.splice(index, 1);
        await this.savePrompts();
        this.renderPrompts();
        this.showNotification('Prompt deleted successfully', 'info');
    }

    async clearSelectedPrompts() {
        if (this.selectedPrompts.size === 0) return;

        const count = this.selectedPrompts.size;
        if (!confirm(`Are you sure you want to delete ${count} selected prompt(s)?`)) return;

        // Convert selected indices to actual indices and sort in descending order
        const indicesToDelete = Array.from(this.selectedPrompts).sort((a, b) => b - a);

        // Delete from highest index to lowest to maintain index integrity
        indicesToDelete.forEach(index => {
            this.prompts.splice(index, 1);
        });

        this.selectedPrompts.clear();
        await this.savePrompts();
        this.renderPrompts();
        this.showNotification(`${count} prompt(s) deleted successfully`, 'info');
    }

    async clearAllPrompts() {
        if (this.prompts.length === 0) return;

        const count = this.prompts.length;
        if (!confirm(`Are you sure you want to delete all ${count} prompts? This action cannot be undone.`)) return;

        this.prompts = [];
        this.selectedPrompts.clear();
        await this.savePrompts();
        this.renderPrompts();
        this.showNotification('All prompts cleared successfully', 'info');
    }

    toggleSelectAll() {
        if (this.selectedPrompts.size === this.prompts.length) {
            this.clearSelection();
        } else {
            this.selectAllPrompts();
        }
    }

    selectAllPrompts() {
        this.selectedPrompts.clear();
        this.prompts.forEach((_, index) => this.selectedPrompts.add(index));
        this.updateSelectionUI();
    }

    clearSelection() {
        this.selectedPrompts.clear();
        this.updateSelectionUI();
    }

    togglePromptSelection(index) {
        if (this.selectedPrompts.has(index)) {
            this.selectedPrompts.delete(index);
        } else {
            this.selectedPrompts.add(index);
        }
        this.updateSelectionUI();
    }

    updateSelectionUI() {
        // Update checkboxes
        document.querySelectorAll('.prompt-checkbox').forEach((checkbox, index) => {
            checkbox.checked = this.selectedPrompts.has(index);
        });

        // Update prompt items
        document.querySelectorAll('.prompt-item').forEach((item, index) => {
            item.classList.toggle('selected', this.selectedPrompts.has(index));
        });

        // Update action buttons
        const hasSelection = this.selectedPrompts.size > 0;
        const hasAllSelected = this.selectedPrompts.size === this.prompts.length && this.prompts.length > 0;

        this.clearSelectedBtn.disabled = !hasSelection;
        this.selectAllBtn.textContent = hasAllSelected ? 'Clear Selection' : 'Select All';
    }

    // Drag and Drop Implementation
    setupDragAndDrop(item, index) {
        const dragHandle = item.querySelector('.drag-handle');

        // Make the entire item draggable but only when dragging from the handle
        item.draggable = false;

        dragHandle.addEventListener('mousedown', (e) => {
            item.draggable = true;
        });

        item.addEventListener('dragstart', (e) => {
            if (!item.draggable) {
                e.preventDefault();
                return;
            }

            this.draggedItem = index;
            item.classList.add('dragging');

            // Create drag image
            const dragImage = item.cloneNode(true);
            dragImage.style.transform = 'rotate(2deg)';
            dragImage.style.opacity = '0.8';
            document.body.appendChild(dragImage);
            e.dataTransfer.setDragImage(dragImage, e.offsetX, e.offsetY);

            // Clean up drag image after a short delay
            setTimeout(() => {
                if (document.body.contains(dragImage)) {
                    document.body.removeChild(dragImage);
                }
            }, 0);

            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', (e) => {
            item.classList.remove('dragging');
            item.draggable = false;
            this.clearDragOverEffects();
            this.draggedItem = null;
            this.dragOverItem = null;
        });

        item.addEventListener('dragover', (e) => {
            if (this.draggedItem === null || this.draggedItem === index) return;

            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            this.clearDragOverEffects();
            item.classList.add('drag-over');
            this.dragOverItem = index;
        });

        item.addEventListener('dragleave', (e) => {
            // Only remove drag-over if we're actually leaving the item
            if (!item.contains(e.relatedTarget)) {
                item.classList.remove('drag-over');
            }
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();

            if (this.draggedItem === null || this.draggedItem === index) return;

            this.movePrompt(this.draggedItem, index);
            this.clearDragOverEffects();
        });
    }

    clearDragOverEffects() {
        document.querySelectorAll('.prompt-item').forEach(item => {
            item.classList.remove('drag-over');
        });
    }

    async movePrompt(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;

        // Remove the item from its current position
        const [movedPrompt] = this.prompts.splice(fromIndex, 1);

        // Insert it at the new position
        this.prompts.splice(toIndex, 0, movedPrompt);

        // Update selected indices
        const newSelectedPrompts = new Set();
        this.selectedPrompts.forEach(selectedIndex => {
            let newIndex = selectedIndex;

            if (selectedIndex === fromIndex) {
                newIndex = toIndex;
            } else if (fromIndex < toIndex) {
                if (selectedIndex > fromIndex && selectedIndex <= toIndex) {
                    newIndex = selectedIndex - 1;
                }
            } else {
                if (selectedIndex >= toIndex && selectedIndex < fromIndex) {
                    newIndex = selectedIndex + 1;
                }
            }

            newSelectedPrompts.add(newIndex);
        });

        this.selectedPrompts = newSelectedPrompts;

        await this.savePrompts();
        this.renderPrompts();
        this.showNotification('Prompt reordered successfully', 'success');
    }

    // Import/Export functionality
    showImportModal() {
        this.modalTitle.textContent = 'Import Prompts';
        this.modalActionBtn.textContent = 'Import';
        this.importSection.classList.remove('hidden');
        this.exportSection.classList.add('hidden');
        this.modal.classList.remove('hidden');
        this.jsonInput.focus();
    }

    showExportModal() {
        this.modalTitle.textContent = 'Export Prompts';
        this.modalActionBtn.textContent = 'Download';
        this.importSection.classList.add('hidden');
        this.exportSection.classList.remove('hidden');
        this.updateExportPreview();
        this.modal.classList.remove('hidden');
    }

    hideModal() {
        this.modal.classList.add('hidden');
        this.fileInput.value = '';
        this.jsonInput.value = '';
        this.exportPreview.value = '';
    }

    handleModalAction() {
        if (this.modalActionBtn.textContent === 'Import') {
            this.handleImport();
        } else {
            this.handleExport();
        }
    }

    handleFileSelect() {
        const file = this.fileInput.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            this.jsonInput.value = e.target.result;
        };
        reader.readAsText(file);
    }

    async handleImport() {
        const jsonText = this.jsonInput.value.trim();
        if (!jsonText) {
            this.showNotification('Please provide JSON data to import', 'error');
            return;
        }

        try {
            const data = JSON.parse(jsonText);

            // Validate data structure
            if (!Array.isArray(data)) {
                throw new Error('Invalid format: Expected an array of prompts');
            }

            const validPrompts = data.filter(item => {
                return typeof item === 'object' &&
                       typeof item.text === 'string' &&
                       item.text.trim().length > 0;
            });

            if (validPrompts.length === 0) {
                throw new Error('No valid prompts found in the data');
            }

            // Add imported prompts
            const importedCount = validPrompts.length;
            validPrompts.forEach(promptData => {
                const prompt = {
                    id: Date.now() + Math.random(),
                    text: promptData.text.trim(),
                    created: promptData.created || new Date().toISOString(),
                    modified: new Date().toISOString()
                };
                this.prompts.push(prompt);
            });

            await this.savePrompts();
            this.renderPrompts();
            this.hideModal();
            this.showNotification(`Successfully imported ${importedCount} prompt(s)`, 'success');

        } catch (error) {
            this.showNotification(`Import failed: ${error.message}`, 'error');
        }
    }

    updateExportPreview() {
        const exportSelectedOnly = this.exportSelected.checked;
        const includeMetadata = this.includeMetadata.checked;

        let promptsToExport = this.prompts;
        if (exportSelectedOnly && this.selectedPrompts.size > 0) {
            promptsToExport = Array.from(this.selectedPrompts)
                .map(index => this.prompts[index])
                .filter(Boolean);
        }

        const exportData = promptsToExport.map(prompt => {
            const data = { text: prompt.text };
            if (includeMetadata) {
                data.created = prompt.created;
                data.modified = prompt.modified;
                data.id = prompt.id;
            }
            return data;
        });

        this.exportPreview.value = JSON.stringify(exportData, null, 2);
    }

    handleExport() {
        const data = this.exportPreview.value;
        if (!data) {
            this.showNotification('Nothing to export', 'error');
            return;
        }

        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `perplexity-prompts-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.hideModal();
        this.showNotification('Prompts exported successfully', 'success');
    }

    // Storage operations
    async savePrompts() {
        try {
            // Convert prompts to the format expected by the popup
            const promptsForStorage = this.prompts.map(p => p.text);
            await browser.storage.local.set({ prompts: promptsForStorage });
        } catch (error) {
            console.error('Failed to save prompts:', error);
            this.showNotification('Failed to save prompts', 'error');
        }
    }

    async loadPrompts() {
        try {
            const result = await browser.storage.local.get(['prompts']);
            const storedPrompts = result.prompts || [];

            // Convert stored prompts to our format
            this.prompts = storedPrompts.map((text, index) => ({
                id: Date.now() + index,
                text: text,
                created: new Date().toISOString(),
                modified: new Date().toISOString()
            }));

            this.renderPrompts();
        } catch (error) {
            console.error('Failed to load prompts:', error);
            this.showNotification('Failed to load prompts', 'error');
        }
    }

    // UI Rendering
    renderPrompts() {
        this.updatePromptCount();

        if (this.prompts.length === 0) {
            this.promptsList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📝</div>
                    <h3>No prompts saved yet</h3>
                    <p>Add your first prompt above to get started with automation.</p>
                </div>
            `;
            return;
        }

        const html = this.prompts.map((prompt, index) => this.createPromptItemHTML(prompt, index)).join('');
        this.promptsList.innerHTML = html;

        // Setup drag and drop for each item
        document.querySelectorAll('.prompt-item').forEach((item, index) => {
            this.setupDragAndDrop(item, index);
            this.setupPromptItemEvents(item, index);
        });

        this.updateSelectionUI();
    }

    createPromptItemHTML(prompt, index) {
        const isSelected = this.selectedPrompts.has(index);
        return `
            <div class="prompt-item ${isSelected ? 'selected' : ''}" data-index="${index}">
                <div class="prompt-header">
                    <input type="checkbox" class="prompt-checkbox" ${isSelected ? 'checked' : ''}>
                    <div class="drag-handle" title="Drag to reorder">⋮⋮</div>
                    <span class="prompt-number">${index + 1}</span>
                    <div class="prompt-preview collapsed" title="Click to expand">
                        ${this.escapeHtml(prompt.text)}
                    </div>
                    <div class="prompt-actions">
                        <button class="btn btn-edit" data-action="edit" title="Edit prompt">
                            <span class="btn-icon">✏️</span>
                        </button>
                        <button class="btn btn-delete" data-action="delete" title="Delete prompt">
                            <span class="btn-icon">🗑️</span>
                        </button>
                    </div>
                </div>
                <div class="prompt-content">
                    <div class="prompt-text">${this.escapeHtml(prompt.text)}</div>
                </div>
            </div>
        `;
    }

    setupPromptItemEvents(item, index) {
        const checkbox = item.querySelector('.prompt-checkbox');
        const preview = item.querySelector('.prompt-preview');
        const content = item.querySelector('.prompt-content');
        const editBtn = item.querySelector('[data-action="edit"]');
        const deleteBtn = item.querySelector('[data-action="delete"]');

        // Checkbox events
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            this.togglePromptSelection(index);
        });

        // Preview click to expand/collapse
        preview.addEventListener('click', () => {
            const isExpanded = content.classList.contains('expanded');
            content.classList.toggle('expanded', !isExpanded);
            preview.classList.toggle('collapsed', isExpanded);
        });

        // Action buttons
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.editPrompt(index);
        });

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deletePrompt(index);
        });
    }

    updatePromptCount() {
        const count = this.prompts.length;
        this.promptCount.textContent = `${count} prompt${count !== 1 ? 's' : ''}`;
    }

    // Navigation
    goBackToPopup() {
        // Close the current tab and focus on the extension popup
        window.close();
    }

    // Utility methods
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showNotification(message, type = 'info') {
        // Create a simple notification toast
        const notification = document.createElement('div');
        notification.className = `notification notification--${type}`;
        notification.textContent = message;

        // Add styles
        Object.assign(notification.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '12px 20px',
            borderRadius: '8px',
            color: 'white',
            fontWeight: '500',
            zIndex: '10000',
            animation: 'slideInRight 0.3s ease-out',
            minWidth: '200px',
            maxWidth: '400px'
        });

        // Set background color based on type
        const colors = {
            success: '#10b981',
            error: '#ef4444',
            info: '#3b82f6',
            warning: '#f59e0b'
        };
        notification.style.backgroundColor = colors[type] || colors.info;

        document.body.appendChild(notification);

        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease-in forwards';
            setTimeout(() => {
                if (document.body.contains(notification)) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
}

// Add notification animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialize the prompt manager when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new PromptManager();
});
