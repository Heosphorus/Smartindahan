import './PolicyModal.css'

export type PolicyKind = 'privacy' | 'terms' | 'cookies' | 'security' | 'retention' | 'breach' | 'access' | 'audit'

const policyContent: Record<PolicyKind, { title: string; summary: string; sections: Array<{ heading: string; body: string }> }> = {
  privacy: {
    title: 'Privacy Policy',
    summary: 'SariSmart collects only the information required to operate store accounts, verify identities, and support daily sales workflows.',
    sections: [
      { heading: 'Information we collect', body: 'We collect account data such as your name, email, phone number, store name, and address so you can create a secure store account and access your dashboard. We also store operational data such as inventory, customer balances, supplier records, sales, and transactions associated with your store.' },
      { heading: 'How we use data', body: 'We use your data to authenticate you, maintain your store records, send verification and reset codes, support customer and inventory workflows, and protect the security of the system through audit logging and account protection measures.' },
      { heading: 'Data sharing', body: 'We do not sell personal data. We may share information only with trusted service providers needed to deliver email delivery, hosting, monitoring, or security operations, and only as required to maintain the service.' },
      { heading: 'Your rights', body: 'You may request access to your account information, ask for corrections, or request that certain personal data be removed in accordance with the applicable laws and the limitations of the service.' },
    ],
  },
  terms: {
    title: 'Terms of Service',
    summary: 'These terms govern your use of SariSmart and the obligations of both the user and the service provider.',
    sections: [
      { heading: 'Account responsibility', body: 'You are responsible for the confidentiality of your account credentials and for the accuracy of the information you provide when registering a store account.' },
      { heading: 'Permitted use', body: 'SariSmart may be used for lawful store operations, product tracking, customer management, and sales reporting. You may not use the platform to engage in fraud, data theft, abusive activity, or other prohibited behavior.' },
      { heading: 'Service availability', body: 'We work to maintain uptime and appropriate security controls, but we do not guarantee uninterrupted availability or error-free service. We may suspend access as needed to protect the platform or investigate security concerns.' },
      { heading: 'Limitation of liability', body: 'SariSmart is provided on an as-is basis. We do not guarantee business outcomes, and our liability is limited to the extent permitted by the applicable law.' },
    ],
  },
  cookies: {
    title: 'Cookie Policy',
    summary: 'SariSmart uses minimal cookies and local browser storage to support secure sessions and application functionality.',
    sections: [
      { heading: 'Session cookies', body: 'We use a secure session token so authenticated users remain signed in during an active session. This token is kept in local storage or browser memory and is required for protected requests.' },
      { heading: 'Preference storage', body: 'The app may store non-sensitive user preferences or local UI state in the browser to improve usability and maintain a smoother experience.' },
      { heading: 'Managing cookies', body: 'Users may clear browser cookies or local storage if they wish to sign out or reset application preferences. Disabling session storage may limit access to protected features.' },
    ],
  },
  security: {
    title: 'Security Policy',
    summary: 'The platform protects user accounts and store data using layered controls, encryption, and access restrictions.',
    sections: [
      { heading: 'Passwords and identity', body: 'Passwords are hashed before storage, and email verification is required before a user can access the system. Login attempts are rate-limited and user accounts are temporarily locked after repeated failures.' },
      { heading: 'Transmission security', body: 'Authentication tokens are signed using server-side secret values, and the API enforces secure response headers such as X-Frame-Options, X-Content-Type-Options, and other hardening controls.' },
      { heading: 'Operational security', body: 'The backend validates user access, restricts cross-origin requests, and keeps security-relevant activity in audit logs for review and investigation.' },
    ],
  },
  retention: {
    title: 'Data Retention Policy',
    summary: 'SariSmart retains operational and account data only for as long as needed to provide services, satisfy legal obligations, or support legitimate business operations.',
    sections: [
      { heading: 'Operational data', body: 'Store records, sales, inventory activity, customer balances, and supplier documents are retained while the account remains active and for a reasonable period afterward when required to support reporting or compliance needs.' },
      { heading: 'Account lifecycle', body: 'If an account is deactivated or deleted, associated personal data is removed or archived in line with approved retention rules and any legal obligations that apply.' },
      { heading: 'Review', body: 'Retention periods are reviewed periodically so data is not kept beyond the necessity of providing the service or meeting obligations.' },
    ],
  },
  breach: {
    title: 'Data Breach Response Policy',
    summary: 'SariSmart is designed to detect, contain, assess, and respond to security incidents in a timely and documented manner.',
    sections: [
      { heading: 'Detection and notification', body: 'Unauthorized access patterns, suspicious activity, and abnormal authentication behavior are monitored through application logs and audit records. We aim to assess potential exposure quickly and notify affected stakeholders when required.' },
      { heading: 'Containment', body: 'The system may disable affected accounts, revoke sessions, rotate credentials, and isolate suspicious activity as part of incident response.' },
      { heading: 'Review', body: 'After any confirmed incident, the team reviews root cause, updates controls, and documents corrective actions to reduce recurrence.' },
    ],
  },
  access: {
    title: 'Access Control Policy',
    summary: 'Access to the app and store functions is granted on the basis of role, authentication status, and operational need.',
    sections: [
      { heading: 'Roles', body: 'The system separates administrative, owner, manager, and cashier responsibilities through structured role checks and route protections.' },
      { heading: 'Authorization', body: 'Authenticated requests are verified through validated JWT tokens and are denied unless the user has the required permissions for the endpoint or action.' },
      { heading: 'Review', body: 'Access rights are reviewed when job roles change or when a store account is updated to ensure least-privilege access remains in place.' },
    ],
  },
  audit: {
    title: 'Audit Logging Policy',
    summary: 'Security-relevant events are recorded to support accountability, troubleshooting, and forensic review.',
    sections: [
      { heading: 'What is logged', body: 'We log authentication events, verification activities, password events, account changes, and other security-relevant actions with timestamps, user identifiers, IP address, and user-agent metadata when available.' },
      { heading: 'How it is used', body: 'Logs help detect misuse, investigate account incidents, validate activity during support requests, and maintain a compliance trail for the platform.' },
      { heading: 'Access to logs', body: 'Audit logs are restricted to authorized roles and are not exposed broadly to ordinary users. Only system administrators or authorized staff may review sensitive operational details.' },
    ],
  },
}

export function PolicyModal({ kind, onClose }: { kind: PolicyKind; onClose: () => void }) {
  const content = policyContent[kind]

  return (
    <div className="policy-modal-backdrop" onClick={onClose}>
      <div className="policy-modal" onClick={(event) => event.stopPropagation()}>
        <div className="policy-modal-header">
          <div>
            <p className="policy-modal-label">SariSmart policy</p>
            <h3>{content.title}</h3>
          </div>
          <button type="button" className="policy-close" aria-label="Close policy" onClick={onClose}>×</button>
        </div>
        <p className="policy-summary">{content.summary}</p>
        <div className="policy-sections">
          {content.sections.map((section) => (
            <section key={section.heading}>
              <h4>{section.heading}</h4>
              <p>{section.body}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
