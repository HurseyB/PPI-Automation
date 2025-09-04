/**
 * Patch for Enhanced Perplexity AI Automator - Minimal background.js add-on
 * Adds document update messaging for the new doc management UI (non-invasive).
 * Do NOT change any logic outside this patch block!
 */

// This block is appended anywhere in background.js
function notifyDocumentUpdated(status, message) {
    browser.runtime.sendMessage({
        type: 'document-updated',
        data: {
            status,
            message,
        }
    });
}
// Usage example: notifyDocumentUpdated('ready', 'Document updated!');
// Hook this from popup.js only as needed.

// The rest of background.js is unchanged; document generation and file writing
// is handled solely in the popup context using the DocumentManager.
