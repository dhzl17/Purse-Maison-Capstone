/**
 * Help Center page.
 *   Home:      search, quick access cards (User Guides, FAQs, Submit a Ticket) and Popular Topics.
 *   Guides:    every guide, grouped by module. Each guide opens as an article with steps and notes.
 *   FAQs:      expandable questions and answers.
 *   Ticket:    explains how to report a problem. Online ticket submission is not built yet;
 *              set HELP_TICKET_URL to a real https:// form address to link to it.
 * Who a guide applies to is worked out from the ROLES table in auth.js (the same table that
 * controls the sidebar), so the Help Center never disagrees with the real page access.
 * The page redraws only its own content area, so typing in the search box keeps focus.
 */

const HELP_TICKET_URL = ''; // e.g. 'https://forms.example.com/purse-maison-support' once a ticket form exists

const HELP_CATEGORIES = [
  'Getting Started',
  'Consignment Management',
  'Inventory Management',
  'Client Assignment',
  'Sales & Payouts',
  'Sales Forecasting',
  'Accounts & Permissions',
];

/*
 * Guide fields:
 *   routes   pages the guide is about; "Applies to" lists every role that can open one of them
 *   roles    optional; overrides "Applies to" when only some roles can do the task
 *   go       optional route for the "Go to …" button
 * Text inside **double asterisks** is shown in bold (used for real button and field labels).
 */
const HELP_ARTICLES = [
  {
    id: 'login-logout',
    category: 'Getting Started',
    title: 'Logging in and logging out',
    summary: 'Sign in with your staff username, log out safely, and use auto-logout.',
    module: 'Login & Session',
    routes: [],
    keywords: 'sign in sign out username password forgot password auto logout inactive session',
    intro: 'Each staff member has their own username and password. What you see after logging in depends on your role.',
    steps: [
      'Open Purse Maison and enter your **Username** and **Password**.',
      'Click **Log In**. You start on the page set for your role. For example, Photographers start on Photography Tasks.',
      'To log out, click **Log Out** at the bottom of the sidebar.',
      'To log out automatically on a shared computer, open **Settings** and choose a time under **Log me out automatically when inactive**.',
    ],
    notes: [
      'Forgot your password? Click **Forgot Password?** on the login page. Passwords are reset by the owner (Super Admin) in Settings → Team Accounts.',
      'Deactivated accounts cannot log in.',
    ],
    related: ['navigating', 'account-settings'],
    popular: false,
  },
  {
    id: 'navigating',
    category: 'Getting Started',
    title: 'Finding your way around',
    summary: 'How the sidebar, search bars, sorting and page numbers work.',
    module: 'All pages',
    routes: [],
    keywords: 'sidebar menu navigation pages search sort pagination previous next refresh',
    intro: 'All pages share the same sidebar and the same search, sort and page controls.',
    steps: [
      'Use the sidebar on the left to open a page. It only lists the pages your role can open.',
      'Click **Consignment Management** to show or hide its sub-pages, such as Overview & Status and Sales & Payouts.',
      'Click **☰** at the top of the page to hide or show the sidebar. On a phone or narrow window, the sidebar opens over the page.',
      'Use the search bar at the top of a list to filter it as you type. Use the sort menu beside it to change the order.',
      'Long lists are split into pages. Use **Previous**, **Next** or a page number below the list.',
      'Click **Help** at the bottom of the sidebar to come back to the Help Center.',
    ],
    notes: [
      'Pages quietly reload their data when you open them if it is more than a minute old.',
    ],
    related: ['dashboard', 'roles-permissions'],
    popular: false,
  },
  {
    id: 'dashboard',
    category: 'Getting Started',
    title: 'Reading the Dashboard',
    summary: 'What the sales totals, item counts and charts on the Dashboard mean.',
    module: 'Dashboard',
    routes: ['dashboard'],
    go: 'dashboard',
    keywords: 'dashboard total sales items sold active consigned monthly growth charts overview revenue',
    intro: 'The Dashboard gives a quick view of sales and stock.',
    steps: [
      'Open **Dashboard** from the sidebar.',
      '**Total Sales** is this month\'s sales. **Monthly Sales Growth** compares this month with last month.',
      '**Number of Items Sold** counts sold items. **Active Consigned Items** counts items still moving through the consignment workflow.',
      'The **Sales Overview** and **Actual vs 6-Month Average** charts cover the last 6 months. **Inventory Performance** shows items by status.',
    ],
    notes: [
      'Monthly sales include the imported sales history as well as sales recorded in the system.',
    ],
    related: ['forecasting', 'inventory'],
    popular: false,
  },
  {
    id: 'consignment-workflow',
    category: 'Consignment Management',
    title: 'Understanding the consignment workflow',
    summary: 'The stages an item moves through, and which team handles each page.',
    module: 'Consignment Management',
    routes: ['consignment-overview'],
    go: 'consignment-overview',
    keywords: 'stages workflow pipeline status inquiry intake authentication photography design pricing approval published sold archived closed fake',
    intro: 'Every consigned item moves through the same stages. The database moves items to the next stage automatically once a step is complete, and refuses a save that breaks a rule.',
    steps: [
      '**Inquiries & Pre-Intake** (Consignment Team): Customer Inquiry → Lead Qualification → Initial Photos → Price Negotiation → Consignment Approval → Appointment Scheduling → In Transit to Receiving.',
      '**Intake & Agreements** (Consignment Team): Received → Awaiting Auth. Payment.',
      '**Authentication Service** (Authenticators): Authentication Queue → Being Authenticated → Authentication Certificate.',
      '**Photography Tasks** (Photographers): Photography. **Design & Listing** (Designers): Photo Editing.',
      '**Manager Approvals** (Manager): Manager Approval. **Pricing & Markup** (Pricing Team): Pricing & Markup.',
      '**Design & Listing**: Listing Creation. **Manager Approvals**: Published. **Sales & Payouts**: Sold, or Archived after a withdrawal.',
    ],
    notes: [
      'Items can also end as **Closed – Fake** (failed authentication) or **Closed – Not Accepted** (rejected).',
      'The owner (Super Admin) can open every stage page.',
      'If a save is refused, the reason appears in a notice at the bottom-right of the screen.',
    ],
    related: ['new-consignment', 'track-consignment', 'stage-tasks'],
    popular: false,
  },
  {
    id: 'new-consignment',
    category: 'Consignment Management',
    title: 'How to create a new consignment',
    summary: 'Record a consignor\'s inquiry and move it through pre-intake and intake.',
    module: 'Inquiries & Pre-Intake',
    routes: ['consignment-preintake'],
    go: 'consignment-preintake',
    keywords: 'new consignment create inquiry consignor intake agreement receive item new customer inquiry',
    intro: 'A consignment starts as a customer inquiry. The item gets its own Item ID and then moves through the workflow.',
    steps: [
      'In the sidebar, open **Consignment Management** → **Inquiries & Pre-Intake**.',
      'In the **New Customer Inquiry** form, fill in **Consignor Name** (pick an existing consignor from the suggestions or type a new name), **Source Channel**, **Phone**, **Email**, **Brand**, **Model**, **Category**, **Asking Price (₱)** and **Internal Notes**. Brand and Consignor Name are required.',
      'Click **Create**. The inquiry appears in the list.',
      'Click **Select** on the inquiry to open it in the side panel. Update the **Lead Status** and click **Save**.',
      'Move the inquiry forward with **Submit** (or **Approve** at Consignment Approval). Use **Not Approved** if the consignment is declined. Set the appointment and click **Save Appointment**.',
      'Continue in **Intake & Agreements**: upload the ID check, then click **Save Item Details**, **Save Signed Agreement** and **Receive Item**.',
      'Click **Request Authentication Payment**, then **Confirm Payment** once paid. The item then moves to Authentication.',
    ],
    notes: [
      'Only the Consignment Team and the owner can create and edit inquiries.',
      'Click **View Activity Log** in the side panel to see every stage change for the item.',
    ],
    related: ['consignment-workflow', 'track-consignment'],
    popular: true,
  },
  {
    id: 'track-consignment',
    category: 'Consignment Management',
    title: 'Finding and tracking a consignment',
    summary: 'Search every item by Item ID, brand, serial number, consignor or stage.',
    module: 'Overview & Status',
    routes: ['consignment-overview'],
    go: 'consignment-overview',
    keywords: 'find search consignment item id serial number consignor stage filter overview status track',
    intro: 'Overview & Status lists every consigned item with its current stage. It is read-only.',
    steps: [
      'Open **Consignment Management** → **Overview & Status**.',
      'Type in the search bar. It matches **Item ID, Brand, Serial #, Consignor and Stage**.',
      'Use the **All stages** menu to show one stage only, and the **Sort by** menu to change the order.',
      'Read the **Stage**, **Authentication**, **Price** and **Last Update** columns for the item\'s current status.',
    ],
    notes: [
      'To act on an item, open the page for its stage. For example, open Photography Tasks for items in Photography.',
    ],
    related: ['consignment-workflow', 'inventory'],
    popular: false,
  },
  {
    id: 'stage-tasks',
    category: 'Consignment Management',
    title: 'Working on authentication, photos, design, pricing and approvals',
    summary: 'What each team does on its own consignment page.',
    module: 'Consignment Management',
    routes: ['consignment-auth', 'consignment-photo', 'consignment-design', 'consignment-pricing', 'consignment-approval'],
    keywords: 'authenticator authentication certificate photographer photos design listing cover photo pricing markup manager approve reject publish',
    intro: 'Each team has its own page in Consignment Management. Open your page from the sidebar and select an item to work on it.',
    steps: [
      '**Authentication Service**: click **Take This Check**, then **Record** your result. Two different authenticators must each check the item. If both say Authentic, it goes to Photography. If both say Fake, it closes. If they disagree, the owner records the final decision.',
      '**Photography Tasks**: click **Take This Item**, upload the 7 required shots (front, back, side, interior, hardware, serial number and accessories; lifestyle is optional), then click **Submit to Design**.',
      '**Design & Listing**: upload the edited photos, click **Set as cover** on one photo, then click **Approve Photos → Manager** or **Return to Photographer**. At Listing Creation, complete the listing, click **Save Draft**, then **Submit for Publishing**.',
      '**Manager Approvals**: review the item, then click **Approve → Pricing**, **Return for Revision** or **Reject Item**. Submitted listings are made live with **Publish Item**.',
      '**Pricing & Markup**: enter the selling price and click **Save Price**, then **Confirm → Listing Creation**.',
    ],
    notes: [
      'Publishing an item starts its 60-day consignment contract.',
      'Each page has a **View Activity Log** button for the selected item.',
    ],
    related: ['consignment-workflow', 'roles-permissions'],
    popular: true,
  },
  {
    id: 'inventory',
    category: 'Inventory Management',
    title: 'Viewing and searching inventory',
    summary: 'Find items, filter by date or brand, and read each status.',
    module: 'Inventory Management',
    routes: ['inventory'],
    go: 'inventory',
    keywords: 'inventory stock items available reserved sold rejected location showroom item id filter brand date transaction status',
    intro: 'Inventory Management is a live, read-only view of consigned items that have been published, reserved, sold or rejected.',
    steps: [
      'Open **Inventory Management** from the sidebar.',
      'Search by **ID, Brand, Category or Location** in the search bar.',
      'Narrow the list with the date menu (**All Time**, **Last 7 Days**, **This Month**, **Last 3 Months**, **Year to Date**) and the **All Brands** menu.',
      'Change the order with the sort menu, for example **Sort: Price High to Low**.',
      'Read the **Status** column: **Available**, **Reserved**, **Sold** or **Rejected**. **Transaction Status** shows Pending, Completed or Cancelled when there is a sale.',
    ],
    notes: [
      'Items cannot be added or edited here. They come from the consignment workflow, so an item only appears after it is published.',
      'The **Item ID** is the same code used in Consignment Management and Sales & Payouts.',
      '**Location** is worked out from the status: Showroom, Released (sold) or For Return (rejected).',
    ],
    related: ['track-consignment', 'consignment-workflow'],
    popular: true,
  },
  {
    id: 'client-assignment',
    category: 'Client Assignment',
    title: 'How to add a new client assignment',
    summary: 'Add a client inquiry and assign it to a sales associate.',
    module: 'Client Assignment',
    routes: ['clients'],
    go: 'clients',
    keywords: 'client assignment inquiry add walk in online associate assign vip resolved pending assigned',
    intro: 'Client Assignment tracks client inquiries and the sales associate handling each one.',
    steps: [
      'Open **Client Assignment** from the sidebar.',
      'Click **+ Add Inquiry**, or use **+ Add Walk In Client** or **+ Add Online Inquiry** under Quick Actions.',
      'Fill in **Client Name**, **Phone**, **Email**, **Client Role** and **Inquiry Source**. Tick **VIP client** if needed.',
      'Choose an **Assigned Associate**, or leave it empty and the system assigns the associate with the lowest workload.',
      'Click **Add Inquiry**. To change an inquiry later, click its edit (pencil) icon and then **Save Changes**.',
    ],
    notes: [
      'Inquiry statuses are **Pending**, **Assigned** and **Resolved**. A resolved inquiry cannot be reopened, and inquiries cannot be deleted.',
      'The **Sales Associates** panel shows who is **Available** or **Assigned**. **Recent Assignment Activity** lists the latest assignments.',
    ],
    related: ['roles-permissions'],
    popular: true,
  },
  {
    id: 'record-sale',
    category: 'Sales & Payouts',
    title: 'Recording a sale',
    summary: 'Record a full-payment or layaway sale on a live listing.',
    module: 'Sales & Payouts',
    routes: ['consignment-sales'],
    roles: ['salesAssociate', 'manager', 'superAdmin'],
    go: 'consignment-sales',
    keywords: 'record sale sell buyer full payment layaway installment live listing sold reserve',
    intro: 'Sales are recorded on live listings. The price, commission and consignor payout are copied from the item.',
    steps: [
      'Open **Consignment Management** → **Sales & Payouts** and stay on the **Live Listings** tab.',
      'Click **Manage ▾** on the item, then **Record sale**.',
      'Enter the **Buyer Name** and, if available, the **Buyer Phone Number**.',
      'Choose the **Payment Type**: **Full payment**, or **Layaway** (1% interest per month, up to 3 months). For layaway, choose the **Layaway Term**.',
      'Check the summary, then click **Record Sale**.',
    ],
    notes: [
      'Layaway is only offered for items priced at ₱200,000 and above. A 1-month layaway has no interest.',
      'Full payment marks the item Sold straight away. Layaway reserves it until the payments cover the total due. Add payments with **Manage ▾** → **Add layaway payment**.',
      'Recording a sale does not finish it. The manager still has to verify the payment.',
    ],
    related: ['payouts', 'inventory'],
    popular: true,
  },
  {
    id: 'payouts',
    category: 'Sales & Payouts',
    title: 'Verifying payments, payouts and withdrawals',
    summary: 'Verify buyer payments, release payouts, extend contracts and process withdrawals.',
    module: 'Sales & Payouts',
    routes: ['consignment-sales'],
    roles: ['manager', 'superAdmin', 'consignmentTeam'],
    go: 'consignment-sales',
    keywords: 'verify payment release payout consignor withdrawal pull out fee extend contract 60 day completed',
    intro: 'After a sale is recorded, the manager confirms the payment and releases the consignor\'s payout. Live listings also have a 60-day contract that can be extended or ended.',
    steps: [
      'Open the **Sales & Payouts** tab. Click **Manage ▾** → **Verify payment** and confirm it. The consignor payout becomes due within 14 banking days.',
      'After paying the consignor, click **Manage ▾** → **Release payout**. The sale moves to **Completed**.',
      'On the **Live Listings** tab, the **Contract** column counts down the 60-day term. Click **Manage ▾** → **Extend contract** (with the consignor\'s agreement) or **Withdraw item**.',
      'On the **Withdrawals** tab, click **Manage ▾** → **Mark fee paid**, then **Release item** to hand the item back to the consignor.',
    ],
    notes: [
      'Only the Manager and owner can verify payments, release payouts and process withdrawals. The Consignment Team can extend contracts and start withdrawals.',
      '**Verify payment** stays greyed out until a layaway is fully paid. **Release item** stays greyed out until the pull-out fee is paid.',
      'The database works out the pull-out fee. These actions cannot be undone.',
    ],
    related: ['record-sale'],
    popular: false,
  },
  {
    id: 'forecasting',
    category: 'Sales Forecasting',
    title: 'Understanding sales forecasting',
    summary: 'How forecasts are made, how to filter them and how to read the results.',
    module: 'Sales Forecasting',
    routes: ['forecasting'],
    go: 'forecasting',
    keywords: 'forecast arima projection brand trend growth mae error prediction alerts historical projected request new forecast',
    intro: 'Sales Forecasting shows a brand-level sales forecast made by an ARIMA model. The model runs as a scheduled job and saves its results, which this page displays.',
    steps: [
      'Open **Sales Forecasting** from the sidebar.',
      'Check the status line for **Last updated**, the model and the **Average error (MAE)**.',
      'Use the **Brand** menu to show one brand. It changes the **Sales Trend (Actual vs Projected)** chart and the **Brand Forecasts** table. The **Historical vs Projected Sales by Brand** chart always shows every brand.',
      'In **Brand Forecasts**, compare **Historical (₱)** with **Projected (₱)**. **Growth %** and **Trend** (Increasing, Stable or Decreasing) summarise the change.',
      'Read **Prediction Alerts** for plain-language notes worked out from the forecast.',
      'To ask for a new forecast, the owner clicks **Request New Forecast**. It runs at the next scheduled job.',
    ],
    notes: [
      'A forecast is an estimate, not a guarantee. **Avg. Error (MAE)** shows how far the model was off on past months, in pesos. A smaller number is better.',
      'A brand needs about 12 months or more of monthly sales history before it can be forecast.',
      'Only one forecast can be queued or running at a time.',
    ],
    related: ['dashboard'],
    popular: true,
  },
  {
    id: 'roles-permissions',
    category: 'Accounts & Permissions',
    title: 'Understanding user roles and permissions',
    summary: 'Which pages each role can open, and why some buttons are hidden.',
    module: 'Accounts & Permissions',
    routes: [],
    keywords: 'role roles permission access restricted owner super admin manager consignment team authenticator photographer designer pricing sales associate',
    intro: 'Every staff account has one role. The role decides which pages appear in your sidebar and which action buttons you see.',
    steps: [
      'Find your role in **Settings** → **Account Settings** → **Role**.',
      'Check the table below for the pages your role can open.',
      'If a page you need is missing, ask the owner (Super Admin) to change your role.',
    ],
    notes: [
      'Opening a page your role cannot use shows **Access Restricted**.',
      'Some buttons depend on your role even on a page you can open. For example, only the Manager and owner can verify payments.',
      'The database also checks every change, so a hidden button cannot be bypassed.',
    ],
    showRoleTable: true,
    related: ['team-accounts', 'account-settings'],
    popular: true,
  },
  {
    id: 'account-settings',
    category: 'Accounts & Permissions',
    title: 'Managing your account and settings',
    summary: 'Change your display name, password, auto-logout and notification preferences.',
    module: 'Settings',
    routes: ['settings'],
    go: 'settings',
    keywords: 'settings account display name password change security notifications preferences auto logout',
    intro: 'Settings holds your own account details and preferences.',
    steps: [
      'Open **Settings** from the sidebar.',
      'Under **Account Settings**, change your display name and click **Save Changes**. Your username, login email and role cannot be changed here.',
      'Under **Security Settings**, enter your current password and the new one twice, then click **Update Password**. New passwords need at least 12 characters.',
      'Under **Session**, choose when to log out automatically: **Never**, **After 15 minutes**, **After 30 minutes** or **After 1 hour**.',
      'Under **Notification Settings**, choose **Sales Updates**, **Inventory Alerts** and **System Announcements**, then click **Save Preferences**.',
    ],
    notes: [
      'The new password must be different from the current one.',
    ],
    related: ['login-logout', 'team-accounts'],
    popular: true,
  },
  {
    id: 'team-accounts',
    category: 'Accounts & Permissions',
    title: 'Managing staff accounts',
    summary: 'Create staff logins, change roles, reset passwords and deactivate accounts.',
    module: 'Settings → Team Accounts',
    routes: ['settings'],
    roles: ['superAdmin'],
    go: 'settings',
    keywords: 'staff account create user add staff change role reset password deactivate reactivate team accounts owner',
    intro: 'The owner (Super Admin) manages every staff login from Settings.',
    steps: [
      'Open **Settings** and scroll to **Team Accounts & Role Permissions**.',
      'Click **+ Add Staff Account**. Enter the **Full Name**, **Username**, a **Temporary Password** (at least 12 characters) and the **Role**, then click **Create Staff Account**.',
      'To change someone\'s role, pick a new role in their row and click **Change Role** to confirm.',
      'Click **Reset Password** to create a new temporary password. Give it to the staff member and ask them to change it in Settings.',
      'Click **Deactivate** to remove someone\'s access, or **Reactivate** to restore it.',
    ],
    notes: [
      'Deactivated staff can no longer log in or see any data.',
    ],
    related: ['roles-permissions', 'account-settings'],
    popular: false,
  },
];

const HELP_FAQS = [
  {
    q: 'Why can\'t I see a page in the sidebar?',
    a: 'The sidebar only lists the pages your role can open. If you open a page your role cannot use, you see "Access Restricted". Ask the owner (Super Admin) to change your role if you need the page.',
    article: 'roles-permissions',
  },
  {
    q: 'Why is an item not appearing in Inventory?',
    a: 'Inventory only lists items that have been published, reserved, sold or rejected. Items still moving through the consignment workflow are not shown yet. Also check the date and brand menus, and note that the search only matches ID, Brand, Category and Location. To find any item, use Overview & Status.',
    article: 'inventory',
  },
  {
    q: 'How can I find a specific consignment?',
    a: 'Open Consignment Management → Overview & Status and search by Item ID, Brand, Serial #, Consignor or Stage. You can also show one stage at a time with the "All stages" menu.',
    article: 'track-consignment',
  },
  {
    q: 'Why can\'t I add or edit a client assignment?',
    a: 'Client Assignment can only be opened by the Super Admin and Sales Associates. A resolved inquiry cannot be reopened, and inquiries cannot be deleted.',
    article: 'client-assignment',
  },
  {
    q: 'Why is "Verify payment" or "Release item" greyed out?',
    a: 'Verify payment stays disabled until a layaway is fully paid ("Layaway not fully paid yet"). Release item stays disabled until the pull-out fee is marked paid ("Pull-out fee not paid"). The reason is shown under the greyed-out option in the Manage menu.',
    article: 'payouts',
  },
  {
    q: 'How do I read the sales forecasting results?',
    a: 'Compare Historical (₱) with Projected (₱) for each brand. Growth % and Trend summarise the change, and Avg. Error (MAE) shows how far off the model was on past months. A forecast is an estimate, not a promise.',
    article: 'forecasting',
  },
  {
    q: 'Why do forecast values change when I pick a brand?',
    a: '"All Brands" adds every brand together. Picking one brand shows only that brand\'s line in the Sales Trend chart and its row in the Brand Forecasts table. The Historical vs Projected chart always shows every brand.',
    article: 'forecasting',
  },
  {
    q: 'Why does Sales Forecasting say no forecast has been generated yet?',
    a: 'A forecast needs about 12 months or more of monthly sales per brand, and the forecast job has to run. The owner can click Request New Forecast; it runs at the next scheduled job.',
    article: 'forecasting',
  },
  {
    q: 'How do I know which actions my role allows?',
    a: 'Your role is shown in Settings → Account Settings. The "User roles and permissions" guide lists the pages each role can open. On a page, buttons for actions your role cannot do are hidden.',
    article: 'roles-permissions',
  },
  {
    q: 'Why was I logged out?',
    a: 'You may have auto-logout turned on. Settings → "Log me out automatically when inactive" logs you out after 15, 30 or 60 minutes without activity. Choose Never to turn it off.',
    article: 'account-settings',
  },
  {
    q: 'I forgot my password. What do I do?',
    a: 'Passwords are reset by the owner. Ask the Super Admin to open Settings → Team Accounts and click Reset Password next to your name, then change the temporary password in Settings after logging in.',
    article: 'login-logout',
  },
  {
    q: 'What if a page does not show the information I expect?',
    a: 'Pages reload their data when you open them if it is more than a minute old, so open the page again from the sidebar. Check the search box and filters. If a save was refused, the reason appears in a notice at the bottom-right. If the problem continues, report it using Submit a Ticket.',
    article: 'navigating',
  },
];

const HelpPage = {
  view: 'home',      // 'home' | 'guides' | 'faqs' | 'ticket' | 'article'
  articleId: null,
  backView: 'home',  // where "Back" goes from an article
  query: '',
  lastQuery: '',     // restored when going back from an article opened from search results

  // ------------------------------------------------------------ helpers
  rich(text) {
    return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  },

  plain(text) {
    return String(text || '').replace(/\*\*/g, '');
  },

  article(id) {
    return HELP_ARTICLES.find((a) => a.id === id) || null;
  },

  /** Role keys from auth.js that a guide applies to. An empty list means every role. */
  roleKeysFor(a) {
    if (a.roles) return a.roles;
    if (!a.routes || a.routes.length === 0) return Object.keys(ROLES);
    return Object.keys(ROLES).filter((k) => a.routes.some((r) => ROLES[k].allowedRoutes.includes(r)));
  },

  canUse(a) {
    const role = Session.currentUser && Session.currentUser.role;
    if (!role) return false;
    if (a.roles) return a.roles.includes(role);
    if (!a.routes || a.routes.length === 0) return true;
    return a.routes.some((r) => Session.canAccess(r));
  },

  ticketUrl() {
    return /^https:\/\/\S+$/i.test(HELP_TICKET_URL) ? HELP_TICKET_URL : '';
  },

  matches(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (text) => words.every((w) => text.includes(w));
    const articles = HELP_ARTICLES.filter((a) => hit([a.title, a.summary, a.module, a.category, a.keywords, a.intro,
        ...a.steps].map((t) => this.plain(t)).join(' ').toLowerCase()));
    const faqs = HELP_FAQS.filter((f) => hit(`${f.q} ${f.a}`.toLowerCase()));
    return { articles, faqs };
  },

  // ------------------------------------------------------------- pieces
  topicRow(a, showRoleTag = false) {
    return `
      <button type="button" class="help-topic" data-help-article="${a.id}">
        <span class="help-topic-text">
          <span class="help-topic-title">${escapeHtml(a.title)}</span>
          <span class="help-topic-desc">${escapeHtml(a.summary)}</span>
          ${showRoleTag && !this.canUse(a) ? '<span class="help-role-tag">Not in your role</span>' : ''}
        </span>
        <i class="fa-solid fa-chevron-right help-topic-arrow" aria-hidden="true"></i>
      </button>`;
  },

  /** Rows split into two cards side by side (one card on small screens). */
  topicColumns(list) {
    const half = Math.ceil(list.length / 2);
    const col = (rows) => (rows.length ? `<div class="help-topic-card">${rows.map((a) => this.topicRow(a)).join('')}</div>` : '');
    return `<div class="help-topic-grid">${col(list.slice(0, half))}${col(list.slice(half))}</div>`;
  },

  faqItem(f) {
    return `
      <details class="help-faq">
        <summary><span>${escapeHtml(f.q)}</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>
        <div class="help-faq-body">
          <p>${escapeHtml(f.a)}</p>
          ${f.article && this.article(f.article) ? `<button type="button" class="help-link" data-help-article="${f.article}">Read the guide: ${escapeHtml(this.article(f.article).title)}</button>` : ''}
        </div>
      </details>`;
  },

  crumbs(current) {
    return `
      <nav class="help-crumbs" aria-label="Breadcrumb">
        <button type="button" class="help-link" data-help-view="home">Help Center</button>
        <span aria-hidden="true">›</span>
        <span>${escapeHtml(current)}</span>
      </nav>`;
  },

  // -------------------------------------------------------------- views
  homeHtml() {
    const popular = HELP_ARTICLES.filter((a) => a.popular);
    // Guides the user can act on come first, so each role sees its most useful topics.
    const ordered = [...popular.filter((a) => this.canUse(a)), ...popular.filter((a) => !this.canUse(a))].slice(0, 6);
    return `
      <h2 class="help-section-title">How can we help you?</h2>
      <div class="help-quick-grid">
        <button type="button" class="quick-action-btn help-quick-card" data-help-view="guides">
          <span class="help-quick-head">
            <svg class="help-quick-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 6.5C9.5 4.8 6.5 4.5 3 5.5v13c3.5-1 6.5-.7 9 1 2.5-1.7 5.5-2 9-1v-13c-3.5-1-6.5-.7-9 1z" /><path d="M12 6.5v13" />
            </svg>
            <span class="help-quick-title">User Guides</span>
          </span>
          <span class="help-quick-desc">Step-by-step guides on how to use each feature.</span>
        </button>
        <button type="button" class="quick-action-btn help-quick-card" data-help-view="faqs">
          <span class="help-quick-head">
            <svg class="help-quick-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9.5" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.7" /><circle cx="12" cy="17" r=".4" fill="currentColor" />
            </svg>
            <span class="help-quick-title">FAQs</span>
          </span>
          <span class="help-quick-desc">Find answers to common questions.</span>
        </button>
        <button type="button" class="quick-action-btn help-quick-card" data-help-view="ticket">
          <span class="help-quick-head">
            <svg class="help-quick-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V7z" /><path d="M15 7v10" stroke-dasharray="1.6 1.8" />
            </svg>
            <span class="help-quick-title">Submit a Ticket</span>
          </span>
          <span class="help-quick-desc">Report an issue or request assistance from the support team.</span>
        </button>
      </div>

      <div class="help-section-head">
        <h2 class="help-section-title">Popular Topics</h2>
        <button type="button" class="help-link" data-help-view="guides">Browse all guides</button>
      </div>
      ${this.topicColumns(ordered)}`;
  },

  guidesHtml() {
    return `
      ${this.crumbs('User Guides')}
      <h2 class="help-view-title">User Guides</h2>
      <p class="help-view-sub">Step-by-step guides for each part of Purse Maison. Guides marked "Not in your role" cover pages your role cannot open.</p>
      ${HELP_CATEGORIES.map((cat) => {
        const list = HELP_ARTICLES.filter((a) => a.category === cat);
        if (!list.length) return '';
        return `
          <h3 class="help-group-title">${escapeHtml(cat)}</h3>
          <div class="help-topic-card">${list.map((a) => this.topicRow(a, true)).join('')}</div>`;
      }).join('')}`;
  },

  faqsHtml() {
    return `
      ${this.crumbs('FAQs')}
      <h2 class="help-view-title">Frequently Asked Questions</h2>
      <p class="help-view-sub">Click a question to show the answer.</p>
      <div class="help-faq-list">${HELP_FAQS.map((f) => this.faqItem(f)).join('')}</div>`;
  },

  ticketHtml() {
    const url = this.ticketUrl();
    return `
      ${this.crumbs('Submit a Ticket')}
      <h2 class="help-view-title">Submit a Ticket</h2>
      ${url ? `
        <p class="help-view-sub">Report an issue or request assistance from the support team. The ticket form opens in a new tab.</p>
        <a class="btn-confirm help-ticket-open" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open ticket form <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>` : `
        <div class="help-callout">
          <strong>Online ticket submission is not connected yet.</strong>
          Purse Maison does not have a ticket form at the moment, so nothing is sent from this page.
          Report the problem directly to the owner (Super Admin), who manages staff accounts and roles.
        </div>`}
      <h3 class="help-group-title">Include these details</h3>
      <ol class="help-steps">
        <li>The page you were on (its name in the sidebar), and the <strong>Item ID</strong> or client name if there is one.</li>
        <li>What you clicked, what you expected, and what happened instead.</li>
        <li>The exact message shown in the notice at the bottom-right of the screen, if any.</li>
        <li>Your role (Settings → Account Settings → Role) and the time it happened.</li>
        <li>A screenshot, if you can take one.</li>
      </ol>
      <h3 class="help-group-title">Before reporting, check</h3>
      <div class="help-topic-card">
        ${[this.article('roles-permissions'), this.article('navigating')].filter(Boolean).map((a) => this.topicRow(a)).join('')}
        <button type="button" class="help-topic" data-help-view="faqs">
          <span class="help-topic-text">
            <span class="help-topic-title">Frequently Asked Questions</span>
            <span class="help-topic-desc">Answers to common access, inventory, sales and forecasting questions.</span>
          </span>
          <i class="fa-solid fa-chevron-right help-topic-arrow" aria-hidden="true"></i>
        </button>
      </div>`;
  },

  roleTableHtml() {
    const pages = [['dashboard', 'Dashboard']];
    NAV_ITEMS.forEach((item) => {
      if (item.children) item.children.forEach((c) => pages.push([c.route, c.label]));
      else if (item.route !== 'dashboard') pages.push([item.route, item.label]);
    });
    return `
      <div class="table-scroll help-role-table-wrap">
        <table class="data-table help-role-table">
          <thead><tr><th>Role</th><th>Pages this role can open</th></tr></thead>
          <tbody>${Object.values(ROLES).map((r) => `
            <tr><td class="cell-bold">${escapeHtml(r.label)}</td>
                <td>${escapeHtml(pages.filter(([route]) => r.allowedRoutes.includes(route)).map(([, label]) => label).join(', '))}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  },

  articleHtml() {
    const a = this.article(this.articleId);
    if (!a) return this.homeHtml();
    const back = { home: 'Help Center', guides: 'User Guides', faqs: 'FAQs', ticket: 'Submit a Ticket', search: 'Search results' }[this.backView] || 'Help Center';
    const labels = this.roleKeysFor(a).map((k) => ROLES[k] && ROLES[k].label).filter(Boolean);
    const allRoles = labels.length === Object.keys(ROLES).length;
    const canGo = a.go && Session.canAccess(a.go);
    const goLabel = (NAV_ITEMS.flatMap((n) => (n.children ? n.children : [n])).find((n) => n.route === a.go) || {}).label;
    const related = (a.related || []).map((id) => this.article(id)).filter(Boolean);
    return `
      <nav class="help-crumbs" aria-label="Breadcrumb">
        <button type="button" class="help-link" data-help-view="home">Help Center</button>
        <span aria-hidden="true">›</span>
        <button type="button" class="help-link" data-help-view="guides">User Guides</button>
        <span aria-hidden="true">›</span>
        <span>${escapeHtml(a.title)}</span>
      </nav>
      <article class="help-article">
        <h2 class="help-view-title">${escapeHtml(a.title)}</h2>
        <div class="help-meta">
          <span><strong>Module:</strong> ${escapeHtml(a.module)}</span>
          <span><strong>Applies to:</strong> ${allRoles ? 'All roles' : escapeHtml(labels.join(', '))}</span>
        </div>
        ${this.canUse(a) ? '' : `<div class="help-callout warn">Your role (${escapeHtml(Session.roleLabel())}) cannot do this task, so some of these pages or buttons will not appear for you.</div>`}
        <p class="help-intro">${this.rich(a.intro)}</p>
        <h3 class="help-group-title">Steps</h3>
        <ol class="help-steps">${a.steps.map((s) => `<li>${this.rich(s)}</li>`).join('')}</ol>
        ${a.showRoleTable ? this.roleTableHtml() : ''}
        <div class="help-article-actions">
          <button type="button" class="btn-secondary" data-help-back><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to ${escapeHtml(back)}</button>
          ${canGo && goLabel ? `<button type="button" class="btn-confirm" data-help-go="${a.go}">Go to ${escapeHtml(goLabel)}</button>` : ''}
        </div>
        ${related.length ? `<h3 class="help-group-title">Related guides</h3><div class="help-topic-card">${related.map((r) => this.topicRow(r)).join('')}</div>` : ''}
      </article>`;
  },

  searchHtml() {
    const { articles, faqs } = this.matches(this.query);
    const total = articles.length + faqs.length;
    if (!total) {
      return `
        <div class="help-empty" role="status">
          <span class="help-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /><path d="M8.5 11h5" />
            </svg>
          </span>
          <div class="help-empty-title">No results found</div>
          <p class="help-empty-text">We couldn't find a topic matching your search.</p>
        </div>`;
    }
    return `
      <div class="help-section-head">
        <h2 class="help-section-title">${total} result${total === 1 ? '' : 's'} for "${escapeHtml(this.query)}"</h2>
        <button type="button" class="help-link" data-help-clear>Clear search</button>
      </div>
      ${articles.length ? `<h3 class="help-group-title">Guides</h3>${this.topicColumns(articles)}` : ''}
      ${faqs.length ? `<h3 class="help-group-title">FAQs</h3><div class="help-faq-list">${faqs.map((f) => this.faqItem(f)).join('')}</div>` : ''}`;
  },

  mainHtml() {
    if (this.query.trim()) return this.searchHtml();
    if (this.view === 'guides') return this.guidesHtml();
    if (this.view === 'faqs') return this.faqsHtml();
    if (this.view === 'ticket') return this.ticketHtml();
    if (this.view === 'article') return this.articleHtml();
    return this.homeHtml();
  },

  // ------------------------------------------------------- render + bind
  render() {
    // Opening Help from the sidebar always starts at the Help Center home.
    this.view = 'home';
    this.articleId = null;
    this.backView = 'home';
    this.query = '';
    this.lastQuery = '';
    return `
      <div class="help-center" id="help-root">
        <h1 class="page-title help-title">Help Center</h1>
        <p class="help-subtitle">Find answers, guides, and support for using Purse Maison.</p>
        <div class="help-search" role="search">
          <label for="help-search-input" class="help-sr-only">Search help articles</label>
          <svg class="help-search-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="#0F2B48" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input type="search" id="help-search-input" class="help-search-input" placeholder="Search for help articles, topics, or keywords..." autocomplete="off" />
        </div>
        <div id="help-status" class="help-sr-only" role="status" aria-live="polite"></div>
        <div id="help-main">${this.mainHtml()}</div>
      </div>`;
  },

  redraw(scrollTop) {
    const main = document.getElementById('help-main');
    if (!main) return;
    main.innerHTML = this.mainHtml();
    const status = document.getElementById('help-status');
    if (status) {
      const q = this.query.trim();
      const m = q ? this.matches(q) : null;
      status.textContent = m ? `${m.articles.length + m.faqs.length} results for ${q}` : '';
    }
    if (scrollTop) {
      const content = document.getElementById('page-content');
      if (content) content.scrollTop = 0;
      document.getElementById('help-root')?.scrollIntoView({ block: 'start' });
    }
  },

  clearSearch() {
    this.query = '';
    const input = document.getElementById('help-search-input');
    if (input) input.value = '';
  },

  afterRender() {
    const root = document.getElementById('help-root');
    if (!root) return;

    const input = document.getElementById('help-search-input');
    input.addEventListener('input', debounce((e) => {
      this.query = e.target.value;
      this.redraw(false);
    }, 200));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) { this.clearSearch(); this.redraw(false); }
    });

    // One delegated listener for every link and button inside the Help Center.
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-help-view], [data-help-article], [data-help-back], [data-help-go], [data-help-clear]');
      if (!el || !root.contains(el)) return;

      if (el.dataset.helpClear !== undefined) {
        this.clearSearch();
        this.redraw(false);
        input.focus();
        return;
      }
      if (el.dataset.helpGo) {
        Router.navigate(el.dataset.helpGo);
        return;
      }
      if (el.dataset.helpBack !== undefined) {
        if (this.backView === 'search' && this.lastQuery) {
          this.view = 'home';
          this.query = this.lastQuery;
          input.value = this.lastQuery;
        } else {
          this.view = this.backView === 'search' ? 'home' : this.backView;
        }
        this.redraw(true);
        return;
      }
      if (el.dataset.helpArticle) {
        if (this.query.trim()) { this.backView = 'search'; this.lastQuery = this.query; }
        else if (this.view !== 'article') this.backView = this.view;
        this.view = 'article';
        this.articleId = el.dataset.helpArticle;
        this.clearSearch();
        this.redraw(true);
        return;
      }
      if (el.dataset.helpView) {
        this.view = el.dataset.helpView;
        this.clearSearch();
        this.redraw(true);
      }
    });
  },
};