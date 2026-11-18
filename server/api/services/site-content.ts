import { db } from '../db';

/**
 * Editable website copy. Each key is one section; the admin "Website content" screen edits these.
 * Values are plain text (rendered as text, never as HTML). Defaults are used until an admin saves a change.
 * Contact details default to empty – they are shown only once SCHLUSS fills them in.
 */
export const SITE_DEFAULTS = {
  banner: { enabled: false, text: '', link: '' },
  home: {
    heroEyebrow: 'The last piece of the puzzle',
    heroTitle: 'The last piece. / The complete picture.',
    heroSubtitle: 'Discover intelligent software solutions designed to simplify operations, connect systems and complete your business technology puzzle.',
    introTitle: 'One ecosystem. Every piece in place.',
    introBody:
      'SCHLUSS brings retail systems, stock control, logistics, business management and IT together. Instead of juggling disconnected tools, you get software that is designed to fit – and a network of partners who install, support and maintain it.',
    conceptTitle: 'Why "Schluss"?',
    conceptBody:
      'Schluss is German for the end, the conclusion, the close. It is the moment the final piece clicks into place and the whole picture makes sense. That is what we build for your business.',
    why: [
      { title: 'Built to connect', body: 'Products share data and work together, so your systems stop living in silos.' },
      { title: 'Local support', body: 'Approved SCHLUSS partners install, train and maintain – close to where you operate.' },
      { title: 'Try before you commit', body: 'Free trials and live demonstrations, so you know it fits before you buy.' },
      { title: 'Always improving', body: 'Managed versions and clear release notes keep every installation current and secure.' },
    ],
    supportTitle: 'Learn, get help, keep growing',
    supportBody: 'Every product comes with guides, videos and step-by-step instructions on its own product page – and real people when you need them.',
    ctaTitle: 'Find the piece your business is missing',
    ctaBody: 'Explore the SCHLUSS product range or talk to us about what you need.',
  },
  about: {
    title: 'About SCHLUSS',
    intro: 'SCHLUSS is a South African technology company building software that brings business operations together.',
    body: [
      'We design and deliver software for retail, stock management, logistics, business administration and IT – products that work on their own and work even better together.',
      'Our products reach customers through SCHLUSS directly and through approved business partners who sell, install and support them locally.',
      'Our name says what we do: Schluss means the conclusion, the close – the last piece that completes the puzzle.',
    ],
  },
  /**
   * The About SCHLUSS puzzle experience: on/off, the picture, the fixed first and last pieces,
   * the closing statement and the animation timing (seconds). Products are chosen per offering.
   */
  story: {
    enabled: true,
    imageMediaId: null as number | null,
    meaningTitle: 'What does SCHLUSS mean?',
    meaningMessage: 'The final piece of the puzzle.',
    meaningText: 'Every business has moving parts. SCHLUSS builds the software and systems that bring them together, complete the picture and make everything work smarter.',
    moreTitle: 'And more to come',
    moreText: "Every completed piece creates room for the next. We're always building what's next.",
    moreHue: '#ffb020',
    finalTitle: 'SCHLUSS – the final piece of the puzzle.',
    finalText: 'Bringing every piece together.',
    timing: { approach: 1.5, tileIn: 0.7, view: 5, tileOut: 0.6, place: 1.5 },
  },
  partners: {
    title: 'Grow With SCHLUSS.',
    subtitle: 'Become part of a connected technology ecosystem. Sell, implement and support software solutions that help businesses operate better.',
    benefits: [
      { title: 'A growing product range', body: 'Offer your customers a family of connected business products.' },
      { title: 'Training & sales material', body: 'Product training, installation manuals, presentations and marketing assets.' },
      { title: 'Your own partner portal', body: 'Manage your customers, installations, maintenance and licence renewals in one place.' },
      { title: 'Partner pricing', body: 'Partner discounts and commission on eligible products.' },
    ],
    steps: ['Apply online', 'We review your application', 'Get approved and trained', 'Start selling and supporting'],
  },
  contact: { email: '', phone: '', whatsapp: '', address: '', hours: '' },
  footer: { tagline: 'Software, retail systems and IT – connected. The last piece of your business technology puzzle.' },
};

export type SiteKey = keyof typeof SITE_DEFAULTS;
export const SITE_KEYS = Object.keys(SITE_DEFAULTS) as SiteKey[];

export async function getSiteContent(keys: SiteKey[] = SITE_KEYS) {
  const rows = await db('site_content').whereIn('key', keys).select('key', 'value');
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const row = rows.find((r) => r.key === k);
    const saved = row ? (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) : {};
    out[k] = { ...SITE_DEFAULTS[k], ...saved };
  }
  return out;
}
