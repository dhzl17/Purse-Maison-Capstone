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

  // --- Landing View Navigation ---
  document.getElementById('landing-enter-btn')?.addEventListener('click', () => {
    landingView.classList.add('hidden');
    loginView.classList.remove('hidden');
  });

  document.getElementById('login-back-btn')?.addEventListener('click', () => {
    loginView.classList.add('hidden');
    landingView.classList.remove('hidden');
  });

  // --- Password Toggle ---
  togglePasswordBtn.addEventListener('click', () => {
    const showing = passwordInput.type === 'text';
    passwordInput.type = showing ? 'password' : 'text';
    togglePasswordBtn.textContent = showing ? 'Show' : 'Hide';
  });

  // --- Quick Role Login Chips ---
  document.querySelectorAll('.role-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const user = chip.dataset.user;
      const pass = chip.dataset.pass;
      usernameInput.value = user;
      passwordInput.value = pass;
      
      performLogin(user, pass);
    });
  });

  // --- Login Form Submit ---
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    performLogin(usernameInput.value, passwordInput.value);
  });

  function performLogin(username, password) {
    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = 'Logging in…';

    setTimeout(() => {
      const error = Session.login(username, password);

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
    }, 250);
  }

  // --- Forgot Password Link ---
  document.getElementById('login-forgot-btn')?.addEventListener('click', () => {
    openModal({
      title: 'Reset Password',
      bodyHtml: `
        <p>Please enter your registered work email to receive password reset instructions.</p>
        <div class="field-group" style="margin-top:16px;">
          <label class="field-label">Work Email</label>
          <input class="field-input" type="email" placeholder="user@pursemaison.com" id="reset-email-input" />
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" data-close-modal>Cancel</button>
          <button class="btn-confirm" id="btn-send-reset">Send Reset Link</button>
        </div>
      `
    });
    document.querySelector('[data-close-modal]')?.addEventListener('click', closeModal);
    document.getElementById('btn-send-reset')?.addEventListener('click', () => {
      closeModal();
      showToast('Password reset link sent to your email.');
    });
  });

  // --- Logout Confirmation ---
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

    overlay.querySelector('#confirm-logout-btn').addEventListener('click', () => {
      overlay.remove();
      Session.logout();
      appView.classList.add('hidden');
      loginView.classList.remove('hidden');
      showToast('Logged out successfully.');
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

  function enterApp() {
    landingView.classList.add('hidden');
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    
    const targetRoute = Session.defaultRoute();
    Router.navigate(targetRoute);
    showToast(`Welcome back, ${Session.currentUser.fullName || Session.currentUser.username}!`);
  }
});
