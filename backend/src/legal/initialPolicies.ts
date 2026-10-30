import type { PolicyType } from '../models/PolicyVersion.js'

export type PolicySection = { id: string; heading: string; paragraphs: string[]; bullets?: string[] }
export type PolicyDraft = {
  policyType: PolicyType
  version: string
  title: string
  summary: string
  changeSummary: string
  sections: PolicySection[]
  isDraft: boolean
  requiresReacceptance: boolean
}

// Text in [square brackets] is a placeholder the owner must replace (or a decision the owner must confirm)
// before launch. Nothing in brackets is a real fact. Changing text means publishing a NEW version
// (see docs/privacy-and-consent.md); published versions are never edited.
const DRAFT_NOTICE = 'DRAFT: this text was prepared from how the application actually works and has not been reviewed by the platform owner or by Philippine legal counsel. Items in [square brackets] must be completed or confirmed before public launch.'

export const initialPolicies: PolicyDraft[] = [
  {
    policyType: 'terms',
    version: '1.0-draft',
    title: 'Terms of Service',
    summary: 'These are the rules for using smarTindahan, a tool that helps sari-sari store owners keep track of sales, stock, prices, suppliers and expenses. You are responsible for your account and your records; we are responsible for running the service with reasonable care.',
    changeSummary: 'First version of the Terms of Service.',
    isDraft: true,
    requiresReacceptance: true,
    sections: [
      { id: 'draft', heading: 'Draft status', paragraphs: [DRAFT_NOTICE] },
      { id: 'what-it-is', heading: '1. What smarTindahan does', paragraphs: [
        'smarTindahan is a web application for small stores. It lets you record sales at a point-of-sale screen, keep products, prices and stock levels, record suppliers, customers and expenses, and view sales and profit summaries.',
        'The service is operated by [operator legal name — to be provided by the owner] ("we", "us").',
      ] },
      { id: 'who-may-use', heading: '2. Who may use it', paragraphs: [
        'You may create an account only if you are at least [minimum age — owner and counsel to confirm] and you are authorised to run the store you register. Do not register on behalf of someone else without their permission.',
        'You must give accurate registration details, including a working email address that you control.',
      ] },
      { id: 'your-account', heading: '3. Your account and credentials', paragraphs: [
        'You are responsible for what happens under your account. Choose a strong password, keep it private, and do not share it. Tell us promptly if you think someone else has access.',
        'We protect passwords by storing only a salted hash. We will never ask you for your password by email or chat.',
      ] },
      { id: 'acceptable-use', heading: '4. Acceptable use', paragraphs: ['You agree not to:'], bullets: [
        'access, or try to access, another store\'s data or any account that is not yours;',
        'probe, scan, overload, or try to bypass the security of the service, or interfere with other users;',
        'use the service for fraud, to record sales or stock you know to be false in order to mislead others, or for any unlawful purpose;',
        'upload malicious code or send automated requests that disrupt the service;',
        'resell or sublicense the service without our written permission.',
      ] },
      { id: 'your-data', heading: '5. Your business data', paragraphs: [
        'The product, price, stock, supplier, customer, expense and sales information you enter remains yours. You give us permission to store and process it only to provide the service to you, to keep it secure, and as described in the Privacy Policy.',
        'If you enter other people\'s information (for example a customer\'s name and mobile number), you are responsible for having a proper reason to record it and for keeping it accurate.',
        'You are responsible for keeping product, stock, supplier and transaction records accurate and for correcting mistakes.',
      ] },
      { id: 'accuracy', heading: '6. Reports and calculations are management tools', paragraphs: [
        'Totals, cost, profit and margin figures are calculated from the prices and quantities you and your staff enter. They are estimates for managing your store, not accounting, audit, tax or legal records.',
        'Please check them against your actual cash, stock counts, receipts and books. We do not guarantee that the figures are error-free, that they will match your accounting, that they satisfy any tax or regulatory requirement, or that using the service will increase your profits.',
      ] },
      { id: 'availability', heading: '7. Availability and maintenance', paragraphs: [
        'We try to keep the service available, but we do not promise it will be uninterrupted or error-free. We may carry out maintenance, make changes, or have outages caused by our providers or by events outside our control.',
        'Keep your own backup of important records. You can download a copy of your data from Settings at any time.',
      ] },
      { id: 'reporting', heading: '8. Reporting problems and security incidents', paragraphs: [
        'If you find a bug, an incorrect calculation, or a security problem (for example you can see data that is not yours), please report it at [support / security contact email — to be provided by the owner] and do not exploit it. We will review reports in good faith.',
      ] },
      { id: 'suspension', heading: '9. Suspension and termination', paragraphs: [
        'We may suspend or close an account if it is used in breach of these Terms, creates a security risk, or if required by law. Where reasonable we will tell you why and give you a chance to export your data.',
        'You may stop using the service and close your account at any time.',
      ] },
      { id: 'closing', heading: '10. Closing your account and deleting data', paragraphs: [
        'You can ask to close your account in Settings → Privacy and security. Your account is scheduled for deletion after a waiting period (currently 14 days by default [owner to confirm]) during which you can cancel. After that, your account and store records are permanently deleted from our live systems. Copies in provider backups may remain until those backups expire. Some limited security and consent records are kept as described in the Privacy Policy.',
        'Closing your account does not cancel your own legal duties to keep business records (for example for tax purposes). Download your data first if you need it.',
      ] },
      { id: 'changes', heading: '11. Changes to these Terms', paragraphs: [
        'When we change these Terms we publish a new version and keep the old one available. If the change needs your agreement, you will see a notice the next time you sign in, with a link to the full text, and you must choose to accept it to continue using the store features. We do not treat continued use as acceptance. You can still download your data or request deletion without accepting.',
      ] },
      { id: 'liability', heading: '12. Limits of our responsibility', paragraphs: [
        'The service is provided "as is". To the extent the law allows, we are not responsible for losses that result from mistakes in the information you enter, from your use of the figures as accounting records, from interruptions beyond our reasonable control, or for lost profits. Nothing in these Terms limits rights you have under Philippine law that cannot be limited. [Liability wording — counsel to review.]',
      ] },
      { id: 'law', heading: '13. Governing law and disputes', paragraphs: [
        'These Terms are intended to be governed by the laws of the Republic of the Philippines. We would like to resolve problems informally first; contact us using the details below. [Dispute-resolution procedure and venue — counsel to confirm.]',
      ] },
      { id: 'contact', heading: '14. Contact', paragraphs: [
        'Operator: [operator legal name — to be provided by the owner]',
        'Address: [business address — to be provided by the owner]',
        'Email for questions and complaints: [support email — to be provided by the owner]',
      ] },
    ],
  },
  {
    policyType: 'privacy',
    version: '1.0-draft',
    title: 'Privacy Policy',
    summary: 'This explains what personal information smarTindahan collects, why, who handles it, how long we keep it and how you can see, correct, export or delete it. We do not sell personal information and we do not send marketing messages.',
    changeSummary: 'First version of the Privacy Policy.',
    isDraft: true,
    requiresReacceptance: true,
    sections: [
      { id: 'draft', heading: 'Draft status', paragraphs: [DRAFT_NOTICE, 'This policy is written with the Philippine Data Privacy Act of 2012 (Republic Act No. 10173) in mind. Publishing it does not mean the service is certified or guaranteed to comply with every applicable law.'] },
      { id: 'who', heading: '1. Who is responsible', paragraphs: [
        'The operator of smarTindahan, [operator legal name — to be provided by the owner], decides how the personal information of account holders is used and is the "personal information controller" for it.',
        'For information that a store owner enters about their own customers or suppliers, the store owner decides why it is recorded; we store and process it on the store owner\'s behalf to run the service.',
        'Privacy contact: [privacy contact email — to be provided by the owner]. Data Protection Officer: [name and contact, or a statement that none is required — owner and counsel to confirm].',
      ] },
      { id: 'collect', heading: '2. What we collect', paragraphs: ['Only the following is collected by the application:'], bullets: [
        'Account details: first and last name, email address, mobile number, store name and store address.',
        'Sign-in and security data: a salted hash of your password (never the password itself), whether your email is verified, failed-login count and lock time, last sign-in time, and short-lived verification and password-reset codes (stored hashed).',
        'Store records you enter: products (name, category, barcode, brand, supplier name, cost and selling prices, stock and minimum stock), inventory movements with reasons and notes, sales (items, quantities, prices, cost, totals, estimated profit, payment method, transaction code, who recorded it), expenses, suppliers (name, contact number, address) and customers (name, mobile number, address, credit limit, balance).',
        'Agreement records: which version of the Terms of Service you accepted and which version of this notice you acknowledged, and when.',
        'Audit and security logs: events such as sign-in success or failure, password changes, email verification, data exports and deletion requests, important stock and record changes, with the time, your account, and the IP address and browser (user-agent) of the request.',
        'Privacy and support requests you submit through the app, including the message you write.',
        'Technical data needed to operate the service: our hosting provider processes standard request data (such as IP address and time) in its infrastructure logs, and Vercel Web Analytics records page views (page address, referrer, browser, device type, approximate country).',
      ] },
      { id: 'browser', heading: '3. Cookies, local storage and your browser', paragraphs: [
        'The app does not set cookies. It stores a session token and your display preferences (such as theme) in your browser\'s local storage so you stay signed in; signing out removes the token from your device and cancels it on the server.',
        'The app does not include advertising trackers. When it is served from Vercel it uses Vercel Web Analytics to count page visits. This records which page was viewed and basic technical details such as referrer, browser, device type and approximate country, without setting cookies and without identifying you personally across sites. [Confirm against the current Vercel documentation and your analytics settings.] It only runs on the Vercel-hosted site, and it does not read what you type or the contents of your store records.',
        'Scanning a barcode uses your camera inside your browser. Camera images are not uploaded to us. If you use the optional product-name lookup, the barcode number is sent from your browser to Open Food Facts (a third-party public database), which can see your IP address.',
      ] },
      { id: 'use', heading: '4. Why we use it', paragraphs: ['We use personal information to:'], bullets: [
        'create and manage your account and let you sign in;',
        'provide inventory, sales, purchase-related records, expenses, supplier and customer records and the summaries calculated from them;',
        'send essential service emails: verification codes and password-reset codes (we send no marketing or promotional messages);',
        'protect accounts and the service, detect and prevent abuse, and investigate security incidents;',
        'respond to requests and complaints you send us;',
        'keep records of agreements and meet legal obligations where they apply.',
      ], },
      { id: 'basis', heading: '5. Legal grounds', paragraphs: [
        'We rely on the grounds that fit each purpose, not on consent for everything: performing the service you asked for, our legitimate interest in keeping the service secure, compliance with legal obligations, and your consent only where we ask for it. Accepting the Terms of Service is a contract step; acknowledging this notice records that you were shown it. [The exact lawful basis for each processing activity — counsel to confirm.]',
      ] },
      { id: 'sharing', heading: '6. Who we share it with', paragraphs: [
        'We do not sell personal information and do not share it for advertising. We use service providers who process data for us, only to run the service:',
      ], bullets: [
        'Database hosting: MongoDB Atlas (MongoDB, Inc.). Region: [database region — owner to confirm].',
        'Application hosting and visit statistics: Vercel Inc. (including Vercel Web Analytics). Region: [hosting region — owner to confirm]. The public web pages may alternatively be served by GitHub Pages (GitHub, Inc.) if the owner enables that.',
        'Email delivery for verification and reset codes: [Resend or the SMTP provider the owner configures — owner to confirm].',
        'Barcode lookup (optional, started by you): Open Food Facts.',
      ] },
      { id: 'sharing-law', heading: 'Disclosures required by law', paragraphs: ['We may disclose information if a lawful order or legal obligation requires it, or when needed to protect the safety and security of users or the service. We will not promise that data is never disclosed under any circumstances.'] },
      { id: 'abroad', heading: '7. Transfers outside the Philippines', paragraphs: [
        'Our providers may store or process data in other countries. [Locations, safeguards and any required agreements — owner and counsel to confirm before launch.]',
      ] },
      { id: 'retention', heading: '8. How long we keep information', paragraphs: [
        'These are the rules the application follows today, and the points the owner still has to decide.',
      ], bullets: [
        'Active accounts: kept while the account is open.',
        'Verification and password-reset codes: expire after 5 minutes and are removed automatically by the database after expiry; they are stored hashed.',
        'Signed-out session identifiers: kept only until the session would have expired anyway.',
        'Closed accounts: when you request deletion the account is scheduled for permanent deletion after a waiting period (14 days by default). Then your account record, store records, and privacy requests are removed from the live database.',
        'Agreement records and audit/security logs: kept after account deletion so we can show what was agreed and investigate abuse, containing no password or code. [Retention period — owner to decide; a proposal is 24 months. The application does not yet delete these automatically.]',
        'Backups: the database provider keeps backups on its own schedule, so deleted data can remain in backups until they expire. [Backup retention period — owner to confirm with the provider settings.]',
        'Legal duties: some laws may require records to be kept for longer. [Applicable retention requirements — counsel to confirm.]',
      ] },
      { id: 'security', heading: '9. How we protect information', paragraphs: [
        'Connections use HTTPS. Passwords are hashed. Access to store data is checked on the server for every request, so one store cannot read another store\'s records. Sign-in, registration and code checks are rate-limited, accounts lock temporarily after repeated failures, and security events are logged. No system is perfectly secure; we cannot promise that unauthorised access will never occur. If a personal-data breach affects you we will assess it and notify affected users and the National Privacy Commission where the law requires. [Breach-notification procedure — owner and counsel to confirm.]',
      ] },
      { id: 'rights', heading: '10. Your rights and how to use them', paragraphs: ['You can ask to see, correct, export or delete your personal information, object to or ask questions about how it is used, and complain. In the app (Settings → Privacy and security):'], bullets: [
        'Access / copy: "Download my data" gives you a file with your account details, agreement records, store records and security events.',
        'Correction: edit your name, mobile number, store name and store address directly. For anything else send a correction request.',
        'Deletion: request account deletion (it asks for your password and has a waiting period you can cancel).',
        'Withdrawing consent: we do not ask for optional consent today, so there is nothing optional to withdraw. You may close your account at any time.',
        'Questions and complaints: send a privacy request with your message. We aim to respond within [response time — owner to decide]. You may also complain to the National Privacy Commission.',
      ] },
      { id: 'marketing', heading: '11. Marketing', paragraphs: ['smarTindahan does not send marketing or promotional messages. If that changes we will ask for separate, optional consent first. Security and account emails are not marketing.'] },
      { id: 'children', heading: '12. Children', paragraphs: ['The service is for store operators and is not directed to children. [Minimum age — owner and counsel to confirm.]'] },
      { id: 'changes', heading: '13. Changes to this notice', paragraphs: ['When we change this notice we publish a new version, keep the old one, and ask you to acknowledge the new one. Acknowledging a notice is not the same as agreeing to the Terms of Service, and it does not give us extra permission to use your data.'] },
      { id: 'contact', heading: '14. Contact', paragraphs: [
        'Operator: [operator legal name — to be provided by the owner]',
        'Privacy contact email: [privacy contact email — to be provided by the owner]',
        'Postal address: [business address — to be provided by the owner]',
      ] },
    ],
  },
]
