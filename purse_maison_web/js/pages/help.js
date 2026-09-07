/**
 * Help page — mirrors screens/help_page.dart (a simple static info page).
 */

const HelpPage = {
  render() {
    return `
      <h1 class="page-title">Help &amp; Support</h1>
      <div class="card" style="max-width:640px;">
        <p style="font-size:14px;line-height:1.7;margin-bottom:14px;">
          Purse Maison helps you track consigned items, manage inventory, assign clients to
          sales associates, and forecast brand-level sales — all in one place.
        </p>
        <p style="font-size:14px;line-height:1.7;margin-bottom:14px;">
          <strong>Getting started:</strong> use the sidebar to move between Dashboard, Consignment
          Management, Inventory Management, Client Assignment, and Sales Forecasting. What you can
          see and edit depends on your role — Super Admin, Operational Staff, or Sales Associate.
        </p>
        <p style="font-size:14px;line-height:1.7;">
          Need more help? Contact your Purse Maison system administrator.
        </p>
      </div>
    `;
  },
  afterRender() {},
};
