import { firebaseConfig } from "./firebase-config.js";

const root = document.getElementById("app");

const state = {
  app: null,
  auth: null,
  db: null,
  user: null,
  profile: null,
  marker: null,
  authFns: null,
  dbFns: null,
  institutions: [],
  filter: "all",
  search: "",
  busy: false
};

const esc = v =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const money = v => `₹${Number(v || 0).toLocaleString("en-IN")}`;

function asDate(v) {
  if (v && typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string" && v) return new Date(v);
  return null;
}

function fmtDate(v) {
  const d = asDate(v);
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      })
    : "Not set";
}

function fmtTime(v) {
  const d = asDate(v);
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString("en-IN")
    : "—";
}

function expiry(d) {
  return asDate(d?.subscriptionExpiresAt);
}

function active(d) {
  const e = expiry(d);
  return d?.subscriptionStatus === "active" && e && e > new Date();
}

function statusName(d) {
  if (active(d)) return ["ACTIVE", "active"];
  if (d?.subscriptionStatus === "inactive") {
    return ["DEACTIVATED", "inactive"];
  }
  return [
    d?.subscriptionStatus === "pending"
      ? "PENDING"
      : "EXPIRED / NOT ACTIVE",
    "pending"
  ];
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = msg;
    el.classList.add("show");
  }
}

function setStatus(msg, bad = false) {
  const el = document.getElementById("status");
  if (el) {
    el.textContent = msg;
    el.classList.toggle("bad", bad);
  }
}

// FIX: Initialize Firebase only once.
async function init() {
  if (state.app && state.auth && state.db) return;

  const [appMod, authMod, dbMod] = await Promise.all([
    import(
      "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js"
    ),
    import(
      "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js"
    ),
    import(
      "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"
    )
  ]);

  state.app = appMod.initializeApp(firebaseConfig);
  state.auth = authMod.getAuth(state.app);
  state.db = dbMod.getFirestore(state.app);

  state.authFns = authMod;
  state.dbFns = dbMod;
}

function loginView() {
  root.innerHTML = `
    <main class="auth-wrap">
      <section class="auth-card">
        <div class="brand">
          <img src="assets/teachmate-official.png" alt="TeachMate">
          <div>
            <h1>TeachMate</h1>
            <p>Private account management</p>
          </div>
        </div>

        <div class="eyebrow">Restricted access</div>
        <h2>Account Console</h2>

        <p class="muted">
          Sign in with your dedicated administrator account.
          Access is granted only when the account has been
          explicitly authorized in Firestore.
        </p>

        <form id="loginForm">
          <div class="field">
            <label for="email">Administrator email</label>
            <input
              id="email"
              type="email"
              autocomplete="username"
              required
            >
          </div>

          <div class="field">
            <label for="password">Password</label>
            <input
              id="password"
              type="password"
              autocomplete="current-password"
              required
            >
          </div>

          <button
            id="loginBtn"
            class="btn primary full"
            type="submit"
          >
            Sign in securely
          </button>

          <div id="loginError" class="error" role="alert"></div>
        </form>

        <p class="note">
          This is a separate dashboard from the public TeachMate
          app. Do not share your administrator credentials.
          Subscription activation is manual and requires
          independently verified payment.
        </p>
      </section>
    </main>
  `;

  document.getElementById("loginForm").onsubmit = async e => {
    e.preventDefault();

    const b = document.getElementById("loginBtn");
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    b.disabled = true;
    b.textContent = "Verifying access…";

    const errorEl = document.getElementById("loginError");
    errorEl.textContent = "";
    errorEl.classList.remove("show");

    try {
      await init();

      const cred =
        await state.authFns.signInWithEmailAndPassword(
          state.auth,
          email,
          password
        );

      // Firestore functions come from dbFns.
      const { doc, getDoc } = state.dbFns;

      const [profileSnap, markerSnap] = await Promise.all([
        getDoc(doc(state.db, "users", cred.user.uid)),
        getDoc(doc(state.db, "superAdmins", cred.user.uid))
      ]);

      if (
        !profileSnap.exists() ||
        profileSnap.data().role !== "SUPER_ADMIN" ||
        !markerSnap.exists()
      ) {
        // FIX: signOut belongs to Firebase Auth, not Firestore.
        await state.authFns.signOut(state.auth);

        throw new Error(
          "This account is not authorized for the private account console. Check the users profile and superAdmins marker in Firestore."
        );
      }

      state.user = cred.user;
      state.profile = profileSnap.data();
      state.marker = markerSnap.data();

      await loadInstitutions();

    } catch (err) {
      showError("loginError", friendly(err));
    } finally {
      b.disabled = false;
      b.textContent = "Sign in securely";
    }
  };
}

function friendly(e) {
  const m = String(e?.message || e || "Something went wrong.");

  if (
    m.includes("auth/invalid-credential") ||
    m.includes("auth/wrong-password")
  ) {
    return "Incorrect email or password.";
  }

  if (m.includes("auth/too-many-requests")) {
    return "Too many attempts. Wait and try again.";
  }

  if (
    m.includes("permission-denied") ||
    m.includes("Missing or insufficient permissions")
  ) {
    return "Firestore denied this action. Check the Super Admin marker and deployed security rules.";
  }

  if (m.includes("Failed to fetch")) {
    return "Could not reach Firebase. Check your internet connection.";
  }

  return m.replace(/^Firebase:\s*/i, "");
}

async function logout() {
  try {
    if (state.auth && state.authFns) {
      await state.authFns.signOut(state.auth);
    }
  } finally {
    state.user = null;
    state.profile = null;
    state.marker = null;
    state.institutions = [];
    loginView();
  }
}

async function loadInstitutions() {
  try {
    setStatus("Loading institutions…");

    const { collection, getDocs } = state.dbFns;
    const snap = await getDocs(
      collection(state.db, "institutions")
    );

    state.institutions = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""))
      );

    dashboard();

  } catch (e) {
    dashboard();
    setStatus(friendly(e), true);
  }
}

function dashboard() {
  const total = state.institutions.length;
  const activeCount = state.institutions.filter(active).length;
  const pending = state.institutions.filter(x => !active(x)).length;

  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="topbrand">
          <img src="assets/teachmate-official.png" alt="">
          <div>
            TeachMate
            <small>PRIVATE ACCOUNT CONSOLE</small>
          </div>
        </div>
        <button id="logout" class="btn outline">Sign out</button>
      </header>

      <main class="main">
        <div class="head">
          <div>
            <div class="eyebrow">Subscription operations</div>
            <h1>Institutions</h1>
            <p>
              Verify the payment in your bank or UPI app before
              activating or renewing an account.
            </p>
          </div>
          <button id="refresh" class="btn secondary">↻ Refresh</button>
        </div>

        <div class="stats">
          <section class="stat">
            <div class="label">Total institutions</div>
            <div class="number">${total}</div>
          </section>
          <section class="stat">
            <div class="label">Active subscriptions</div>
            <div class="number">${activeCount}</div>
          </section>
          <section class="stat">
            <div class="label">Pending / expired</div>
            <div class="number">${pending}</div>
          </section>
        </div>

        <div id="status" class="status">
          Loaded ${total} institution(s).
        </div>

        <div class="toolbar">
          <input
            class="search"
            id="search"
            type="search"
            placeholder="Search name, email, phone or institution ID…"
            value="${esc(state.search)}"
          >

          <select id="filter" class="filter" aria-label="Filter institutions">
            <option value="all" ${state.filter === "all" ? "selected" : ""}>
              All institutions
            </option>
            <option value="active" ${state.filter === "active" ? "selected" : ""}>
              Active
            </option>
            <option value="pending" ${state.filter === "pending" ? "selected" : ""}>
              Pending / expired
            </option>
            <option value="inactive" ${state.filter === "inactive" ? "selected" : ""}>
              Deactivated
            </option>
          </select>
        </div>

        <div id="institutionList" class="list"></div>

        <p class="small">
          Signed in as ${esc(state.user?.email || "")}.
          Subscription changes are logged in Firestore under
          <code>subscriptionAudit</code>.
          Student sign-in remains independent of subscription status.
        </p>
      </main>
    </div>
  `;

  document.getElementById("logout").onclick = logout;
  document.getElementById("refresh").onclick = loadInstitutions;

  document.getElementById("search").oninput = e => {
    state.search = e.target.value;
    renderList();
  };

  document.getElementById("filter").onchange = e => {
    state.filter = e.target.value;
    renderList();
  };

  renderList();
}

function filtered() {
  const q = state.search.trim().toLowerCase();

  return state.institutions.filter(i => {
    const ok =
      state.filter === "all" ||
      (state.filter === "active" && active(i)) ||
      (
        state.filter === "pending" &&
        !active(i) &&
        i.subscriptionStatus !== "inactive"
      ) ||
      (
        state.filter === "inactive" &&
        i.subscriptionStatus === "inactive"
      );

    const text = [
      i.name,
      i.ownerName,
      i.email,
      i.phone,
      i.id,
      i.institutionId
    ].join(" ").toLowerCase();

    return ok && (!q || text.includes(q));
  });
}

function renderList() {
  const el = document.getElementById("institutionList");
  if (!el) return;

  const items = filtered();

  if (!items.length) {
    el.innerHTML =
      '<div class="empty">No institutions match this filter.</div>';
    return;
  }

  el.innerHTML = items.map(i => {
    const [label, cls] = statusName(i);
    const plan = i.subscriptionPlan || i.selectedPlan || "Not selected";

    return `
      <article class="institution">
        <div class="inst-head">
          <div>
            <h2>${esc(i.name || "Unnamed institution")}</h2>
            <p>
              ${esc(i.ownerName || "Owner not recorded")}
              · ${esc(i.email || "No email")}
            </p>
          </div>
          <span class="badge ${cls}">${label}</span>
        </div>

        <div class="details">
          <div class="detail">
            <span>Institution document ID</span>
            <strong>${esc(i.id)}</strong>
          </div>
          <div class="detail">
            <span>Phone</span>
            <strong>${esc(i.phone || "—")}</strong>
          </div>
          <div class="detail">
            <span>Selected / current plan</span>
            <strong>${esc(plan)}</strong>
          </div>
          <div class="detail">
            <span>Subscription expiry</span>
            <strong>${esc(fmtDate(i.subscriptionExpiresAt))}</strong>
          </div>
          <div class="detail">
            <span>Created</span>
            <strong>${esc(fmtDate(i.createdAt || i.subscriptionCreatedAt))}</strong>
          </div>
          <div class="detail">
            <span>Owner UID</span>
            <strong>${esc(i.ownerUid || "—")}</strong>
          </div>
        </div>

        <div class="action-area">
          <label for="ref-${esc(i.id)}">
            Verified UPI / bank transaction reference
            (required for activation)
          </label>

          <input
            id="ref-${esc(i.id)}"
            autocomplete="off"
            placeholder="Enter reference after confirming payment"
          >

          <div class="actions">
            <button class="btn primary" data-month="${esc(i.id)}">
              Activate / Extend 1 Month · ₹500
            </button>

            <button class="btn secondary" data-year="${esc(i.id)}">
              Activate / Extend 1 Year · ₹5,000
            </button>

            ${
              active(i)
                ? `<button class="btn danger" data-deactivate="${esc(i.id)}">
                     Deactivate subscription
                   </button>`
                : ""
            }
          </div>
        </div>
      </article>
    `;
  }).join("");

  el.querySelectorAll("[data-month]").forEach(b => {
    b.onclick = () => activate(b.dataset.month, "monthly");
  });

  el.querySelectorAll("[data-year]").forEach(b => {
    b.onclick = () => activate(b.dataset.year, "annual");
  });

  el.querySelectorAll("[data-deactivate]").forEach(b => {
    b.onclick = () => deactivate(b.dataset.deactivate);
  });
}

async function activate(id, plan) {
  const input = document.getElementById(`ref-${id}`);
  const reference = input?.value.trim();

  if (!reference) {
    alert("Enter the verified transaction reference first.");
    return;
  }

  const item = state.institutions.find(x => x.id === id);
  if (!item) return;

  const amount = plan === "monthly" ? 500 : 5000;
  const label = plan === "monthly" ? "one month" : "one year";

  if (!confirm(
    `Have you independently confirmed ₹${amount.toLocaleString("en-IN")} ` +
    `in your bank/UPI account for ${item.name || id}? ` +
    `This will activate or extend by ${label}.`
  )) {
    return;
  }

  try {
    setStatus("Saving subscription change…");

    const {
      doc,
      collection,
      runTransaction,
      Timestamp,
      serverTimestamp
    } = state.dbFns;

    const ref = doc(state.db, "institutions", id);
    const auditRef = doc(collection(state.db, "subscriptionAudit"));

    let updated;

    await runTransaction(state.db, async tx => {
      const snap = await tx.get(ref);

      if (!snap.exists()) {
        throw new Error("Institution record no longer exists.");
      }

      const d = snap.data();
      const current = expiry(d);
      const now = new Date();
      const base = current && current > now ? current : now;

      const next = new Date(base);

      if (plan === "monthly") {
        next.setMonth(next.getMonth() + 1);
      } else {
        next.setFullYear(next.getFullYear() + 1);
      }

      updated = {
        ...d,
        subscriptionStatus: "active",
        subscriptionPlan: plan,
        subscriptionExpiresAt: Timestamp.fromDate(next),
        lastPaymentReference: reference,
        lastPaymentVerifiedAt: Timestamp.fromDate(now),
        lastPaymentVerifiedBy: state.user.uid,
        updatedAt: Timestamp.fromDate(now)
      };

      tx.update(ref, {
        subscriptionStatus: "active",
        subscriptionPlan: plan,
        subscriptionExpiresAt: Timestamp.fromDate(next),
        lastPaymentReference: reference,
        lastPaymentVerifiedAt: Timestamp.fromDate(now),
        lastPaymentVerifiedBy: state.user.uid,
        updatedAt: Timestamp.fromDate(now)
      });

      tx.set(auditRef, {
        institutionId: id,
        institutionName: d.name || "",
        action: d.subscriptionStatus === "active"
          ? "renewed"
          : "activated",
        plan,
        amountINR: amount,
        paymentReference: reference,
        previousExpiry: d.subscriptionExpiresAt || null,
        newExpiry: Timestamp.fromDate(next),
        performedBy: state.user.uid,
        performedByEmail: state.user.email || "",
        createdAt: serverTimestamp()
      });
    });

    state.institutions = state.institutions.map(x =>
      x.id === id ? { ...x, ...updated } : x
    );

    dashboard();

    setStatus(
      `${item.name || id} is active until ` +
      `${fmtDate(updated.subscriptionExpiresAt)}.`
    );

    alert(
      `Subscription saved. New expiry: ` +
      `${fmtDate(updated.subscriptionExpiresAt)}.`
    );

  } catch (e) {
    setStatus(friendly(e), true);
    alert("Activation failed: " + friendly(e));
  }
}

async function deactivate(id) {
  const item = state.institutions.find(x => x.id === id);

  if (
    !item ||
    !confirm(
      `Deactivate the TeachMate subscription for ${item.name || id}? ` +
      `Student authentication is not disabled by this action.`
    )
  ) {
    return;
  }

  try {
    const {
      doc,
      collection,
      runTransaction,
      Timestamp,
      serverTimestamp
    } = state.dbFns;

    const ref = doc(state.db, "institutions", id);
    const auditRef = doc(collection(state.db, "subscriptionAudit"));
    const now = new Date();

    await runTransaction(state.db, async tx => {
      const snap = await tx.get(ref);

      if (!snap.exists()) {
        throw new Error("Institution record no longer exists.");
      }

      const d = snap.data();

      tx.update(ref, {
        subscriptionStatus: "inactive",
        updatedAt: Timestamp.fromDate(now)
      });

      tx.set(auditRef, {
        institutionId: id,
        institutionName: d.name || "",
        action: "deactivated",
        plan: d.subscriptionPlan || d.selectedPlan || "",
        amountINR: 0,
        paymentReference: "",
        previousExpiry: d.subscriptionExpiresAt || null,
        newExpiry: d.subscriptionExpiresAt || null,
        performedBy: state.user.uid,
        performedByEmail: state.user.email || "",
        createdAt: serverTimestamp()
      });
    });

    state.institutions = state.institutions.map(x =>
      x.id === id
        ? { ...x, subscriptionStatus: "inactive", updatedAt: new Date() }
        : x
    );

    dashboard();
    setStatus(`${item.name || id} subscription deactivated.`);

  } catch (e) {
    setStatus(friendly(e), true);
    alert("Deactivation failed: " + friendly(e));
  }
}

async function start() {
  loginView();
}

start();
