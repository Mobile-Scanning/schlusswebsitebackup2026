import { db } from '../db';

/**
 * SCHLUSS Assistant – instant first answers in the website chat, without any external AI service.
 * It matches the customer's words against SCHLUSS's own content: built-in help topics, product data
 * (descriptions, features, FAQs, requirements, install instructions) and published learning material.
 * It always says it is the automated assistant, never claims to be a person, and every conversation still
 * reaches the support team (inbox, email and WhatsApp), who take over as soon as they reply.
 */

const STOP = new Set('the a an and or but to of in on for with is are was be can i you my me we our it this that how what when where why do does did have has had will would could should please hi hello hey there from about your get not any all so if at by as am im its just need want help'.split(' '));
const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, ''));

interface Entry { keys: string[]; answer: string; product?: string }

const TOPICS: Entry[] = [
  { keys: ['register', 'regist', 'sign up', 'signup', 'create account', 'account'], answer: 'To create an account, choose “Create account” at the top of the website, enter your details and the 6-digit code we email you. The code expires after 5 minutes – you can request a new one on the same screen.' },
  { keys: ['otp', 'code', 'verification', 'verify', 'didnt receive', 'not received'], answer: 'Your verification code is emailed to the address you registered with and is valid for 5 minutes. Check your spam folder, then use “Send a new code” on the verification screen (you can request a new code every 60 seconds).' },
  { keys: ['login', 'log in', 'sign in', 'signin', 'cant log', 'locked'], answer: 'Sign in with the email address and password you registered with. If you forgot your password, use “Forgot password?” on the sign-in page to receive a reset link. After 5 wrong attempts the account pauses for a few minutes for security.' },
  { keys: ['password', 'reset', 'forgot'], answer: 'Use “Forgot password?” on the sign-in page. We email a secure link that works once and expires after a short time. If the email doesn’t arrive, check your spam folder or ask us here.' },
  { keys: ['demo', 'trial', 'evaluate', 'test'], answer: 'Most SCHLUSS products offer a free demo. Open the product page and choose “Download the demo”. You’ll need a verified account; the demo length is shown on the page and is counted by our servers – reinstalling doesn’t restart it. Your setup guide is in “My account”.' },
  { keys: ['expire', 'expiry', 'expired', 'end', 'ended', 'extend'], answer: 'Your demo’s expiry date is shown in “My account › My demos”. We’ll remind you before it ends. If you need more time or want to continue with a full licence, tell us here and our team will help.' },
  { keys: ['download', 'installer', 'exe', 'setup file'], answer: 'Downloads are on each product page and in “My account › My products”. Demo installers are available after you sign in; full installers are available once your licence is active. Download links are personal and work for 10 minutes – just click again if one expires.' },
  { keys: ['install', 'installation', 'instal', 'setup', 'windows', 'smartscreen', 'antivirus', 'admin rights'], answer: 'To install: run the downloaded .exe (right-click › “Run as administrator” if asked) and follow the steps. If Windows SmartScreen appears, choose “More info › Run anyway” only for files downloaded from schluss.co.za. Your product’s step-by-step guide is in “My account › My products”.' },
  { keys: ['activate', 'activation', 'licence', 'license', 'key'], answer: 'When the software asks for activation, enter the licence key shown in “My account” (it starts with SCH-). The software needs an internet connection to activate and checks in from time to time.' },
  { keys: ['price', 'pricing', 'cost', 'buy', 'purchase', 'quote', 'quotation', 'order'], answer: 'Prices are listed under “Pricing” on each product page. If you’d like to buy or need a quotation, start a chat and choose “Purchase / Sales enquiry” – our sales team will contact you directly.' },
  { keys: ['hours', 'contact', 'phone', 'call', 'human', 'person', 'agent'], answer: 'A SCHLUSS support agent will reply in this chat – usually within one business day (Mon–Fri, 08:00–17:00 SAST). We also email you when we reply.' },
  { keys: ['error', 'crash', 'bug', 'not working', 'problem', 'issue', 'fail'], answer: 'Sorry about that. To help us fix it quickly, please tell us the product and version, what you were doing, and the exact error message (a screenshot description helps). A support agent will follow up here.' },
];

let cache: { at: number; entries: Entry[] } | null = null;

async function knowledge(): Promise<Entry[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.entries;
  const [products, faqs, learning, installs] = await Promise.all([
    db('products').where({ is_published: true, is_archived: false }).select('id', 'name', 'slug', 'short_description', 'system_requirements', 'trial_days'),
    db('product_features as f').join('products as p', 'p.id', 'f.product_id').where({ 'p.is_published': true }).select('f.kind', 'f.title', 'f.body', 'p.name as product'),
    db('learning_resources as l').leftJoin('products as p', 'p.id', 'l.product_id').where({ 'l.is_published': true }).whereIn('l.visibility', ['public', 'customer']).select('l.id', 'l.title', 'l.summary', 'p.name as product'),
    db('product_versions as v').join('products as p', 'p.id', 'v.product_id').where({ 'v.status': 'released', 'p.is_published': true }).whereNotNull('v.install_instructions').select('p.name as product', 'v.channel', 'v.install_instructions'),
  ]);
  const entries: Entry[] = [];
  for (const p of products) {
    entries.push({ product: p.name, keys: [p.name, p.slug.replace(/-/g, ' ')], answer: `${p.name}: ${p.short_description ?? ''} More details, videos and pricing: /products/${p.slug}${p.trial_days ? ` · Free ${p.trial_days}-day demo available.` : ''}` });
    if (p.system_requirements) entries.push({ product: p.name, keys: [p.name, 'requirement', 'system', 'spec', 'ram', 'windows version'], answer: `${p.name} system requirements: ${p.system_requirements}` });
  }
  for (const f of faqs) if (f.kind === 'faq' && f.body) entries.push({ product: f.product, keys: [f.title, f.product], answer: `${f.title} – ${f.body}` });
  for (const f of faqs) if (f.kind === 'feature') entries.push({ product: f.product, keys: [f.title, f.product], answer: `${f.product} includes “${f.title}”${f.body ? `: ${f.body}` : '.'}` });
  for (const l of learning) entries.push({ product: l.product ?? undefined, keys: [l.title, l.product ?? ''], answer: `You may find this guide helpful: “${l.title}”${l.summary ? ` – ${l.summary}` : ''} (/learning/${l.id})` });
  for (const i of installs) entries.push({ product: i.product, keys: [i.product, 'install', 'installation', i.channel === 'demo' ? 'demo' : 'full'], answer: `Installing ${i.product}${i.channel === 'demo' ? ' (demo)' : ''}:\n${i.install_instructions}` });
  cache = { at: Date.now(), entries };
  return entries;
}

function score(msg: string[], e: Entry) {
  const keyWords = new Set(e.keys.flatMap(words));
  let s = 0;
  for (const w of msg) if (keyWords.has(w)) s += 2;
  for (const k of e.keys) if (k.length > 3 && msg.join(' ').includes(k.toLowerCase().replace(/[^a-z0-9 ]/g, ''))) s += 1;
  return s;
}

/** Best answer for a customer message, or null when nothing matches well enough (then a person answers). */
export async function assistantAnswer(message: string, productName?: string | null): Promise<string | null> {
  const msg = words(message);
  if (!msg.length) return null;
  const all = [...TOPICS, ...(await knowledge())];
  const ranked = all
    .map((e) => ({ e, s: score(msg, e) + (productName && e.product === productName ? 1 : 0) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s);
  if (!ranked.length) return null;
  const picked = [ranked[0].e];
  if (ranked[1] && ranked[1].s >= ranked[0].s - 1 && ranked[1].e.answer !== ranked[0].e.answer) picked.push(ranked[1].e);
  return picked.map((e) => e.answer).join('\n\n');
}

export const ASSISTANT_FOOTER = 'If this doesn’t answer your question, just reply – a SCHLUSS support agent will take over this chat.';
