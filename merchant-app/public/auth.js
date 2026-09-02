document.addEventListener("DOMContentLoaded", async () => {
  const navLinks = document.querySelector(".nav-links");
  if (!navLinks) return;
  
  try {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    
    if (data.success && data.user) {
      if (data.user.role === "admin") {
        navLinks.innerHTML = `<a href="/admin">Admin Panel</a> <a href="#" id="nav-logout" style="color:var(--danger);">Logout</a>`;
      } else {
        navLinks.innerHTML = `<a href="/">Store</a> <a href="/orders">My Orders</a> <a href="#" id="nav-logout" style="color:var(--danger);">Logout</a>`;
      }
      
      const logoutBtn = document.getElementById("nav-logout");
      if (logoutBtn) {
        logoutBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          await fetch('/api/auth/logout', { method: 'POST' });
          window.location.href = '/login';
        });
      }
      
    } else {
      navLinks.innerHTML = `<a href="/login">Login</a>`;
    }
  } catch (err) {
    navLinks.innerHTML = `<a href="/login">Login</a>`;
  }
});
