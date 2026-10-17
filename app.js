(function () {
  "use strict";

  const config = window.TICKET_APP_CONFIG || {};
  const apiUrl = String(config.apiUrl || "").trim();
  const appTitle = String(config.appTitle || "بازبینی نمره");
  const ROLES = ["student", "corrector", "admin"];
  const tokens = {};
  ROLES.forEach((role) => { tokens[role] = sessionStorage.getItem("gt-" + role) || ""; });

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function setMessage(element, message, type) {
    element.textContent = message || "";
    element.className = "form-message" + (type ? " is-" + type : "");
  }

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function toLatinDigits(value) {
    return String(value == null ? "" : value)
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  }

  function prettyDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    try { return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(date); }
    catch (_) { return date.toLocaleString("fa-IR"); }
  }

  function addMeta(container, label, value) {
    const item = make("div", "meta-item");
    item.append(make("span", "meta-label", label), make("strong", "meta-value", value || "—"));
    container.appendChild(item);
  }

  /* ---------- ارتباط با Apps Script ---------- */
  function postApi(fields) {
    if (!apiUrl || !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(apiUrl)) {
      return Promise.reject(new Error("نشانی API هنوز تنظیم نشده است. مقدار apiUrl را در config.js وارد کن."));
    }
    return new Promise((resolve, reject) => {
      const requestId = randomId();
      const frameName = "ticket-api-" + requestId.replace(/[^a-zA-Z0-9]/g, "");
      const iframe = document.createElement("iframe");
      iframe.name = frameName;
      iframe.title = "پاسخ سامانه";
      iframe.setAttribute("aria-hidden", "true");
      iframe.className = "transport-frame";

      const form = document.createElement("form");
      form.method = "POST";
      form.action = apiUrl;
      form.target = frameName;
      form.acceptCharset = "UTF-8";
      form.className = "transport-form";
      Object.entries(Object.assign({}, fields, { requestId })).forEach(([name, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = typeof value === "string" ? value : JSON.stringify(value);
        form.appendChild(input);
      });

      let finished = false;
      let timeoutId;
      const finish = (callback, value) => {
        if (finished) return;
        finished = true;
        window.removeEventListener("message", onMessage);
        window.clearTimeout(timeoutId);
        form.remove();
        iframe.remove();
        callback(value);
      };
      const onMessage = (event) => {
        const data = event.data;
        if (!data || data.source !== "grade-ticket-api" || data.requestId !== requestId) return;
        finish(resolve, data);
      };
      window.addEventListener("message", onMessage);
      timeoutId = window.setTimeout(() => finish(reject, new Error("پاسخی از سامانه دریافت نشد. اتصال را بررسی کن و دوباره تلاش کن.")), 45000);
      document.body.append(iframe, form);
      form.submit();
    });
  }

  // فراخوانی با نشست نقش؛ اگر نشست منقضی بود، خودکار به صفحهٔ ورود برمی‌گردد.
  async function call(action, fields, role) {
    const payload = Object.assign({ action }, fields || {});
    if (role) payload.session = tokens[role];
    const result = await postApi(payload);
    if (!result.ok) {
      if (result.code === "SESSION" && role) logout(role, "نشست منقضی شده است؛ دوباره وارد شو.");
      throw new Error(result.error || "خطایی پیش آمد.");
    }
    return result;
  }

  /* ---------- وضعیت ورود ---------- */
  function setToken(role, value) {
    tokens[role] = value || "";
    if (value) sessionStorage.setItem("gt-" + role, value);
    else sessionStorage.removeItem("gt-" + role);
  }

  function showRole(role, loggedIn) {
    $("#" + role + "-login-wrap").hidden = loggedIn;
    $("#" + role + "-dashboard").hidden = !loggedIn;
  }

  function logout(role, message) {
    setToken(role, "");
    showRole(role, false);
    setMessage($("#" + role + "-login-message"), message || "", message ? "error" : "");
  }

  const loaders = { student: loadStudent, corrector: loadCorrectorTickets, admin: loadAdmin };

  function showView(name) {
    $$(".tab-button").forEach((button) => {
      const active = button.dataset.view === name;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    $$(".view").forEach((view) => {
      const active = view.id === "view-" + name;
      view.classList.toggle("is-visible", active);
      view.hidden = !active;
    });
    if (tokens[name]) { showRole(name, true); loaders[name](); }
    else showRole(name, false);
  }

  function bindLogin(role, buildFields) {
    const form = $("#" + role + "-login-form");
    const message = $("#" + role + "-login-message");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $("button[type='submit']", form);
      button.disabled = true;
      setMessage(message, "در حال بررسی…");
      try {
        const result = await call(role + "Login", buildFields(new FormData(form)));
        setToken(role, result.session);
        form.reset();
        setMessage(message, "");
        showRole(role, true);
        await loaders[role]();
      } catch (error) {
        setMessage(message, error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
    $("#" + role + "-logout").addEventListener("click", () => logout(role, "از پنل خارج شدی."));
  }

  /* ---------- دانش‌آموز ---------- */
  function statusBadge(status) {
    const answered = status === "answered";
    return make("span", "status-badge " + (answered ? "status-answered" : "status-open"), answered ? "پاسخ داده‌شده" : "در انتظار بررسی");
  }

  function renderStudentTickets(tickets) {
    const list = $("#student-ticket-list");
    list.replaceChildren();
    if (!tickets.length) { list.appendChild(make("div", "panel empty-state", "هنوز درخواستی ثبت نکرده‌ای.")); return; }
    tickets.forEach((ticket) => {
      const card = make("article", "panel student-ticket-card");
      const header = make("div", "ticket-card-header");
      const titleGroup = make("div", "ticket-title-group");
      titleGroup.append(make("span", "eyebrow", "کد پیگیری"), make("h3", "", ticket.id));
      header.append(titleGroup, statusBadge(ticket.status));
      card.appendChild(header);

      const meta = make("div", "ticket-meta");
      addMeta(meta, "درس", ticket.course);
      addMeta(meta, "زمان ثبت", prettyDate(ticket.createdAt));
      card.appendChild(meta);

      const reason = make("div", "detail-block");
      reason.append(make("span", "meta-label", "علت اعتراض"), make("p", "detail-text", ticket.reason));
      card.appendChild(reason);

      const response = make("div", "response-block " + (ticket.response ? "has-response" : ""));
      response.append(make("span", "response-label", ticket.response ? "پاسخ مصحح" + (ticket.correctorName ? " (" + ticket.correctorName + ")" : "") : "هنوز پاسخی ثبت نشده"));
      response.append(make("p", "detail-text", ticket.response || "بعد از ثبت پاسخ توسط مصحح، متن آن در همین بخش نمایش داده می‌شود."));
      if (ticket.respondedAt) response.append(make("small", "response-date", "زمان پاسخ: " + prettyDate(ticket.respondedAt)));
      card.appendChild(response);
      list.appendChild(card);
    });
  }

  async function loadStudent() {
    try {
      const result = await call("studentData", {}, "student");
      $("#student-name").textContent = result.name;
      const select = $("#course-select");
      const previous = select.value;
      select.replaceChildren(new Option("درس را انتخاب کن", "", true, true));
      select.options[0].disabled = true;
      result.courses.forEach((course) => select.appendChild(new Option(course, course)));
      if (previous && result.courses.includes(previous)) select.value = previous;
      renderStudentTickets(result.tickets);
    } catch (error) {
      setMessage($("#submit-message"), error.message, "error");
    }
  }

  /* ---------- مصحح ---------- */
  function renderCorrectorTickets(tickets) {
    const list = $("#ticket-list");
    const filter = $("#ticket-filter").value;
    const filtered = tickets.filter((ticket) => filter === "all" || ticket.status === filter);
    list.replaceChildren();
    $("#ticket-count").textContent = "درخواست‌ها · " + filtered.length;
    if (!filtered.length) {
      list.appendChild(make("div", "panel empty-state", filter === "all" ? "هنوز درخواستی ثبت نشده است." : "درخواستی در این وضعیت نیست."));
      return;
    }
    filtered.forEach((ticket) => {
      const card = make("article", "panel corrector-ticket-card");
      const header = make("div", "corrector-ticket-header");
      const person = make("div", "student-identity");
      person.append(make("h3", "", ticket.studentName), make("span", "national-id", "کد ملی: " + ticket.nationalId));
      const state = statusBadge(ticket.status);
      header.append(person, state);
      card.appendChild(header);

      const meta = make("div", "ticket-meta");
      addMeta(meta, "کد پیگیری", ticket.id);
      addMeta(meta, "درس", ticket.course);
      addMeta(meta, "زمان ثبت", prettyDate(ticket.createdAt));
      card.appendChild(meta);

      const reason = make("div", "detail-block");
      reason.append(make("span", "meta-label", "علت اعتراض دانش‌آموز"), make("p", "detail-text", ticket.reason));
      card.appendChild(reason);

      const responseLabel = make("label", "field corrector-response-field");
      responseLabel.appendChild(make("span", "", "پاسخ مصحح"));
      const responseInput = document.createElement("textarea");
      responseInput.rows = 3;
      responseInput.maxLength = 2000;
      responseInput.placeholder = "نتیجهٔ بررسی را برای دانش‌آموز بنویس…";
      responseInput.value = ticket.response || "";
      responseLabel.appendChild(responseInput);
      card.appendChild(responseLabel);

      const actions = make("div", "ticket-actions");
      const save = make("button", "button button-primary", ticket.status === "answered" ? "به‌روزرسانی پاسخ" : "ثبت پاسخ");
      save.type = "button";
      const feedback = make("span", "inline-feedback", "");
      save.addEventListener("click", async () => {
        const text = responseInput.value.trim();
        if (!text) { feedback.textContent = "متن پاسخ را وارد کن."; feedback.className = "inline-feedback is-error"; return; }
        save.disabled = true;
        feedback.textContent = "در حال ذخیره…";
        feedback.className = "inline-feedback";
        try {
          const result = await call("correctorReply", { ticketId: ticket.id, response: text }, "corrector");
          feedback.textContent = "پاسخ ذخیره شد.";
          feedback.className = "inline-feedback is-success";
          ticket.response = text;
          ticket.status = "answered";
          state.className = "status-badge status-answered";
          state.textContent = "پاسخ داده‌شده";
          save.textContent = "به‌روزرسانی پاسخ";
          window.setTimeout(() => { if ($("#ticket-filter").value === "open") loadCorrectorTickets(); }, 650);
        } catch (error) {
          feedback.textContent = error.message;
          feedback.className = "inline-feedback is-error";
        } finally {
          save.disabled = false;
        }
      });
      actions.append(save, feedback);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  async function loadCorrectorTickets() {
    const message = $("#corrector-message");
    setMessage(message, "در حال دریافت درخواست‌ها…");
    $("#refresh-tickets").disabled = true;
    try {
      const result = await call("correctorList", {}, "corrector");
      renderCorrectorTickets(result.tickets || []);
      setMessage(message, "");
    } catch (error) {
      setMessage(message, error.message, "error");
    } finally {
      $("#refresh-tickets").disabled = false;
    }
  }

  /* ---------- مدیر ---------- */
  let admin = { courses: [], correctors: [], students: [] };
  let editingCorrector = null;

  function adminMessage(text, type) { setMessage($("#admin-message"), text, type); }

  async function loadAdmin() {
    try {
      admin = await call("adminGet", {}, "admin");
      renderAdmin();
    } catch (error) {
      adminMessage(error.message, "error");
    }
  }

  function renderCourseChecks(selected) {
    const box = $("#corrector-courses");
    box.replaceChildren();
    const options = [["*", "همهٔ درس‌ها"]].concat(admin.courses.map((c) => [c, c]));
    options.forEach(([value, label]) => {
      const item = make("label", "check-item");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = value;
      input.checked = selected.includes(value);
      item.append(input, make("span", "", label));
      box.appendChild(item);
    });
    if (!admin.courses.length) box.appendChild(make("small", "field-hint", "اول درس‌ها را بالا تعریف و ذخیره کن."));
  }

  function itemRow(title, subtitle, actions) {
    const row = make("div", "item-row");
    const info = make("div");
    info.append(make("strong", "", title), make("small", "", subtitle));
    const box = make("div", "row-actions");
    actions.forEach((a) => box.appendChild(a));
    row.append(info, box);
    return row;
  }

  function actionButton(label, handler, cls) {
    const b = make("button", "button " + (cls || "button-secondary"), label);
    b.type = "button";
    b.addEventListener("click", handler);
    return b;
  }

  function renderAdmin() {
    $("#courses-text").value = admin.courses.join("\n");
    renderCourseChecks(editingCorrector ? editingCorrector.courses : []);

    const list = $("#corrector-list");
    list.replaceChildren();
    if (!admin.correctors.length) list.appendChild(make("div", "empty-state", "هنوز مصححی تعریف نشده است."));
    admin.correctors.forEach((c) => {
      const courses = c.courses.includes("*") ? "همهٔ درس‌ها" : c.courses.join("، ");
      list.appendChild(itemRow(c.name + " · " + c.username, "درس‌ها: " + courses, [
        actionButton("ویرایش", () => startEditCorrector(c)),
        actionButton("حذف", () => removeItem("adminDeleteCorrector", { username: c.username }, "مصحح «" + c.name + "» حذف شود؟"), "button-quiet")
      ]));
    });
    renderStudents();
  }

  function renderStudents() {
    const q = toLatinDigits($("#students-search").value).trim().toLowerCase();
    const filtered = admin.students.filter((s) => !q || s.name.toLowerCase().includes(q) || s.nationalId.includes(q));
    $("#students-count").textContent = "دانش‌آموزان · " + admin.students.length;
    const list = $("#students-list");
    list.replaceChildren();
    if (!filtered.length) list.appendChild(make("div", "empty-state", "موردی نیست."));
    filtered.slice(0, 200).forEach((s) => {
      list.appendChild(itemRow(s.name, "کد ملی: " + s.nationalId, [
        actionButton("حذف", () => removeItem("adminDeleteStudent", { nationalId: s.nationalId }, "«" + s.name + "» حذف شود؟"), "button-quiet")
      ]));
    });
    if (filtered.length > 200) list.appendChild(make("div", "empty-state", "فقط ۲۰۰ مورد اول نمایش داده شد؛ جستجو کن."));
  }

  async function removeItem(action, fields, question) {
    if (!window.confirm(question)) return;
    try {
      await call(action, fields, "admin");
      adminMessage("حذف شد.", "success");
      await loadAdmin();
    } catch (error) { adminMessage(error.message, "error"); }
  }

  function startEditCorrector(c) {
    editingCorrector = c;
    const form = $("#corrector-form");
    form.username.value = c.username;
    form.username.readOnly = true;
    form.name.value = c.name;
    form.password.value = "";
    form.password.placeholder = "خالی = بدون تغییر رمز";
    $("#corrector-cancel").hidden = false;
    renderCourseChecks(c.courses);
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function resetCorrectorForm() {
    editingCorrector = null;
    const form = $("#corrector-form");
    form.reset();
    form.username.readOnly = false;
    form.password.placeholder = "رمز مصحح";
    $("#corrector-cancel").hidden = true;
    renderCourseChecks([]);
  }

  function copyText(button, text) {
    const done = () => { button.textContent = "کپی شد ✓"; window.setTimeout(() => { button.textContent = "کپی فهرست"; }, 2000); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done).catch(() => window.prompt("کپی کن:", text));
    else window.prompt("کپی کن:", text);
  }

  function bindAdmin() {
    $("#save-courses").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const courses = $("#courses-text").value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      button.disabled = true;
      adminMessage("در حال ذخیره…");
      try {
        await call("adminSaveCourses", { courses: JSON.stringify(courses) }, "admin");
        adminMessage("درس‌ها ذخیره شد.", "success");
        await loadAdmin();
      } catch (error) { adminMessage(error.message, "error"); }
      finally { button.disabled = false; }
    });

    $("#corrector-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = $("button[type='submit']", form);
      const courses = $$("#corrector-courses input:checked").map((i) => i.value);
      button.disabled = true;
      adminMessage("در حال ذخیره…");
      try {
        await call("adminSaveCorrector", {
          username: form.username.value.trim(), name: form.name.value.trim(),
          password: form.password.value, courses: JSON.stringify(courses)
        }, "admin");
        adminMessage("مصحح ذخیره شد.", "success");
        resetCorrectorForm();
        await loadAdmin();
      } catch (error) { adminMessage(error.message, "error"); }
      finally { button.disabled = false; }
    });
    $("#corrector-cancel").addEventListener("click", resetCorrectorForm);

    $("#add-students").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const box = $("#students-result");
      button.disabled = true;
      adminMessage("در حال ثبت…");
      try {
        const result = await call("adminAddStudents", { text: $("#students-text").value }, "admin");
        adminMessage("");
        box.replaceChildren();
        box.hidden = false;
        if (result.saved.length) {
          const lines = result.saved.map((s) => s.name + " | " + s.nationalId + " | " + s.password);
          box.append(make("strong", "", result.saved.length + " دانش‌آموز ثبت یا به‌روزرسانی شد. رمزها را همین حالا برای توزیع کپی کن؛ بعداً قابل نمایش نیستند."));
          box.append(make("pre", "", lines.join("\n")));
          const copy = make("button", "button button-light", "کپی فهرست");
          copy.type = "button";
          copy.addEventListener("click", () => copyText(copy, lines.join("\n")));
          box.appendChild(copy);
          $("#students-text").value = "";
        }
        result.errors.forEach((e) => box.appendChild(make("div", "err", e)));
        await loadAdmin();
      } catch (error) { adminMessage(error.message, "error"); }
      finally { button.disabled = false; }
    });
    $("#students-search").addEventListener("input", renderStudents);
  }

  /* ---------- شروع ---------- */
  function init() {
    $("#app-title").textContent = appTitle;
    document.title = appTitle;
    if (!apiUrl) {
      const notice = $("#api-notice");
      notice.hidden = false;
      notice.textContent = "سامانه آمادهٔ تنظیم است؛ نشانی وب‌اپ Apps Script را طبق README در config.js وارد کن.";
    }
    $$(".tab-button").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));

    bindLogin("student", (d) => ({ nationalId: toLatinDigits(d.get("nationalId")).trim(), password: String(d.get("password") || "") }));
    bindLogin("corrector", (d) => ({ username: String(d.get("username") || "").trim(), password: String(d.get("password") || "") }));
    bindLogin("admin", (d) => ({ password: String(d.get("password") || "") }));

    $("#student-nid").addEventListener("input", (event) => {
      const input = event.currentTarget;
      input.value = toLatinDigits(input.value).replace(/[^0-9]/g, "").slice(0, 10);
    });
    $("#student-refresh").addEventListener("click", loadStudent);
    $("#ticket-filter").addEventListener("change", loadCorrectorTickets);
    $("#refresh-tickets").addEventListener("click", loadCorrectorTickets);

    $("#submit-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = $("#submit-message");
      const button = $("button[type='submit']", form);
      button.disabled = true;
      setMessage(message, "در حال ثبت درخواست…");
      try {
        const result = await call("studentSubmit", { course: form.course.value, reason: form.reason.value.trim() }, "student");
        setMessage(message, "درخواست ثبت شد (کد " + result.ticketId + "). پاسخ را در فهرست «درخواست‌های من» می‌بینی.", "success");
        form.reason.value = "";
        form.course.selectedIndex = 0;
        await loadStudent();
      } catch (error) {
        setMessage(message, error.message, "error");
      } finally {
        button.disabled = false;
      }
    });

    bindAdmin();
    showView("student");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
