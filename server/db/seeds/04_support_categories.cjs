/**
 * Default support chat categories (reference data). Inserted only if missing – admin edits are kept.
 */
const CATS = [
  ['Demo Enquiry', 'normal'],
  ['Demo Download', 'normal'],
  ['Demo Installation', 'normal'],
  ['Demo Activation', 'high'],
  ['Demo Expiry', 'normal'],
  ['Product Enquiry', 'normal'],
  ['Package Enquiry', 'normal'],
  ['Pricing', 'normal'],
  ['Technical Support', 'high'],
  ['Learning and Training', 'normal'],
  ['Downloads', 'normal'],
  ['Partnership', 'normal'],
  ['General Enquiry', 'normal'],
  ['Other', 'low'],
];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

exports.seed = async function (knex) {
  for (const [i, [name, priority]] of CATS.entries()) {
    await knex('support_categories').insert({ name, slug: slug(name), priority, sort_order: (i + 1) * 10 }).onConflict('slug').ignore();
  }
};
