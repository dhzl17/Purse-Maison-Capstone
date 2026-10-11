/**
 * Supabase connection settings.
 * The publishable key is designed to be public (it ships to the browser),
 * and Row Level Security in the database protects the data.
 * NEVER put the secret key (sb_secret_...) in this file.
 */
const PM_CONFIG = {
  SUPABASE_URL: 'https://oylxlvjekhcyqhkavczi.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_s23apKBksn502q38XtPTPA_sD9KwftY',

  // Staff log in with a username; it is turned into username@<domain> for Supabase Auth.
  STAFF_EMAIL_DOMAIN: 'pursemaison.com',
};
