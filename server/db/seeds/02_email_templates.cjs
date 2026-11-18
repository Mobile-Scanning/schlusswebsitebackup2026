/**
 * Default email templates (reference data). Inserted only if missing – admin edits are never overwritten.
 * More templates are added by later phases (trials, licences, partners, support…).
 */
const TEMPLATES = [
  {
    key: 'welcome_customer',
    name: 'Customer registration – welcome',
    subject: 'Welcome to SCHLUSS',
    variables: ['name', 'appUrl'],
    body_html:
      '<h1 style="font-size:22px;margin:0 0 16px;">Welcome, {{name}}</h1>' +
      '<p>Your SCHLUSS account is ready. From your dashboard you can download products, manage trials and licences, open learning material and ask for support.</p>' +
      '<p style="margin:28px 0;"><a href="{{appUrl}}/account" style="background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;">Go to my account</a></p>' +
      '<p style="color:#5B6475;font-size:13px;">If you did not create this account, please reply to this email.</p>',
  },
  {
    key: 'password_reset',
    name: 'Password reset',
    subject: 'Reset your SCHLUSS password',
    variables: ['name', 'resetUrl', 'minutes'],
    body_html:
      '<h1 style="font-size:22px;margin:0 0 16px;">Reset your password</h1>' +
      '<p>Hi {{name}}, we received a request to reset your SCHLUSS password. This link works once and expires in {{minutes}} minutes.</p>' +
      '<p style="margin:28px 0;"><a href="{{resetUrl}}" style="background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;">Choose a new password</a></p>' +
      '<p style="color:#5B6475;font-size:13px;">If you did not ask for this, you can ignore this email – your password stays the same.</p>',
  },
  {
    key: "demo_request_ack",
    name: "Demo request \u2013 confirmation to customer",
    subject: "We received your SCHLUSS demo request ({{reference}})",
    variables: ["name", "reference", "product"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">Thanks, {{name}}</h1><p>We've received your request for a demonstration of <strong>{{product}}</strong>. A member of our team will contact you to arrange a time.</p><p>Your reference: <strong>{{reference}}</strong></p><p style=\"color:#5B6475;font-size:13px;\">You're receiving this because you asked for a demo on schluss.co.za.</p>",
  },
  {
    key: "demo_request_admin",
    name: "Demo request \u2013 notification to SCHLUSS team",
    subject: "New demo request {{reference}} \u2013 {{product}}",
    variables: ["name", "reference", "product", "email", "cellphone", "company", "type", "message"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">New demo request</h1><p><strong>{{reference}}</strong> \u00b7 {{product}}</p><p>{{name}} ({{company}})<br>{{email}} \u00b7 {{cellphone}}<br>Preferred: {{type}}</p><p>{{message}}</p><p style=\"margin:28px 0;\"><a href=\"{{appUrl}}/admin/demo-requests\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Open demo requests</a></p>",
  },
  {
    key: "demo_scheduled",
    name: "Demo scheduled \u2013 confirmation to customer",
    subject: "Your SCHLUSS demo is booked",
    variables: ["name", "reference", "product", "when"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">Your demo is booked</h1><p>Hi {{name}}, your demonstration of <strong>{{product}}</strong> is scheduled for <strong>{{when}}</strong> (South African time).</p><p>Reference: {{reference}}. If this time doesn't suit you, simply reply to this email.</p>",
  },
  {
    key: "partner_application_ack",
    name: "Partner application \u2013 confirmation",
    subject: "We received your SCHLUSS partner application ({{reference}})",
    variables: ["name", "business", "reference"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">Application received</h1><p>Hi {{name}}, thank you for applying to become a SCHLUSS business partner on behalf of <strong>{{business}}</strong>.</p><p>Your application reference is <strong>{{reference}}</strong>. Our team will review it and let you know the outcome by email.</p>",
  },
  {
    key: "partner_application_admin",
    name: "Partner application \u2013 notification to SCHLUSS team",
    subject: "New partner application {{reference}} \u2013 {{business}}",
    variables: ["name", "business", "reference", "email", "cellphone"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">New partner application</h1><p><strong>{{business}}</strong> ({{reference}})<br>{{name}} \u00b7 {{email}} \u00b7 {{cellphone}}</p><p style=\"margin:28px 0;\"><a href=\"{{appUrl}}/admin/partners\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Review applications</a></p>",
  },
  {
    key: "partner_approved",
    name: "Partner approved \u2013 welcome & set password",
    subject: "Welcome to the SCHLUSS partner network",
    variables: ["name", "business", "reference", "setPasswordUrl"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">You're approved, {{name}}</h1><p><strong>{{business}}</strong> is now an approved SCHLUSS business partner. Set your password to open your partner portal:</p><p style=\"margin:28px 0;\"><a href=\"{{setPasswordUrl}}\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Set my password</a></p><p style=\"color:#5B6475;font-size:13px;\">This link works once and expires in 7 days. If it expires, use \"Forgot password\" on the sign-in page.</p>",
  },
  {
    key: "partner_reactivated",
    name: "Partner access active",
    subject: "Your SCHLUSS partner access is active",
    variables: ["name", "business", "loginUrl"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">Partner access active</h1><p>Hi {{name}}, partner access for <strong>{{business}}</strong> is active.</p><p style=\"margin:28px 0;\"><a href=\"{{loginUrl}}\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Sign in</a></p>",
  },
  {
    key: "partner_rejected",
    name: "Partner application \u2013 not approved",
    subject: "Your SCHLUSS partner application",
    variables: ["name", "business", "reference"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">About your application</h1><p>Hi {{name}}, thank you for your interest in partnering with SCHLUSS. After review, we're unable to approve the application for <strong>{{business}}</strong> ({{reference}}) at this time.</p><p>If you'd like to discuss this, simply reply to this email.</p>",
  },
  {
    key: "contact_ack",
    name: "Contact form \u2013 confirmation",
    subject: "We received your message ({{reference}})",
    variables: ["name", "reference", "subject"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">Thanks for getting in touch</h1><p>Hi {{name}}, we've received your message about \u201c{{subject}}\u201d and will reply as soon as we can.</p><p>Reference: <strong>{{reference}}</strong></p>",
  },
  {
    key: "contact_admin",
    name: "Contact form \u2013 notification to SCHLUSS team",
    subject: "Website enquiry {{reference}}: {{subject}}",
    variables: ["name", "reference", "subject", "email", "message"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">New website enquiry</h1><p><strong>{{subject}}</strong> ({{reference}})<br>{{name}} \u00b7 {{email}}</p><p>{{message}}</p><p style=\"margin:28px 0;\"><a href=\"{{appUrl}}/admin/enquiries\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Open enquiries</a></p>",
  },
  {
    key: "trial_started",
    name: "Free trial \u2013 started",
    subject: "Your {{product}} free trial has started",
    variables: ["name", "product", "days", "ends", "licenceKey", "productUrl"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">Your free trial is active</h1><p>Hi {{name}}, your <strong>{{days}}-day</strong> free trial of <strong>{{product}}</strong> has started and runs until <strong>{{ends}}</strong>.</p><p>Trial licence: <strong>{{licenceKey}}</strong></p><p>Videos, guides and set-up help for {{product}} are on its product page and in your account.</p><p style=\"margin:28px 0;\"><a href=\"{{productUrl}}\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Open {{product}}</a></p>",
  },
  {
    key: "demo_downloaded",
    name: "Demo – download confirmation",
    subject: "Your {{product}} demo – next steps",
    variables: ["name", "product", "version", "days", "startRule", "setupUrl", "licenceKey"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">Thanks for downloading {{product}}</h1><p>Hi {{name}}, you downloaded the <strong>{{product}} {{version}}</strong> demo.</p><p>Your demo runs for <strong>{{days}} days</strong> {{startRule}}.</p><p>Demo licence: <strong>{{licenceKey}}</strong> (you may need it when activating).</p><p>Your step-by-step installation and setup guide is in your account.</p><p style=\"margin:28px 0;\"><a href=\"{{setupUrl}}\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Open my setup guide</a></p>",
  },
  {
    key: "demo_expiring",
    name: "Demo – expiry reminder to customer",
    subject: "{{headline}}",
    variables: ["name", "product", "headline", "expires", "productUrl"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">{{headline}}</h1><p>Hi {{name}}, your <strong>{{product}}</strong> demo {{expires}}.</p><p>If you would like to keep using {{product}}, our team will gladly talk you through the available packages – just reply to this email or chat with us on the website.</p><p style=\"margin:28px 0;\"><a href=\"{{productUrl}}\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Talk to SCHLUSS about packages</a></p>",
  },
  {
    key: "demo_expiring_admin",
    name: "Demo – expiry alert to administrators",
    subject: "Demo {{when}}: {{customer}} · {{product}}",
    variables: ["when", "customer", "company", "product", "expires", "days", "email", "cellphone", "status", "link"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">Demo {{when}}</h1><p><strong>{{customer}}</strong> ({{company}}) · {{product}}</p><p>Expires: <strong>{{expires}}</strong> · Days remaining: <strong>{{days}}</strong> · Status: {{status}}</p><p>{{email}} · {{cellphone}}</p><p style=\"margin:28px 0;\"><a href=\"{{link}}\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Open the demo record</a></p>",
  },
  {
    key: "support_reply",
    name: "Support chat – reply to customer",
    subject: "SCHLUSS replied to your message ({{reference}})",
    variables: ["name", "reference", "preview", "link"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">You have a reply from SCHLUSS</h1><p>Hi {{name}}, our team replied to your conversation <strong>{{reference}}</strong>:</p><blockquote style=\"margin:0;padding:12px 16px;border-left:3px solid #3282F6;background:#F4F7FB;\">{{preview}}</blockquote><p style=\"margin:28px 0;\"><a href=\"{{link}}\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Read and reply</a></p>",
  },
  {
    key: "support_new_admin",
    name: "Support chat – new message alert",
    subject: "{{priority}}New message from {{name}} ({{reference}})",
    variables: ["name", "company", "reference", "category", "preview", "link", "priority"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">New support message</h1><p><strong>{{name}}</strong> {{company}} · {{category}} · {{reference}}</p><blockquote style=\"margin:0;padding:12px 16px;border-left:3px solid #3282F6;background:#F4F7FB;\">{{preview}}</blockquote><p style=\"margin:28px 0;\"><a href=\"{{link}}\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Open the Support Inbox</a></p>",
  },
  {
    key: "email_otp",
    name: "Email verification code",
    subject: "Your SCHLUSS verification code: {{code}}",
    variables: ["name", "code", "minutes"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">Verify your email address</h1><p>Hi {{name}}, use this code to finish creating your SCHLUSS account:</p><p style=\"font-size:32px;font-weight:bold;letter-spacing:8px;margin:20px 0;\">{{code}}</p><p>The code expires in {{minutes}} minutes and can be used once.</p><p style=\"color:#5B6475;font-size:13px;\">If you did not create an account, ignore this email – nothing will happen.</p>",
  },
  {
    key: "support_ack",
    name: "Support enquiry – received (to customer)",
    subject: "We received your message ({{reference}})",
    variables: ["name", "reference", "message", "link"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">Thanks – we have your message</h1><p>Hi {{name}}, your enquiry <strong>{{reference}}</strong> is with the SCHLUSS support team. We will reply in your chat and by email.</p><blockquote style=\"margin:0;padding:12px 16px;border-left:3px solid #3282F6;background:#F4F7FB;\">{{message}}</blockquote><p style=\"margin:28px 0;\"><a href=\"{{link}}\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Open the conversation</a></p>",
  },
  {
    key: "support_enquiry",
    name: "Support enquiry – to support department",
    subject: "[{{type}}] {{name}}{{company}} – {{subject}} ({{reference}})",
    variables: ["type", "name", "company", "email", "phone", "product", "subject", "message", "reference", "source", "link"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">New {{type}} enquiry</h1><p><strong>{{name}}</strong>{{company}}<br>{{email}} · {{phone}}<br>Product: {{product}} · Source: {{source}} · Ref {{reference}}</p><p><strong>{{subject}}</strong></p><blockquote style=\"margin:0;padding:12px 16px;border-left:3px solid #3282F6;background:#F4F7FB;\">{{message}}</blockquote><p style=\"margin:28px 0;\"><a href=\"{{link}}\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Open in the Support Inbox</a></p>",
  },
  {
    key: "sales_enquiry",
    name: "Purchase enquiry – to sales department",
    subject: "[Sales] {{kind}}: {{product}} – {{name}}{{company}} ({{reference}})",
    variables: ["kind", "name", "company", "email", "phone", "product", "quantity", "message", "reference", "source", "link"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">New purchase enquiry</h1><p><strong>{{name}}</strong>{{company}}<br>{{email}} · {{phone}}</p><p>Product: <strong>{{product}}</strong> · Licences: {{quantity}} · Type: {{kind}} · Source: {{source}} · Ref {{reference}}</p><blockquote style=\"margin:0;padding:12px 16px;border-left:3px solid #3282F6;background:#F4F7FB;\">{{message}}</blockquote><p style=\"margin:28px 0;\"><a href=\"{{link}}\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Open in Sales Enquiries</a></p>",
  },
  {
    key: "sales_ack",
    name: "Purchase enquiry – received (to customer)",
    subject: "Your purchase enquiry ({{reference}})",
    variables: ["name", "product", "reference"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">Thank you for your interest</h1><p>Hi {{name}}, our sales team has your enquiry about <strong>{{product}}</strong> (reference {{reference}}) and will contact you shortly with pricing and next steps.</p>",
  },
  {
    key: "lead_new",
    name: "Potential lead – demo nearing expiry (to support)",
    subject: "[Lead] Demo {{when}}: {{customer}}{{company}} · {{product}}",
    variables: ["when", "customer", "company", "email", "phone", "product", "expires", "days", "link"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">Potential lead – demo {{when}}</h1><p><strong>{{customer}}</strong>{{company}}<br>{{email}} · {{phone}}</p><p>Product: <strong>{{product}}</strong><br>Demo expires: <strong>{{expires}}</strong> · Days remaining: <strong>{{days}}</strong></p><p>Please contact the customer to offer help and find out whether they would like to continue.</p><p style=\"margin:28px 0;\"><a href=\"{{link}}\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Open the lead</a></p>",
  },
  {
    key: "system_alert",
    name: "System alert (to support)",
    subject: "[SCHLUSS alert] {{title}}",
    variables: ["title", "detail", "link"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">{{title}}</h1><p>{{detail}}</p><p style=\"margin:28px 0;\"><a href=\"{{link}}\" style=\"background:#3282F6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;\">Open the admin portal</a></p>",
  },
  {
    key: "email_test",
    name: "Email settings – test message",
    subject: "SCHLUSS test email to {{department}}",
    variables: ["department"],
    body_html: "<h1 style=\"font-size:22px;margin:0 0 16px;\">Test email</h1><p>This confirms that SCHLUSS can deliver email to the <strong>{{department}}</strong> address.</p>",
  },
];

exports.seed = async function (knex) {
  for (const t of TEMPLATES) {
    await knex('email_templates')
      .insert({ ...t, variables: JSON.stringify(t.variables) })
      .onConflict('key')
      .ignore();
  }
};
