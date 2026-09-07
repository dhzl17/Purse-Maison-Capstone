/**
 * Router — mirrors widgets/app_shell.dart + widgets/app_sidebar.dart +
 * widgets/route_guard.dart. No real URL routing (no backend/server to
 * serve deep links from), just an in-memory "current route" that swaps
 * #page-content's contents — same single-running-instance model the
 * Flutter app used.
 */

const NAV_ITEMS = [
  { label: 'Dashboard', route: 'dashboard' },
  {
    label: 'Consignment Management',
    route: 'consignment',
    children: [
      { label: 'Overview & Status', route: 'consignment-overview' },
      { label: 'Inquiries & Pre-Intake', route: 'consignment-preintake' },
      { label: 'Intake & Agreements', route: 'consignment-intake' },
      { label: 'Authentication Service', route: 'consignment-auth' },
      { label: 'Photography Tasks', route: 'consignment-photo' },
      { label: 'Design & Listing', route: 'consignment-design' },
      { label: 'Pricing & Markup', route: 'consignment-pricing' },
      { label: 'Manager Approvals', route: 'consignment-approval' },
    ]
  },
  { label: 'Inventory Management', route: 'inventory' },
  { label: 'Client Assignment', route: 'clients' },
  { label: 'Sales Forecasting', route: 'forecasting' },
  { label: 'Settings', route: 'settings' },
];

const PAGES = {
  dashboard: DashboardPage,
  'consignment-overview': ConsignmentPage,
  'consignment-preintake': ConsignmentPage,
  'consignment-intake': ConsignmentPage,
  'consignment-auth': ConsignmentPage,
  'consignment-photo': ConsignmentPage,
  'consignment-design': ConsignmentPage,
  'consignment-pricing': ConsignmentPage,
  'consignment-approval': ConsignmentPage,
  consignment: ConsignmentPage,
  inventory: InventoryPage,
  clients: ClientsPage,
  forecasting: ForecastingPage,
  settings: SettingsPage,
  help: HelpPage,
};

const Router = {
  currentRoute: 'dashboard',
  expandedCategories: { consignment: true },

  buildSidebar() {
    const nav = document.getElementById('sidebar-nav');
    let html = '';

    NAV_ITEMS.forEach((item) => {
      if (item.children) {
        const allowedChildren = item.children.filter((child) => Session.canAccess(child.route));
        if (allowedChildren.length === 0) return;

        const isChildActive = allowedChildren.some((child) => child.route === this.currentRoute);
        if (isChildActive) this.expandedCategories[item.route] = true;
        const isExpanded = !!this.expandedCategories[item.route];

        html += `
          <div class="sidebar-tree-group">
            <button class="sidebar-item sidebar-parent-item ${isChildActive ? 'parent-active' : ''}" data-toggle-parent="${item.route}">
              <span class="sidebar-label">${item.label}</span>
              <span class="tree-arrow">${isExpanded ? '▲' : '▼'}</span>
            </button>
            <div class="sidebar-sub-tree ${isExpanded ? '' : 'collapsed'}">
              <div class="sub-tree-connector-line"></div>
              <div class="sub-tree-items">
                ${allowedChildren.map((child) => `
                  <button class="sidebar-sub-item ${child.route === this.currentRoute ? 'active' : ''}" data-route="${child.route}">
                    ${child.label}
                  </button>
                `).join('')}
              </div>
            </div>
          </div>
        `;
      } else {
        if (!Session.canAccess(item.route)) return;
        html += `
          <button class="sidebar-item ${item.route === this.currentRoute ? 'active' : ''}" data-route="${item.route}">
            <span class="sidebar-label">${item.label}</span>
          </button>
        `;
      }
    });

    nav.innerHTML = html;

    // Attach listeners
    nav.querySelectorAll('[data-toggle-parent]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cat = btn.dataset.toggleParent;
        this.expandedCategories[cat] = !this.expandedCategories[cat];
        this.buildSidebar();
      });
    });

    nav.querySelectorAll('[data-route]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.navigate(btn.dataset.route);
        closeMobileSidebar();
      });
    });
  },

  navigate(route) {
    this.currentRoute = route;
    this.buildSidebar();

    const content = document.getElementById('page-content');
    if (!Session.canAccess(route)) {
      content.innerHTML = `
        <div class="access-denied">
          <div class="icon">🔒</div>
          <h2 style="margin-bottom:8px;">Access Restricted</h2>
          <p>Your role (${escapeHtml(Session.roleLabel())}) doesn't have access to this page module.</p>
        </div>`;
      return;
    }

    const page = PAGES[route] || PAGES.dashboard;
    content.innerHTML = page.render(route);
    if (page.afterRender) page.afterRender(route);
    content.scrollTop = 0;
  },

  rerender() {
    this.navigate(this.currentRoute);
  },
};

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-scrim').classList.add('hidden');
}
