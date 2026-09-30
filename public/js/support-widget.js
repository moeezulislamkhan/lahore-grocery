// public/js/support-widget.js
// Injects a floating "Help & Support" button + panel with built-in FAQs
// (loaded from GET /api/support/faqs) and a contact form.
//
// Every submitted question is:
//   1. Saved to our own database via POST /api/support/message — so it shows
//      up in the Admin Panel's "Support Inbox" for tracking/resolving.
//   2. ALSO forwarded to FormSpree (https://formspree.io), which emails it
//      straight to whatever Gmail (or any inbox) you connect it to — no
//      email server of our own needed.
//
// ---- TO ENABLE EMAIL DELIVERY ----
// 1. Go to https://formspree.io and sign up (free tier is fine).
// 2. Create a new form and connect it to your Gmail address — Formspree
//    will send a confirmation email to that Gmail; click the link in it.
// 3. Formspree gives you a form endpoint that looks like:
//      https://formspree.io/f/abcdwxyz
//    Copy the ID part after "/f/" (e.g. "abcdwxyz").
// 4. Paste it into FORMSPREE_FORM_ID below. That's it — no backend/.env
//    change needed, since this call happens entirely in the browser.
//
// Leave FORMSPREE_FORM_ID empty to skip the email step (messages still get
// saved to the database and show up in the Admin Support Inbox either way).
const FORMSPREE_FORM_ID = 'xnpnapdo';

function initSupportWidget() {
  const fabHtml = `
    <button id="supportFab" aria-label="Help & Support">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
    </button>
    <div id="supportPanel">
      <div class="sp-head">
        <b>Help &amp; Support</b>
        <p>We usually reply within a few hours.</p>
      </div>
      <div class="sp-body">
        <div class="sp-tabs">
          <button id="tabFaqBtn" class="active">FAQs</button>
          <button id="tabAskBtn">Ask a question</button>
        </div>
        <div id="faqList"><p class="empty-note">Loading FAQs…</p></div>
        <form id="askForm" class="sp-form" style="display:none;">
          <div class="field"><label>Name</label><input type="text" id="askName" required></div>
          <div class="field"><label>Email</label><input type="email" id="askEmail" required></div>
          <div class="field"><label>Topic (optional)</label>
            <select id="askTopic">
              <option value="">General</option>
              <option value="Order issue">Order issue</option>
              <option value="Payment issue">Payment issue</option>
              <option value="Delivery">Delivery</option>
              <option value="Product question">Product question</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div class="field"><label>Your question</label><textarea id="askMessage" rows="4" required></textarea></div>
          <button type="submit" class="btn small">Send message</button>
        </form>
        <div id="askSuccess" class="sp-success" style="display:none;">
          <div class="ic">✅</div>
          <div>Thanks — we've got your message.</div>
          <b id="askTicketId" style="display:none;"></b>
        </div>
      </div>
    </div>
  `;
  const wrap = document.createElement('div');
  wrap.innerHTML = fabHtml;
  document.body.appendChild(wrap);

  const fab = document.getElementById('supportFab');
  const panel = document.getElementById('supportPanel');
  const tabFaqBtn = document.getElementById('tabFaqBtn');
  const tabAskBtn = document.getElementById('tabAskBtn');
  const faqList = document.getElementById('faqList');
  const askForm = document.getElementById('askForm');
  const askSuccess = document.getElementById('askSuccess');

  fab.addEventListener('click', () => panel.classList.toggle('open'));

  tabFaqBtn.addEventListener('click', () => {
    tabFaqBtn.classList.add('active'); tabAskBtn.classList.remove('active');
    faqList.style.display = 'block'; askForm.style.display = 'none'; askSuccess.style.display = 'none';
  });
  tabAskBtn.addEventListener('click', () => {
    tabAskBtn.classList.add('active'); tabFaqBtn.classList.remove('active');
    faqList.style.display = 'none'; askForm.style.display = 'flex'; askForm.style.flexDirection = 'column'; askForm.style.gap = '4px'; askSuccess.style.display = 'none';
  });

  API.get('/api/support/faqs').then(({ faqs }) => {
    faqList.innerHTML = faqs.map((f, i) => `
      <div class="faq-item${i === 0 ? ' open' : ''}">
        <div class="faq-q">${f.q}<span class="chev">▾</span></div>
        <div class="faq-a">${f.a}</div>
      </div>
    `).join('');
    faqList.querySelectorAll('.faq-item').forEach(item => {
      item.querySelector('.faq-q').addEventListener('click', () => {
        const wasOpen = item.classList.contains('open');
        // Close every other FAQ first, so only one answer is ever visible at a time.
        faqList.querySelectorAll('.faq-item.open').forEach(openItem => openItem.classList.remove('open'));
        // Then re-open this one, unless it was the one already open (lets clicking it again close it).
        if (!wasOpen) item.classList.add('open');
      });
    });
  }).catch(() => {
    faqList.innerHTML = '<p class="empty-note">Could not load FAQs right now.</p>';
  });

  askForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('askName').value.trim();
    const email = document.getElementById('askEmail').value.trim();
    const topic = document.getElementById('askTopic').value;
    const message = document.getElementById('askMessage').value.trim();
    const btn = askForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      // 1) Save to our own database — powers the Admin Panel's Support Inbox.
      const res = await API.post('/api/support/message', { name, email, topic, message });

      // 2) Also forward to Formspree, which emails it to your connected
      //    Gmail. Fire-and-forget: if this fails (e.g. no ID configured, or
      //    the user is offline to formspree.io specifically), the message
      //    is still safely saved above, so we don't block success on it.
      if (FORMSPREE_FORM_ID) {
        fetch(`https://formspree.io/f/${FORMSPREE_FORM_ID}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            name, email, topic: topic || 'General', message,
            formId: res.formId,
            _subject: `Shakarganj Support: ${topic || 'General'} — ${name}`,
          }),
        }).catch(() => { /* best-effort — DB save above already succeeded */ });
      }

      askForm.style.display = 'none';
      askSuccess.style.display = 'block';
      document.getElementById('askTicketId').textContent = `Form ID: ${res.formId}`;
      askForm.reset();
    } catch (err) {
      showMessage(err.message || 'Could not send your message — please try again.', 'Message not sent');
    } finally {
      btn.disabled = false; btn.textContent = 'Send message';
    }
  });
}
