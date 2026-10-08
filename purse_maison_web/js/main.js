/**
 * Entry point — wires the login form, logout, and the mobile sidebar
 * toggle, then boots straight to the login screen (mirrors main.dart +
 * login_page.dart + logout_page.dart).
 */

document.addEventListener('DOMContentLoaded', () => {
  const landingView = document.getElementById('landing-view');
  const loginView = document.getElementById('login-view');
  const appView = document.getElementById('app-view');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const loginSubmitBtn = document.getElementById('login-submit-btn');
  const passwordInput = document.getElementById('login-password');
  const togglePasswordBtn = document.getElementById('login-toggle-password');
  const usernameInput = document.getElementById('login-username');

  document.getElementById('landing-enter-btn')?.addEventListener('click', () => {
    landingView.classList.add('hidden');
    loginView.classList.remove('hidden');
  });

  document.getElementById('login-back-btn')?.addEventListener('click', () => {
    loginView.classList.add('hidden');
    landingView.classList.remove('hidden');
  });

  togglePasswordBtn.addEventListener('click', () => {
    const showing = passwordInput.type === 'text';
    passwordInput.type = showing ? 'password' : 'text';
    document.getElementById('eye-icon').style.display = showing ? '' : 'none';
    document.getElementById('eye-off-icon').style.display = showing ? 'none' : '';
    togglePasswordBtn.title = showing ? 'Show password' : 'Hide password';
  });

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    performLogin(usernameInput.value, passwordInput.value);
  });

  async function performLogin(username, password) {
    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = 'Logging in…';

    const error = await Session.login(username, password);

    loginSubmitBtn.disabled = false;
    loginSubmitBtn.textContent = 'Log In';

    if (error) {
      loginError.textContent = error;
      loginError.classList.remove('hidden');
      return;
    }
    loginError.classList.add('hidden');
    loginForm.reset();
    enterApp();
  }

  document.getElementById('login-forgot-btn')?.addEventListener('click', () => {
    const overlay = openModal({
      title: 'Forgot Password',
      bodyHtml: `
        <p>Staff passwords are reset by the owner.</p>
        <p style="margin-top:10px;">Ask the owner (Super Admin) to open <strong>Settings → Team Accounts</strong> and click
        <strong>Reset Password</strong> next to your name. They will give you a temporary password, which you can
        change in Settings after logging in.</p>
        <div class="modal-actions">
          <button class="btn-confirm" data-close-modal>OK</button>
        </div>
      `
    });
    overlay.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', closeModal));
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    showLogoutModal();
  });

  function showLogoutModal() {
    const modalHtml = `
      <div class="logout-modal-card">
        <h2 class="logout-modal-title">Log Out</h2>
        <p class="logout-modal-desc">
          Are you sure you want to log out of your account?<br/>
          You will need to sign in again to access the system.
        </p>
        <div class="logout-modal-actions">
          <button class="btn-logout-confirm" id="confirm-logout-btn">Log out</button>
          <button class="btn-logout-cancel" id="cancel-logout-btn">Cancel</button>
        </div>
      </div>
    `;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = modalHtml;
    document.getElementById('modal-root').appendChild(overlay);

    overlay.querySelector('#confirm-logout-btn').addEventListener('click', async () => {
      overlay.remove();
      await Session.logout();
      // Reload so nothing from this account stays in memory on a shared computer
      window.location.reload();
    });

    overlay.querySelector('#cancel-logout-btn').addEventListener('click', () => {
      overlay.remove();
    });
  }

  document.querySelector('.sidebar-footer [data-route="help"]').addEventListener('click', () => {
    Router.navigate('help');
    closeMobileSidebar();
  });

  const menuToggleBtn = document.getElementById('menu-toggle-btn');
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('sidebar-scrim');
  menuToggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    sidebar.classList.toggle('open');
    if (window.innerWidth < 1000) {
      scrim.classList.toggle('hidden');
    }
  });
  scrim.addEventListener('click', closeMobileSidebar);

  window.addEventListener('chartjs-ready', () => {
    if (Session.isLoggedIn()) Router.rerender();
  });

  async function enterApp() {
    landingView.classList.add('hidden');
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    document.getElementById('page-content').innerHTML = '<p class="cell-muted" style="padding:24px;">Loading your data…</p>';

    await DataStore.loadAll();

    const targetRoute = Session.defaultRoute();
    Router.navigate(targetRoute);
    showToast(`Welcome back, ${Session.currentUser.fullName || Session.currentUser.username}!`);
  }

  // Keep staff signed in across page refreshes (Supabase saves the session)
  Session.restore().then((restored) => { if (restored) enterApp(); });
});
