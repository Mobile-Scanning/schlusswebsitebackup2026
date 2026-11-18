/**
 * Email OTP verification, businesses, potential leads, sales enquiries, enquiry routing and
 * the WhatsApp Cloud API integration. Additive – existing rows keep their meaning:
 *  - every EXISTING account is marked verified (only new registrations must verify by OTP)
 *  - each existing customer with a company gets their own business record (never merged automatically)
 *  - quote_requests becomes the Sales Enquiries table (old statuses stay valid)
 */
exports.up = async function (knex) {
  /* ---------- OTP verification ---------- */
  await knex.raw('UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at)');
  await knex.schema.createTable('email_otps', (t) => {
    t.bigIncrements('id');
    t.bigInteger('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.enu('purpose', ['verify_email']).notNullable().defaultTo('verify_email');
    t.string('code_hash', 64).notNullable(); // HMAC of the code – the code itself is never stored
    t.datetime('expires_at').notNullable();
    t.tinyint('attempts').unsigned().notNullable().defaultTo(0);
    t.datetime('used_at');
    t.datetime('invalidated_at');
    t.string('ip_hash', 64);
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'purpose', 'created_at']);
  });

  /* ---------- Businesses ---------- */
  await knex.schema.createTable('businesses', (t) => {
    t.bigIncrements('id');
    t.string('name', 191).notNullable();
    t.string('registration_number', 64);
    t.string('vat_number', 32);
    t.string('business_type', 100);
    t.string('email', 191);
    t.string('phone', 32);
    t.string('website', 255);
    t.string('country', 2).notNullable().defaultTo('ZA');
    t.string('province', 80);
    t.text('notes');
    t.timestamps(true, true);
    t.index(['name']);
  });
  await knex.schema.alterTable('customers', (t) => {
    t.bigInteger('business_id').unsigned().references('businesses.id').onDelete('SET NULL');
    t.index(['business_id']);
  });
  const rows = await knex('customers').whereNotNull('company').whereNot('company', '').select('id', 'company', 'country', 'province', 'business_type', 'cellphone', 'email');
  for (const c of rows) {
    const [bid] = await knex('businesses').insert({ name: c.company, country: c.country || 'ZA', province: c.province, business_type: c.business_type, phone: c.cellphone });
    await knex('customers').where({ id: c.id }).update({ business_id: bid });
  }

  /* ---------- Enquiry routing on conversations ---------- */
  await knex.raw("ALTER TABLE tickets MODIFY channel ENUM('form','chat','whatsapp') NOT NULL DEFAULT 'form'");
  await knex.schema.alterTable('tickets', (t) => {
    t.enu('department', ['support', 'sales']).notNullable().defaultTo('support');
    t.enu('enquiry_type', ['technical', 'general', 'purchase']);
    t.datetime('human_at'); // when a person took over from the assistant
    t.string('wa_customer_phone', 32); // conversations started on WhatsApp
    t.datetime('wa_last_inbound_at'); // 24-hour customer-service window
    t.index(['department', 'status']);
    t.index(['wa_customer_phone']);
  });
  await knex.raw("ALTER TABLE ticket_messages MODIFY author_kind ENUM('customer','visitor','staff','system','bot') NOT NULL DEFAULT 'customer'");
  await knex.schema.alterTable('ticket_messages', (t) => {
    t.enu('source', ['website', 'admin', 'whatsapp', 'bot', 'system']);
  });

  /* ---------- Sales enquiries (extends quote_requests) ---------- */
  await knex.raw("ALTER TABLE quote_requests MODIFY status ENUM('new','contacted','quoted','processing','invoiced','paid','fulfilled','won','lost','declined','cancelled') NOT NULL DEFAULT 'new'");
  await knex.raw("ALTER TABLE quote_requests MODIFY kind ENUM('purchase','quotation','reactivation','upgrade') NOT NULL DEFAULT 'purchase'");
  await knex.raw('ALTER TABLE quote_requests MODIFY product_id BIGINT UNSIGNED NULL');
  await knex.schema.alterTable('quote_requests', (t) => {
    t.string('name', 191);
    t.string('email', 191);
    t.string('cellphone', 32);
    t.string('company', 191);
    t.bigInteger('business_id').unsigned().references('businesses.id').onDelete('SET NULL');
    t.enu('source', ['product_page', 'chat', 'contact', 'lead', 'admin']).notNullable().defaultTo('product_page');
    t.bigInteger('ticket_id').unsigned().references('tickets.id').onDelete('SET NULL');
    t.datetime('closed_at');
    t.index(['created_at']);
  });

  /* ---------- Potential leads ---------- */
  await knex.schema.createTable('leads', (t) => {
    t.bigIncrements('id');
    t.string('reference', 20).notNullable().unique();
    t.enu('source', ['demo_expiry', 'chat', 'contact', 'manual']).notNullable();
    t.bigInteger('customer_id').unsigned().references('customers.id').onDelete('CASCADE');
    t.bigInteger('product_id').unsigned().references('products.id').onDelete('SET NULL');
    t.bigInteger('licence_id').unsigned().unique().references('licences.id').onDelete('SET NULL'); // one demo-expiry lead per demo
    t.bigInteger('ticket_id').unsigned().references('tickets.id').onDelete('SET NULL');
    t.enu('status', ['new', 'contact_required', 'contacted', 'interested', 'not_interested', 'assistance_required', 'converted', 'closed']).notNullable().defaultTo('new');
    t.bigInteger('assigned_to').unsigned().references('users.id').onDelete('SET NULL');
    t.datetime('demo_expires_at');
    t.smallint('days_remaining');
    t.datetime('last_contact_at');
    t.integer('contact_attempts').unsigned().notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.index(['status', 'created_at']);
    t.index(['customer_id']);
  });
  await knex.schema.createTable('lead_activities', (t) => {
    t.bigIncrements('id');
    t.bigInteger('lead_id').unsigned().notNullable().references('leads.id').onDelete('CASCADE');
    t.enu('kind', ['note', 'call', 'email', 'whatsapp', 'feedback', 'status', 'system']).notNullable();
    t.string('outcome', 120);
    t.text('body');
    t.bigInteger('actor_id').unsigned().references('users.id').onDelete('SET NULL');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['lead_id', 'created_at']);
  });
  await knex.schema.alterTable('quote_requests', (t) => {
    t.bigInteger('lead_id').unsigned().references('leads.id').onDelete('SET NULL');
  });

  /* ---------- WhatsApp Cloud API ---------- */
  await knex.schema.createTable('whatsapp_messages', (t) => {
    t.bigIncrements('id');
    t.bigInteger('ticket_id').unsigned().references('tickets.id').onDelete('CASCADE');
    t.bigInteger('ticket_message_id').unsigned().references('ticket_messages.id').onDelete('SET NULL');
    t.enu('direction', ['out', 'in']).notNullable();
    t.string('wa_message_id', 128).unique(); // id from Meta – maps replies (context.id) to the conversation
    t.string('peer_phone', 32).notNullable(); // agent or customer WhatsApp number (digits, international)
    t.enu('kind', ['text', 'template']).notNullable().defaultTo('text');
    t.enu('status', ['queued', 'sent', 'delivered', 'read', 'failed', 'received']).notNullable().defaultTo('queued');
    t.text('error');
    t.tinyint('attempts').unsigned().notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.index(['ticket_id']);
    t.index(['peer_phone', 'direction', 'created_at']);
  });
  await knex.schema.createTable('whatsapp_events', (t) => {
    t.bigIncrements('id');
    t.string('kind', 32).notNullable(); // message, status, verify, unknown
    t.json('payload');
    t.boolean('signature_valid').notNullable().defaultTo(false);
    t.datetime('processed_at');
    t.text('error');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['created_at']);
  });

  await knex.raw("ALTER TABLE consents MODIFY purpose ENUM('privacy_policy','terms','marketing','partner_terms','demo_terms','support_chat','whatsapp') NOT NULL");
};

exports.down = async function (knex) {
  await knex('consents').where({ purpose: 'whatsapp' }).update({ purpose: 'privacy_policy' });
  await knex.raw("ALTER TABLE consents MODIFY purpose ENUM('privacy_policy','terms','marketing','partner_terms','demo_terms','support_chat') NOT NULL");
  for (const t of ['whatsapp_events', 'whatsapp_messages']) await knex.schema.dropTableIfExists(t);
  await knex.schema.alterTable('quote_requests', (t) => {
    t.dropForeign(['lead_id']);
    t.dropColumn('lead_id');
  });
  for (const t of ['lead_activities', 'leads']) await knex.schema.dropTableIfExists(t);
  await knex.schema.alterTable('quote_requests', (t) => {
    t.dropForeign(['business_id']);
    t.dropForeign(['ticket_id']);
    t.dropIndex(['created_at']);
    for (const c of ['name', 'email', 'cellphone', 'company', 'business_id', 'source', 'ticket_id', 'closed_at']) t.dropColumn(c);
  });
  await knex('quote_requests').whereNull('product_id').del();
  await knex.raw('ALTER TABLE quote_requests MODIFY product_id BIGINT UNSIGNED NOT NULL');
  await knex('quote_requests').where({ kind: 'quotation' }).update({ kind: 'purchase' });
  await knex.raw("ALTER TABLE quote_requests MODIFY kind ENUM('purchase','reactivation','upgrade') NOT NULL DEFAULT 'purchase'");
  await knex('quote_requests').whereIn('status', ['contacted', 'processing']).update({ status: 'new' });
  await knex('quote_requests').where({ status: 'won' }).update({ status: 'fulfilled' });
  await knex('quote_requests').where({ status: 'lost' }).update({ status: 'declined' });
  await knex.raw("ALTER TABLE quote_requests MODIFY status ENUM('new','quoted','invoiced','paid','fulfilled','declined','cancelled') NOT NULL DEFAULT 'new'");
  await knex.schema.alterTable('ticket_messages', (t) => t.dropColumn('source'));
  await knex('ticket_messages').where({ author_kind: 'bot' }).update({ author_kind: 'system' });
  await knex.raw("ALTER TABLE ticket_messages MODIFY author_kind ENUM('customer','visitor','staff','system') NOT NULL DEFAULT 'customer'");
  await knex.schema.alterTable('tickets', (t) => {
    t.dropIndex(['department', 'status']);
    t.dropIndex(['wa_customer_phone']);
    for (const c of ['department', 'enquiry_type', 'human_at', 'wa_customer_phone', 'wa_last_inbound_at']) t.dropColumn(c);
  });
  await knex('tickets').where({ channel: 'whatsapp' }).update({ channel: 'chat' });
  await knex.raw("ALTER TABLE tickets MODIFY channel ENUM('form','chat') NOT NULL DEFAULT 'form'");
  await knex.schema.alterTable('customers', (t) => {
    t.dropForeign(['business_id']);
    t.dropIndex(['business_id']);
    t.dropColumn('business_id');
  });
  await knex.schema.dropTableIfExists('businesses');
  await knex.schema.dropTableIfExists('email_otps');
};
