/**
 * MaziwaSmart Assistance — static intent catalogue (G0.3.1 / G1.1)
 * Deterministic only: no LLM, no domain service calls.
 */

export const OUTCOMES = Object.freeze({
  ANSWERED: 'answered',
  CLARIFY_AMBIGUOUS: 'clarify_ambiguous',
  NEED_INPUT: 'need_input',
  UNSUPPORTED: 'unsupported',
  AUTH_REQUIRED: 'auth_required',
  DISABLED_IN_MVP: 'disabled_in_mvp',
  FORBIDDEN: 'forbidden',
});

export const KINDS = Object.freeze({
  PUBLIC_HELP: 'public_help',
  PRIVATE_INFO: 'private_info',
  PROHIBITED_WRITE: 'prohibited_write',
});

/** Precedence rank: lower number = higher priority */
export const KIND_PRECEDENCE = Object.freeze({
  [KINDS.PROHIBITED_WRITE]: 1,
  [KINDS.PRIVATE_INFO]: 2,
  [KINDS.PUBLIC_HELP]: 3,
});

export const ACTIONS = Object.freeze({
  'nav.marketplace_public': { id: 'nav.marketplace_public', label: 'Open marketplace' },
  'nav.sign_in': { id: 'nav.sign_in', label: 'Sign in' },
  'nav.register': { id: 'nav.register', label: 'Registration help' },
  'nav.register_farmer': { id: 'nav.register_farmer', label: 'Farmer registration' },
  'nav.register_seller': { id: 'nav.register_seller', label: 'Seller registration' },
  'nav.seller_listings': { id: 'nav.seller_listings', label: 'Seller listings' },
  'nav.farm_records_help': { id: 'nav.farm_records_help', label: 'Farm records help' },
  'nav.human_messaging': { id: 'nav.human_messaging', label: 'Message a seller' },
});

export const CONTENT = Object.freeze({
  'content.product_overview.v1':
    'MaziwaSmart helps farmers manage farm records (animals, milk production, and related activity) and provides a public livestock marketplace where people can browse published listings. Private farm data stays with the farm owner and authorized delegates.',
  'content.what_can_you_do.v1':
    'I can explain MaziwaSmart features: registration, sign-in, seller verification, farm recording (animals and milk), public marketplace browsing, and how to use human messaging to contact a seller. I cannot change your data, publish listings, or open private records for you.',
  'content.sign_in.v1':
    'Sign in with the email and password for your MaziwaSmart account, or use Google sign-in if your account uses Google. Browser sessions use a secure HTTP-only cookie. If you cannot sign in, use account recovery from the sign-in screen.',
  'content.account_recovery.v1':
    'Use the forgot-password or account-recovery option on the sign-in screen and follow the email instructions for your account. Assistance cannot reset passwords or send recovery email for you.',
  'content.registration_need_role.v1':
    'Which kind of account do you need help with? Reply with farmer, seller, or buyer.',
  'content.register_farmer.v1':
    'Farmer registration needs your full name and phone number, plus account email and password. The system creates a farmer profile for that account. Phone numbers must be unique for farmers. Assistance cannot complete registration for you.',
  'content.register_seller.v1':
    'Seller registration creates an account with a seller profile that starts as pending verification. A pending seller cannot publish marketplace listings until an authorized operator marks the seller as verified. Assistance cannot verify sellers.',
  'content.register_buyer.v1':
    'You can create a standard account to sign in and use public features. Buyer-style registration uses the general account signup path. For farm tools register as a farmer; to list livestock register as a seller (subject to verification before publish).',
  'content.seller_verification.v1':
    'New seller profiles start as pending. Only a verified seller can publish livestock ads. Verification is changed by an authorized operator—not by self-service in Assistance. If you cannot publish, check that you registered as a seller and that verification is not still pending.',
  'content.animals_help.v1':
    'Farmers record animals under their farmer profile. Each animal belongs to that farm scope. Delegates need the appropriate animals permissions on a farm access grant. Assistance can explain the workflow but cannot create or edit animals for you.',
  'content.milk_help.v1':
    'Milk yield records capture production for an animal under the farmer’s scope. Litres are production data—not automatic financial income. Income is recorded separately as explicit finance entries. Delegates need milk permissions on their grant. Assistance cannot write milk records.',
  'content.farm_records_bundle.v1':
    'Farmers record animals and milk yields under their farmer profile with optional delegate permissions. Ask how to add an animal or how to record milk for step-by-step guidance. Litres are not automatic income.',
  'content.farm_access.v1':
    'Farm owners control their data through their farmer profile. Other people only get access through an explicit farm access grant with specific permissions such as animals.read or milk.record. Being logged in or being a seller does not grant farm access by itself.',
  'content.marketplace_public.v1':
    'Anyone can browse published livestock advertisements without signing in. Draft, closed, or unpublished listings are not shown on the public marketplace. Opening a public listing does not expose private owner account identifiers.',
  'content.seller_listings.v1':
    'Sellers manage their own listings after registering and completing verification. Creating or publishing a listing is done in the seller tools, not through Assistance. Only verified sellers can publish. Public buyers only see published ads.',
  'content.human_messaging.v1':
    'To contact a seller about a listing, use MaziwaSmart human messaging between your account and the seller’s account. Assistance is not a participant in those conversations and cannot send messages for you.',
  'content.private_animals_auth.v1':
    'Animal records are private. Sign in, then use the farm tools. Assistance cannot load your herd.',
  'content.private_animals_disabled.v1':
    'I cannot retrieve live farm data yet. I can explain how animal records work if you ask how to add an animal.',
  'content.private_milk_auth.v1':
    'Milk records are private. Sign in to use the farm dashboard. Assistance cannot load your yields.',
  'content.private_milk_disabled.v1':
    'I cannot retrieve live milk data yet. Ask how to record milk for workflow guidance.',
  'content.forbidden_publish.v1':
    'I cannot publish listings. Publishing is done in seller tools after your seller profile is verified.',
  'content.forbidden_animal_write.v1':
    'I cannot create, update, or delete animals. Use the farm recording tools with the correct permissions.',
  'content.forbidden_verify.v1':
    'I cannot change seller verification. Only an authorized operator can update verification status.',
  'content.forbidden_finance.v1':
    'I cannot create financial entries. Farm income and expenses are recorded explicitly in farm finance tools—not inferred from milk or chat.',
  'content.forbidden_send_message.v1':
    'I cannot send messages. Use human messaging between accounts to contact a seller.',
  'content.unsupported.v1':
    'I cannot help with that. Try asking about registration, sign-in, seller verification, farm recording, the public marketplace, or messaging a seller.',
  'content.clarify_topics.v1': 'What would you like help with?',
});

export const GENERIC_CLARIFY_OPTIONS = Object.freeze([
  { id: 'topic.registration', label: 'Registration' },
  { id: 'topic.marketplace', label: 'Marketplace' },
  { id: 'topic.farm_records', label: 'Farm records' },
]);

/**
 * Token group: array of alternatives; alternative is string[] of consecutive words.
 * Example: [['register'], ['registration'], ['sign', 'up']] means OR of those phrases.
 */
function alt(...parts) {
  return parts.map((p) => (Array.isArray(p) ? p : String(p).split(/\s+/)));
}

function groups(...groupAlts) {
  return groupAlts.map((g) => (Array.isArray(g[0]) ? g : alt(...g)));
}

/**
 * Intent definitions. `order` is secondary sort within same kind (lower = more specific).
 */
export const INTENTS = Object.freeze([
  // --- prohibited writes (highest kind precedence) ---
  {
    id: 'prohibited_write.publish_ad',
    kind: KINDS.PROHIBITED_WRITE,
    order: 10,
    aliases: ['publish my ad', 'publish my ad now', 'publish my listing', 'publish my livestock ad now', 'make my ad public now'],
    contentId: 'content.forbidden_publish.v1',
    actionIds: ['nav.seller_listings'],
  },
  {
    id: 'prohibited_write.mutate_animal',
    kind: KINDS.PROHIBITED_WRITE,
    order: 11,
    aliases: ['delete my animal', 'create an animal now', 'remove this cow', 'update my animal record now'],
    contentId: 'content.forbidden_animal_write.v1',
    actionIds: ['nav.farm_records_help'],
  },
  {
    id: 'prohibited_write.verify_seller',
    kind: KINDS.PROHIBITED_WRITE,
    order: 12,
    aliases: ['verify my seller account', 'approve me as seller', 'mark me verified'],
    contentId: 'content.forbidden_verify.v1',
    actionIds: [],
  },
  {
    id: 'prohibited_write.finance',
    kind: KINDS.PROHIBITED_WRITE,
    order: 13,
    aliases: ['record this income', 'add an expense now', 'post a payment'],
    contentId: 'content.forbidden_finance.v1',
    actionIds: [],
  },
  {
    id: 'prohibited_write.send_message',
    kind: KINDS.PROHIBITED_WRITE,
    order: 14,
    aliases: ['send a message to the seller', 'message them now', 'tell the seller i want to buy'],
    contentId: 'content.forbidden_send_message.v1',
    actionIds: ['nav.human_messaging'],
  },

  // --- private info ---
  {
    id: 'private_info.my_animals',
    kind: KINDS.PRIVATE_INFO,
    order: 20,
    aliases: ['show my animals', 'list my animals', 'how many animals do i have', 'get my herd'],
    contentIdAuth: 'content.private_animals_auth.v1',
    contentIdDisabled: 'content.private_animals_disabled.v1',
    actionIdsAuth: ['nav.sign_in'],
    actionIdsDisabled: [],
  },
  {
    id: 'private_info.my_milk',
    kind: KINDS.PRIVATE_INFO,
    order: 21,
    aliases: ['show my milk records', 'my milk production', 'get my milk yields', 'milk records for this week'],
    contentIdAuth: 'content.private_milk_auth.v1',
    contentIdDisabled: 'content.private_milk_disabled.v1',
    actionIdsAuth: ['nav.sign_in'],
    actionIdsDisabled: [],
  },

  // --- specific public help ---
  {
    id: 'help.register_farmer',
    kind: KINDS.PUBLIC_HELP,
    order: 30,
    aliases: ['farmer', 'how do i register as a farmer', 'farmer registration', 'register as farmer', 'register farmer'],
    tokenGroups: groups(['farmer'], ['register', 'registration', ['sign', 'up']]),
    contentId: 'content.register_farmer.v1',
    actionIds: ['nav.register_farmer'],
  },
  {
    id: 'help.register_seller',
    kind: KINDS.PUBLIC_HELP,
    order: 31,
    aliases: ['seller', 'how do i register as a seller', 'seller registration', 'register as seller', 'register seller'],
    tokenGroups: groups(['seller'], ['register', 'registration', ['sign', 'up']]),
    contentId: 'content.register_seller.v1',
    actionIds: ['nav.register_seller'],
  },
  {
    id: 'help.register_buyer',
    kind: KINDS.PUBLIC_HELP,
    order: 32,
    aliases: ['buyer', 'how do i register as a buyer', 'buyer registration', 'register as buyer', 'register buyer'],
    tokenGroups: groups(['buyer'], ['register', 'registration', ['sign', 'up']]),
    contentId: 'content.register_buyer.v1',
    actionIds: ['nav.register'],
  },
  {
    id: 'help.registration_menu',
    kind: KINDS.PUBLIC_HELP,
    order: 33,
    aliases: ['how do i register', 'how to register', 'create an account', 'sign up', 'registration'],
    needInput: { field: 'role', prompt: 'Reply with farmer, seller, or buyer.' },
    contentId: 'content.registration_need_role.v1',
    actionIds: [],
  },
  {
    id: 'help.seller_verification',
    kind: KINDS.PUBLIC_HELP,
    order: 34,
    aliases: [
      'why cant i publish',
      "why can't i publish",
      'seller verification',
      'how does seller verification work',
      'pending verification',
      'how do i publish',
    ],
    contentId: 'content.seller_verification.v1',
    actionIds: ['nav.seller_listings'],
  },
  {
    id: 'help.animals',
    kind: KINDS.PUBLIC_HELP,
    order: 35,
    aliases: ['how do i add an animal', 'how to add a cow', 'adding animals', 'how do i register an animal'],
    contentId: 'content.animals_help.v1',
    actionIds: ['nav.farm_records_help'],
  },
  {
    id: 'help.milk_yield',
    kind: KINDS.PUBLIC_HELP,
    order: 36,
    aliases: ['how do i record milk', 'how to record milk yield', 'milk recording', 'log milk production'],
    contentId: 'content.milk_help.v1',
    actionIds: ['nav.farm_records_help'],
  },
  {
    id: 'help.farm_records_bundle',
    kind: KINDS.PUBLIC_HELP,
    order: 37,
    aliases: ['farm records', 'farm recording'],
    contentId: 'content.farm_records_bundle.v1',
    actionIds: ['nav.farm_records_help'],
  },
  {
    id: 'help.farm_access',
    kind: KINDS.PUBLIC_HELP,
    order: 38,
    aliases: ['what is farm access', 'how do farm permissions work', 'delegated access', 'manager permissions'],
    contentId: 'content.farm_access.v1',
    actionIds: ['nav.farm_records_help'],
  },
  {
    id: 'help.marketplace_public',
    kind: KINDS.PUBLIC_HELP,
    order: 39,
    aliases: [
      'how do i browse livestock',
      'public marketplace',
      'browse livestock',
      'can i browse without an account',
      'marketplace',
    ],
    tokenGroups: groups(['browse', 'public'], ['livestock', 'marketplace', 'listings']),
    contentId: 'content.marketplace_public.v1',
    actionIds: ['nav.marketplace_public'],
  },
  {
    id: 'help.seller_listings',
    kind: KINDS.PUBLIC_HELP,
    order: 40,
    aliases: [
      'how do i list an animal for sale',
      'how to create a listing',
      'seller listings help',
      'how do i sell livestock',
    ],
    contentId: 'content.seller_listings.v1',
    actionIds: ['nav.seller_listings'],
  },
  {
    id: 'help.human_messaging',
    kind: KINDS.PUBLIC_HELP,
    order: 41,
    aliases: ['how do i message a seller', 'contact seller', 'chat with seller', 'message the advertiser'],
    contentId: 'content.human_messaging.v1',
    actionIds: ['nav.human_messaging'],
  },
  {
    id: 'help.sign_in',
    kind: KINDS.PUBLIC_HELP,
    order: 42,
    aliases: ['how do i sign in', 'how to login', 'how to log in', 'how do i log in', 'sign in help'],
    contentId: 'content.sign_in.v1',
    actionIds: ['nav.sign_in'],
  },
  {
    id: 'help.account_recovery',
    kind: KINDS.PUBLIC_HELP,
    order: 43,
    aliases: ['forgot password', 'how do i reset my password', 'reset password', 'account recovery'],
    contentId: 'content.account_recovery.v1',
    actionIds: ['nav.sign_in'],
  },
  {
    id: 'help.product_overview',
    kind: KINDS.PUBLIC_HELP,
    order: 50,
    aliases: ['what is maziwasmart', 'what is maziwa smart', 'about maziwasmart', 'tell me about maziwasmart'],
    tokenGroups: groups(['what'], ['maziwasmart']),
    contentId: 'content.product_overview.v1',
    actionIds: [],
  },
  {
    id: 'help.what_can_you_do',
    kind: KINDS.PUBLIC_HELP,
    order: 51,
    aliases: ['what can you do', 'help', 'how can you help', 'what do you help with'],
    contentId: 'content.what_can_you_do.v1',
    actionIds: [],
  },
]);

export function resolveActions(actionIds = []) {
  const out = [];
  for (const id of actionIds) {
    const a = ACTIONS[id];
    if (a) out.push({ id: a.id, label: a.label });
  }
  return out;
}

export function getContent(contentId) {
  if (!contentId) return null;
  return CONTENT[contentId] ?? null;
}
