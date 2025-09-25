/**
 * EmailJS Configuration for Perplexity AI Automator
 * Using SMTP Email Service for SMS Text Messages
 *
 * SETUP INSTRUCTIONS:
 * 1. ✅ EmailJS account created
 * 2. ✅ SMTP email service configured (service_x2ipdnp)
 * 3. ✅ Email template created with these variables:
 *    - {{to_email}} - Recipient email address
 *    - {{company_name}} - The company name entered by user
 *    - {{from_name}} - Sender name
 * 4. Replace the remaining placeholders below
 */

// EmailJS configuration values
const EMAILJS_CONFIG = {
    // ✅ Your EmailJS Service ID (SMTP service)
    serviceId: 'service_id',

    // TODO: Replace with your EmailJS Template ID after creating template
    templateId: 'template_id',

    // TODO: Replace with your EmailJS Public Key from Account -> General
    publicKey: 'public_key'
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EMAILJS_CONFIG;
} else if (typeof window !== 'undefined') {
    window.EMAILJS_CONFIG = EMAILJS_CONFIG;
}

/**
 * SMS-FRIENDLY EMAIL TEMPLATE FOR EMAILJS:
 *
 * Create this template in your EmailJS dashboard:
 *
 * Template Name: "Perplexity Automator SMS Notification"
 *
 * Subject: Automation Complete
 *
 * Message Body (Plain Text):
 * Business Analyses for {{company_name}} is now complete and will be downloaded to your computer promptly.
 *
 * Template Variables Used:
 * - {{to_email}} - Recipient email address ([phone]@vtext.com)
 * - {{company_name}} - The company name entered by the user
 * - {{from_name}} - Sender name (Perplexity AI Automator)
 *
 * This creates a simple, SMS-friendly message perfect for Verizon text messaging.
 *
 * NOTE ABOUT EMAILJS FOOTER:
 * EmailJS adds a small footer to free accounts. To remove it:
 * 1. Upgrade to EmailJS paid plan ($15/month for 2000 emails), OR
 * 2. The footer is usually minimal for SMS and may not affect functionality
 */