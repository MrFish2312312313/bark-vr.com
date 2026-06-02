// BARKVR — main.js

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1511183372309758002/lR0Nr-eoMTwJvGlj5rk831mxc-KtFdUDpFJ7hN6aS3E2t0OafdI0rnhYbT-ZDMX-ESx9';

// Mobile menu toggle
function toggleMenu() {
  const menu = document.getElementById('mobileMenu');
  menu.classList.toggle('open');
}

// Close mobile menu when clicking outside
document.addEventListener('click', function(e) {
  const menu = document.getElementById('mobileMenu');
  const hamburger = document.querySelector('.hamburger');
  if (menu && menu.classList.contains('open')) {
    if (!menu.contains(e.target) && !hamburger.contains(e.target)) {
      menu.classList.remove('open');
    }
  }
});

// Nav transparency on scroll
window.addEventListener('scroll', function() {
  const nav = document.querySelector('nav');
  if (nav) {
    nav.style.background = window.scrollY > 40
      ? 'rgba(8,11,16,0.97)'
      : 'rgba(8,11,16,0.85)';
  }
});

// Fade-in on scroll
document.addEventListener('DOMContentLoaded', function() {
  const els = document.querySelectorAll(
    '.team-card, .role-card, .game-card-home, .game-detail-inner, .join-cta, .review-card'
  );
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity = '1';
        e.target.style.transform = 'translateY(0)';
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });

  els.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = `opacity 0.55s ${i * 0.07}s ease, transform 0.55s ${i * 0.07}s ease`;
    io.observe(el);
  });
});

// Application form → Discord webhook
async function handleSubmit(e) {
  e.preventDefault();

  const btn      = document.getElementById('submitBtn');
  const sending  = document.getElementById('formSending');
  const success  = document.getElementById('formSuccess');
  const error    = document.getElementById('formError');
  const form     = document.getElementById('applyForm');

  btn.disabled = true;
  btn.style.opacity = '0.5';
  sending.style.display = 'block';
  error.classList.remove('show');

  const get = id => (document.getElementById(id)?.value || '').trim();

  const name      = get('name');
  const email     = get('email');
  const pronouns  = get('pronouns');
  const position  = get('position');
  const hours     = get('hours');
  const interview = get('interview');
  const platform  = get('platform');
  const username  = get('username');
  const extra     = get('extra');

  const embed = {
    title: `📋 New Application — ${position}`,
    color: 0x00e5ff,
    fields: [
      { name: '👤 Name',        value: name,      inline: true  },
      { name: '📧 Email',       value: email,     inline: true  },
      { name: '🎭 Pronouns',    value: pronouns || 'Not provided', inline: true },
      { name: '💼 Role',        value: position,  inline: true  },
      { name: '⏰ Hours/Day',   value: hours,     inline: true  },
      { name: '📅 Interview',   value: interview, inline: true  },
      { name: '💬 Platform',    value: platform,  inline: true  },
      { name: '🔖 Username',    value: username,  inline: true  },
      { name: '📝 Extra Info',  value: extra || 'Nothing added', inline: false },
    ],
    footer: { text: 'BARKVR Careers' },
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (res.ok || res.status === 204) {
      form.style.display = 'none';
      sending.style.display = 'none';
      success.classList.add('show');
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    console.error('Webhook error:', err);
    btn.disabled = false;
    btn.style.opacity = '1';
    sending.style.display = 'none';
    error.classList.add('show');
  }
}
