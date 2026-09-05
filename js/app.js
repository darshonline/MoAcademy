// ===================================================================
// دفتري الدراسي — منطق التطبيق
// نموذج البيانات: كل البيانات (السنوات/المواد/الدروس) متخزنة في Supabase
// في جدول app_data (صف واحد id='main' فيه JSON كامل). كده أي تعديل
// من أي جهاز بيظهر فورًا على كل الأجهزة التانية.
// تسجيل دخول الأدمن بيستخدم Supabase Auth الحقيقي (إيميل + كلمة مرور).
// ===================================================================

const SUPABASE_CONFIGURED = typeof SUPABASE_URL !== 'undefined'
  && SUPABASE_URL && SUPABASE_URL.indexOf('YOUR_SUPABASE_URL') === -1;

const sb = SUPABASE_CONFIGURED ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let APPDATA = { years: [] };
let currentYearId = null;
let currentSubjectId = null;
let currentTab = 'explanation';
let adminMode = false;
let currentUserEmail = null;

const $page = document.getElementById('pageContent');
const $nav = document.getElementById('yearsNav');
const $modalRoot = document.getElementById('modalRoot');
const $app = document.getElementById('app');

// ===== Data access helpers =====
const getYear = (id) => APPDATA.years.find(y => y.id === id);
const getSubject = (yearId, subjId) => {
  const y = getYear(yearId);
  return y ? y.subjects.find(s => s.id === subjId) : null;
};
const getLesson = (yearId, subjId, lessonId) => {
  const s = getSubject(yearId, subjId);
  return s ? s.lessons.find(l => l.id === lessonId) : null;
};
const slug = (prefix) => prefix + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

// ===================================================================
// طبقة البيانات (Supabase)
// ===================================================================
async function loadAllData() {
  const { data, error } = await sb.from('app_data').select('data').eq('id', 'main').maybeSingle();
  if (error) throw error;
  APPDATA = (data && data.data) ? data.data : { years: [] };
}

async function saveData() {
  const { error } = await sb.from('app_data').upsert({ id: 'main', data: APPDATA, updated_at: new Date().toISOString() });
  if (error) {
    alert('حصل خطأ أثناء حفظ البيانات على السيرفر: ' + error.message);
    throw error;
  }
}

async function fetchSeedData() {
  const manifestRes = await fetch('data/manifest.json');
  const manifest = await manifestRes.json();
  const years = [];
  for (const y of manifest.years) {
    const res = await fetch('data/' + y.file);
    years.push(await res.json());
  }
  return { years };
}

// يحمّل البيانات التجريبية الأصلية من ملفات المشروع ويرفعها لـ Supabase
// (يُستخدم أول مرة، أو للاستعادة لو حابب)
async function seedFromDefaults() {
  APPDATA = await fetchSeedData();
  await saveData();
}

// ===== Results (Supabase) =====
async function saveResult(subjectId, subjectName, lessonId, lessonTitle, score, total) {
  const { error } = await sb.from('quiz_results').insert({
    subject_id: subjectId, subject_name: subjectName,
    lesson_id: lessonId, lesson_title: lessonTitle, score, total
  });
  if (error) alert('تعذّر حفظ النتيجة: ' + error.message);
}
async function getResults() {
  const { data, error } = await sb.from('quiz_results').select('*').order('created_at', { ascending: false });
  if (error) { alert('تعذّر تحميل النتائج: ' + error.message); return []; }
  return data || [];
}
async function clearResults() {
  const { error } = await sb.from('quiz_results').delete().not('id', 'is', null);
  if (error) alert('تعذّر مسح النتائج: ' + error.message);
}

// ===================================================================
// حماية وضع الأدمن — Supabase Auth حقيقي (إيميل + كلمة مرور)
// بيشتغل بنفس الحساب على أي جهاز، ومفيش داعي لكلمة مرور منفصلة لكل جهاز.
// ===================================================================
async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

async function requestAdminAccess() {
  return new Promise((resolve) => {
    openModal({
      title: 'دخول وضع الأدمن',
      bodyHtml: `
        <div class="field"><label>البريد الإلكتروني</label><input type="text" id="fEmail" autocomplete="username"></div>
        <div class="field"><label>كلمة المرور</label><input type="password" id="fPwCheck" autocomplete="current-password"></div>
        <p class="field-hint">لازم يكون الحساب ده متعمل مسبقًا من لوحة تحكم Supabase (Authentication → Users).</p>
      `,
      saveLabel: 'دخول',
      onSave: async (body) => {
        const email = body.querySelector('#fEmail').value.trim();
        const password = body.querySelector('#fPwCheck').value;
        if (!email || !password) { alert('من فضلك اكتب البريد الإلكتروني وكلمة المرور'); return false; }
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) { alert('بيانات الدخول غير صحيحة: ' + error.message); return false; }
        currentUserEmail = data.user.email;
        resolve(true);
      }
    });
    document.getElementById('modalOverlay')?.addEventListener('click', (e) => { if (e.target.id === 'modalOverlay') resolve(false); });
    document.getElementById('modalCloseBtn')?.addEventListener('click', () => resolve(false));
    document.getElementById('modalCancelBtn')?.addEventListener('click', () => resolve(false));
  });
}

async function signOutAdmin() {
  await sb.auth.signOut();
  currentUserEmail = null;
  adminMode = false;
}

// ===================================================================
// Modal system
// ===================================================================
function openModal({ title, bodyHtml, onMount, onSave, saveLabel = 'حفظ', danger = false }) {
  $modalRoot.innerHTML = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box">
        <div class="modal-head">
          <h3>${title}</h3>
          <button class="modal-close" id="modalCloseBtn">×</button>
        </div>
        <div class="modal-body" id="modalBody">${bodyHtml}</div>
        <div class="modal-foot">
          <button class="btn-secondary" id="modalCancelBtn">إلغاء</button>
          <button class="${danger ? 'btn-danger' : 'btn-primary'}" id="modalSaveBtn">${saveLabel}</button>
        </div>
      </div>
    </div>
  `;
  const close = () => { $modalRoot.innerHTML = ''; };
  document.getElementById('modalCloseBtn').addEventListener('click', close);
  document.getElementById('modalCancelBtn').addEventListener('click', close);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') close();
  });
  if (onMount) onMount(document.getElementById('modalBody'));
  document.getElementById('modalSaveBtn').addEventListener('click', () => {
    const result = onSave(document.getElementById('modalBody'));
    if (result && typeof result.then === 'function') {
      result.then(ok => { if (ok !== false) close(); });
    } else if (result !== false) {
      close();
    }
  });
}

// Helper: renders a dynamic list of single text inputs with add/remove
function renderDynList(containerId, items, placeholder) {
  return `
    <div class="dyn-list" id="${containerId}">
      ${items.map((val) => `
        <div class="dyn-row">
          <input type="text" value="${escapeAttr(val)}" placeholder="${placeholder}">
          <button type="button" class="mini-btn-x" data-remove-row>✕</button>
        </div>
      `).join('')}
    </div>
    <button type="button" class="btn-secondary small-add" data-add-row="${containerId}">+ إضافة</button>
  `;
}
function wireDynList(containerId, placeholder) {
  const addBtn = document.querySelector(`[data-add-row="${containerId}"]`);
  const container = document.getElementById(containerId);
  addBtn.addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'dyn-row';
    row.innerHTML = `<input type="text" placeholder="${placeholder}"><button type="button" class="mini-btn-x" data-remove-row>✕</button>`;
    container.appendChild(row);
  });
  container.addEventListener('click', (e) => {
    if (e.target.matches('[data-remove-row]')) e.target.closest('.dyn-row').remove();
  });
}
function readDynList(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} input`))
    .map(i => i.value.trim()).filter(Boolean);
}
function escapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;');
}
function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===================================================================
// Sidebar rendering
// ===================================================================
function renderSidebar() {
  $nav.innerHTML = `
    ${adminMode ? '<button class="add-row-btn" id="addYearBtn">+ سنة دراسية جديدة</button>' : ''}
  `;

  APPDATA.years.forEach(year => {
    const block = document.createElement('div');
    block.className = 'year-block';

    const row = document.createElement('div');
    row.className = 'year-row';
    row.innerHTML = `
      <button class="year-toggle"><span>${escapeHtml(year.name)}</span><span class="chev">›</span></button>
      ${adminMode ? `
        <button class="mini-btn" data-edit-year="${year.id}" title="تعديل الاسم">✎</button>
        <button class="mini-btn" data-delete-year="${year.id}" title="حذف السنة">🗑</button>
      ` : ''}
    `;

    const list = document.createElement('ul');
    list.className = 'subject-list';

    year.subjects.forEach(subj => {
      const li = document.createElement('li');
      li.className = 'subject-row';
      const isActive = currentYearId === year.id && currentSubjectId === subj.id;
      li.innerHTML = `
        <div class="subject-item ${isActive ? 'active' : ''}" style="border-inline-start-color:${subj.color || 'transparent'}" data-open-subject="${subj.id}" data-open-year="${year.id}">${escapeHtml(subj.name)}</div>
        ${adminMode ? `
          <button class="mini-btn" data-edit-subject="${subj.id}" data-subject-year="${year.id}" title="تعديل">✎</button>
          <button class="mini-btn" data-delete-subject="${subj.id}" data-subject-year="${year.id}" title="حذف">🗑</button>
        ` : ''}
      `;
      list.appendChild(li);
    });

    if (adminMode) {
      const addSubjLi = document.createElement('li');
      addSubjLi.innerHTML = `<button class="add-row-btn" data-add-subject="${year.id}">+ مادة جديدة</button>`;
      list.appendChild(addSubjLi);
    }

    if (currentYearId === year.id) {
      row.querySelector('.year-toggle').classList.add('open');
      list.classList.add('open');
    }

    block.appendChild(row);
    block.appendChild(list);
    $nav.appendChild(block);
  });

  if (adminMode) {
    document.getElementById('addYearBtn').addEventListener('click', () => openYearModal(null));
  }
  document.querySelectorAll('.year-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('open');
      btn.closest('.year-row').nextElementSibling.classList.toggle('open');
    });
  });
  document.querySelectorAll('[data-open-subject]').forEach(el => {
    el.addEventListener('click', () => {
      currentYearId = el.dataset.openYear;
      currentSubjectId = el.dataset.openSubject;
      currentTab = 'explanation';
      renderSidebar();
      renderSubjectPage();
      closeMobileSidebar();
    });
  });
  document.querySelectorAll('[data-edit-year]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openYearModal(getYear(btn.dataset.editYear)); });
  });
  document.querySelectorAll('[data-delete-year]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const year = getYear(btn.dataset.deleteYear);
      if (confirm(`متأكد إنك عايز تحذف "${year.name}" وكل المواد والدروس اللي جواها؟`)) {
        APPDATA.years = APPDATA.years.filter(y => y.id !== year.id);
        if (currentYearId === year.id) { currentYearId = null; currentSubjectId = null; renderWelcome(); }
        await saveData();
        renderSidebar();
      }
    });
  });
  document.querySelectorAll('[data-add-subject]').forEach(btn => {
    btn.addEventListener('click', () => openSubjectModal(btn.dataset.addSubject, null));
  });
  document.querySelectorAll('[data-edit-subject]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSubjectModal(btn.dataset.subjectYear, getSubject(btn.dataset.subjectYear, btn.dataset.editSubject));
    });
  });
  document.querySelectorAll('[data-delete-subject]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const year = getYear(btn.dataset.subjectYear);
      const subj = getSubject(btn.dataset.subjectYear, btn.dataset.deleteSubject);
      if (confirm(`متأكد إنك عايز تحذف مادة "${subj.name}" وكل دروسها؟`)) {
        year.subjects = year.subjects.filter(s => s.id !== subj.id);
        if (currentSubjectId === subj.id) { currentSubjectId = null; renderWelcome(); }
        await saveData();
        renderSidebar();
      }
    });
  });
}

document.getElementById('adminModeToggle').addEventListener('change', async (e) => {
  const wantsOn = e.target.checked;
  if (!wantsOn) {
    await signOutAdmin();
    renderSidebar();
    if (currentSubjectId) renderSubjectPage(); else renderWelcome();
    return;
  }
  e.target.checked = false;
  const granted = await requestAdminAccess();
  adminMode = granted;
  e.target.checked = granted;
  renderSidebar();
  if (currentSubjectId) renderSubjectPage(); else renderWelcome();
});

document.getElementById('resultsBtn').addEventListener('click', () => { renderResultsPage(); closeMobileSidebar(); });
document.getElementById('settingsBtn').addEventListener('click', () => { renderSettingsPage(); closeMobileSidebar(); });

// ===== Theme toggle =====
const $themeToggle = document.getElementById('themeToggle');
function applyThemeIcon() {
  const theme = document.documentElement.getAttribute('data-theme');
  $themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
}
applyThemeIcon();
$themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('dafatri_theme', next);
  applyThemeIcon();
});

// ===== Mobile sidebar drawer =====
function closeMobileSidebar() { $app.classList.remove('sidebar-open'); }
document.getElementById('mobileMenuBtn').addEventListener('click', () => $app.classList.toggle('sidebar-open'));
document.getElementById('sidebarBackdrop').addEventListener('click', closeMobileSidebar);

// ===================================================================
// Year / Subject modals
// ===================================================================
function openYearModal(year) {
  const isNew = !year;
  openModal({
    title: isNew ? 'إضافة سنة دراسية' : 'تعديل السنة الدراسية',
    bodyHtml: `
      <div class="field">
        <label>اسم السنة الدراسية</label>
        <input type="text" id="fYearName" value="${escapeAttr(year ? year.name : '')}" placeholder="مثال: الصف الثاني الإعدادي">
      </div>
    `,
    onSave: async (body) => {
      const name = body.querySelector('#fYearName').value.trim();
      if (!name) { alert('من فضلك اكتب اسم السنة'); return false; }
      if (isNew) {
        APPDATA.years.push({ id: slug('year'), name, subjects: [] });
      } else {
        year.name = name;
      }
      await saveData();
      renderSidebar();
    }
  });
}

function openSubjectModal(yearId, subject) {
  const isNew = !subject;
  const defaultColors = ['#A63D40', '#3F6D4E', '#2B6CB0', '#8B5E3C', '#6B4E9E', '#B8860B'];
  const color = subject ? subject.color : defaultColors[Math.floor(Math.random() * defaultColors.length)];
  openModal({
    title: isNew ? 'إضافة مادة دراسية' : 'تعديل المادة الدراسية',
    bodyHtml: `
      <div class="field">
        <label>اسم المادة</label>
        <input type="text" id="fSubjName" value="${escapeAttr(subject ? subject.name : '')}" placeholder="مثال: اللغة العربية">
      </div>
      <div class="field">
        <label>لون مميز للمادة</label>
        <input type="color" id="fSubjColor" value="${color}">
      </div>
    `,
    onSave: async (body) => {
      const name = body.querySelector('#fSubjName').value.trim();
      const col = body.querySelector('#fSubjColor').value;
      if (!name) { alert('من فضلك اكتب اسم المادة'); return false; }
      const year = getYear(yearId);
      if (isNew) {
        year.subjects.push({ id: slug('subj'), name, color: col, lessons: [] });
      } else {
        subject.name = name;
        subject.color = col;
      }
      await saveData();
      renderSidebar();
      if (currentSubjectId === (subject && subject.id)) renderSubjectPage();
    }
  });
}

// ===================================================================
// Subject page with tabs
// ===================================================================
function renderWelcome() {
  $page.innerHTML = `
    <div class="welcome">
      <h1>اهلاً بيك</h1>
      <p>اختر مادة من الشريط الجانبي عشان تبدأ الشرح، المراجعة، أو التقييم.</p>
      ${adminMode ? '<p>وضع الأدمن مفعّل — تقدر تضيف سنوات ومواد ودروس من الشريط الجانبي وصفحة كل مادة.</p>' : ''}
    </div>
  `;
}

function renderSubjectPage() {
  const subj = getSubject(currentYearId, currentSubjectId);
  const year = getYear(currentYearId);
  if (!subj) { renderWelcome(); return; }

  const tabLabels = { explanation: 'الشرح', review: 'المراجعة', test: 'التقييم' };

  $page.innerHTML = `
    <div class="subject-header">
      <span class="subject-dot" style="background:${subj.color || '#999'}"></span>
      <h1>${escapeHtml(subj.name)}</h1>
    </div>
    <div class="year-label">${escapeHtml(year.name)}</div>
    <div class="tabbar">
      ${Object.keys(tabLabels).map(k => `
        <button class="tab-btn ${currentTab === k ? 'active' : ''}" data-tab="${k}">${tabLabels[k]}</button>
      `).join('')}
    </div>
    <div id="tabContent"></div>
  `;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => { currentTab = btn.dataset.tab; renderSubjectPage(); });
  });

  renderTabContent();
}

function renderTabContent() {
  const container = document.getElementById('tabContent');
  const subj = getSubject(currentYearId, currentSubjectId);

  const listHtml = `
    <ul class="lesson-list">
      ${subj.lessons.map(lesson => `
        <li class="lesson-row" data-lesson="${lesson.id}">
          <div>
            <div class="lesson-row-title">${escapeHtml(lesson.title)}</div>
            ${currentTab === 'test' ? `<div class="lesson-row-meta">${lesson.test.questions.length} أسئلة · ${lesson.test.durationMinutes} د</div>` : ''}
          </div>
          <div class="admin-actions">
            ${adminMode ? `
              <button class="icon-btn" data-edit="${lesson.id}">تعديل</button>
              <button class="icon-btn" data-delete="${lesson.id}">حذف</button>
            ` : '<span>›</span>'}
          </div>
        </li>
      `).join('')}
    </ul>
    ${subj.lessons.length === 0 ? '<div class="empty-state">لسه مفيش دروس في المادة دي.</div>' : ''}
    ${adminMode ? `<button class="btn-primary" id="addLessonBtn">+ إضافة درس جديد</button>` : ''}
  `;

  container.innerHTML = listHtml;

  container.querySelectorAll('.lesson-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit], [data-delete]')) return;
      const lesson = subj.lessons.find(l => l.id === row.dataset.lesson);
      if (currentTab === 'test') renderQuiz(lesson);
      else renderLessonSection(lesson, currentTab);
    });
  });

  if (adminMode) {
    container.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLessonModal(subj.lessons.find(l => l.id === btn.dataset.edit));
      });
    });
    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('متأكد من حذف الدرس؟')) {
          subj.lessons = subj.lessons.filter(l => l.id !== btn.dataset.delete);
          await saveData();
          renderTabContent();
        }
      });
    });
    document.getElementById('addLessonBtn').addEventListener('click', () => openLessonModal(null));
  }
}

// ===== Explanation / Review content view =====
function renderLessonSection(lesson, tab) {
  const container = document.getElementById('tabContent');
  const data = lesson[tab];
  const label = tab === 'explanation' ? 'الشرح' : 'المراجعة';

  let mediaHtml = '';
  if (tab === 'explanation') {
    if (data.videoUrl) mediaHtml += `<video controls style="width:100%;border-radius:4px;margin-bottom:16px" src="${data.videoUrl}"></video>`;
    if (data.audioUrl) mediaHtml += `<audio controls style="width:100%;margin-bottom:16px" src="${data.audioUrl}"></audio>`;
  }

  let questionsHtml = '';
  if (tab === 'review' && data.questions && data.questions.length) {
    questionsHtml = `<h2 style="margin-top:24px;font-size:16px">أسئلة للمراجعة الذاتية</h2>
      <ul>${data.questions.map(q => `<li style="margin-bottom:8px">${escapeHtml(q)}</li>`).join('')}</ul>`;
  }

  container.innerHTML = `
    <button class="back-link" id="backBtn">‹ رجوع لقائمة الدروس</button>
    <div class="content-card">
      <h2>${escapeHtml(lesson.title)} — ${label}</h2>
      ${mediaHtml}
      <p>${escapeHtml(data.text) || 'لا يوجد محتوى بعد.'}</p>
      ${questionsHtml}
    </div>
  `;
  document.getElementById('backBtn').addEventListener('click', renderTabContent);
}

// ===== Quiz =====
function renderQuiz(lesson) {
  const container = document.getElementById('tabContent');
  const questions = lesson.test.questions;
  const answers = {};

  if (!questions.length) {
    container.innerHTML = `
      <button class="back-link" id="backBtn">‹ رجوع لقائمة الدروس</button>
      <div class="content-card"><p>لسه مفيش أسئلة في التقييم ده.</p></div>
    `;
    document.getElementById('backBtn').addEventListener('click', renderTabContent);
    return;
  }

  container.innerHTML = `
    <button class="back-link" id="backBtn">‹ رجوع لقائمة الدروس</button>
    <div class="content-card">
      <h2>${escapeHtml(lesson.title)} — التقييم</h2>
      <form id="quizForm">
        ${questions.map((q, qi) => `
          <div class="quiz-q" data-q="${qi}">
            <div class="quiz-q-title">${qi + 1}. ${escapeHtml(q.question)}</div>
            <div class="quiz-options">
              ${q.options.map((opt, oi) => `
                <div class="quiz-option" data-q="${qi}" data-o="${oi}">${escapeHtml(opt)}</div>
              `).join('')}
            </div>
          </div>
        `).join('')}
        <button type="button" class="btn-primary" id="submitQuiz">تسليم الإجابات</button>
      </form>
    </div>
  `;

  document.getElementById('backBtn').addEventListener('click', renderTabContent);

  container.querySelectorAll('.quiz-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const qi = opt.dataset.q;
      container.querySelectorAll(`.quiz-option[data-q="${qi}"]`).forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      answers[qi] = parseInt(opt.dataset.o);
    });
  });

  document.getElementById('submitQuiz').addEventListener('click', async () => {
    let score = 0;
    questions.forEach((q, qi) => {
      const chosen = answers[qi];
      const opts = container.querySelectorAll(`.quiz-option[data-q="${qi}"]`);
      opts.forEach((o, oi) => {
        if (oi === q.correctIndex) o.classList.add('correct');
        else if (oi === chosen) o.classList.add('incorrect');
        o.style.pointerEvents = 'none';
      });
      if (chosen === q.correctIndex) score++;
    });

    const subj = getSubject(currentYearId, currentSubjectId);
    const submitBtn = document.getElementById('submitQuiz');
    submitBtn.disabled = true;
    submitBtn.textContent = 'جارِ الحفظ...';
    await saveResult(subj.id, subj.name, lesson.id, lesson.title, score, questions.length);

    const banner = document.createElement('div');
    banner.className = 'score-banner ' + (score / questions.length >= 0.6 ? 'good' : 'bad');
    banner.textContent = `نتيجتك: ${score} من ${questions.length}`;
    submitBtn.replaceWith(banner);
  });
}

// ===================================================================
// Lesson editor modal (title / explanation / review / test)
// ===================================================================
function openLessonModal(lesson) {
  const isNew = !lesson;
  const data = lesson || {
    title: '', explanation: { text: '', audioUrl: '', videoUrl: '' },
    review: { text: '', questions: [] }, test: { durationMinutes: 10, questions: [] }
  };

  const bodyHtml = `
    <div class="field">
      <label>عنوان الدرس</label>
      <input type="text" id="fTitle" value="${escapeAttr(data.title)}" placeholder="مثال: الأعداد الصحيحة">
    </div>

    <hr class="section-divider">
    <div class="subsection-title">الشرح</div>
    <div class="field">
      <label>نص الشرح</label>
      <textarea id="fExplText" placeholder="اكتب شرح الدرس هنا...">${escapeHtml(data.explanation.text)}</textarea>
    </div>
    <div class="field">
      <label>رابط فيديو (اختياري)</label>
      <input type="url" id="fExplVideo" value="${escapeAttr(data.explanation.videoUrl)}" placeholder="https://...">
      <div class="field-hint">رابط فيديو مباشر أو رابط تضمين (embed).</div>
    </div>
    <div class="field">
      <label>رابط تسجيل صوتي (اختياري)</label>
      <input type="url" id="fExplAudio" value="${escapeAttr(data.explanation.audioUrl)}" placeholder="https://...">
    </div>

    <hr class="section-divider">
    <div class="subsection-title">المراجعة</div>
    <div class="field">
      <label>نص المراجعة</label>
      <textarea id="fReviewText" placeholder="ملخص أو نقاط مهمة للمراجعة...">${escapeHtml(data.review.text)}</textarea>
    </div>
    <div class="field">
      <label>أسئلة للمراجعة الذاتية</label>
      ${renderDynList('reviewQList', data.review.questions, 'سؤال للمراجعة')}
    </div>

    <hr class="section-divider">
    <div class="subsection-title">التقييم (اختبار اختيار من متعدد)</div>
    <div class="field">
      <label>مدة الاختبار (بالدقائق)</label>
      <input type="number" id="fDuration" value="${data.test.durationMinutes || 10}" min="1" style="max-width:120px">
    </div>
    <div id="testQContainer">${data.test.questions.map((q, qi) => testQuestionBlockHtml(q, qi)).join('')}</div>
    <button type="button" class="btn-secondary" id="addTestQBtn">+ إضافة سؤال اختبار</button>
  `;

  openModal({
    title: isNew ? 'إضافة درس جديد' : 'تعديل الدرس',
    bodyHtml,
    saveLabel: isNew ? 'إضافة الدرس' : 'حفظ التعديلات',
    onMount: (body) => {
      wireDynList('reviewQList', 'سؤال للمراجعة');
      wireTestQuestions(body);
      document.getElementById('addTestQBtn').addEventListener('click', () => {
        const container = document.getElementById('testQContainer');
        const div = document.createElement('div');
        div.innerHTML = testQuestionBlockHtml({ question: '', options: ['', ''], correctIndex: 0 }, Date.now());
        container.appendChild(div.firstElementChild);
        wireTestQuestions(body);
      });
    },
    onSave: async (body) => {
      const title = body.querySelector('#fTitle').value.trim();
      if (!title) { alert('من فضلك اكتب عنوان الدرس'); return false; }

      const explanation = {
        text: body.querySelector('#fExplText').value.trim(),
        videoUrl: body.querySelector('#fExplVideo').value.trim(),
        audioUrl: body.querySelector('#fExplAudio').value.trim()
      };
      const review = {
        text: body.querySelector('#fReviewText').value.trim(),
        questions: readDynList('reviewQList')
      };
      const durationMinutes = parseInt(body.querySelector('#fDuration').value) || 10;
      const questions = [];
      body.querySelectorAll('.test-q-block').forEach(block => {
        const qText = block.querySelector('.tq-text').value.trim();
        const optionInputs = Array.from(block.querySelectorAll('.tq-opt-text'));
        const options = optionInputs.map(i => i.value.trim());
        const checkedRadio = block.querySelector('input[type="radio"]:checked');
        const correctIndex = checkedRadio ? parseInt(checkedRadio.value) : 0;
        if (qText && options.filter(Boolean).length >= 2) {
          questions.push({ id: slug('q'), type: 'mcq', question: qText, options, correctIndex });
        }
      });

      const subj = getSubject(currentYearId, currentSubjectId);
      if (isNew) {
        subj.lessons.push({ id: slug('l'), title, explanation, review, test: { durationMinutes, questions } });
      } else {
        lesson.title = title;
        lesson.explanation = explanation;
        lesson.review = review;
        lesson.test = { durationMinutes, questions };
      }
      await saveData();
      renderTabContent();
    }
  });
}

function testQuestionBlockHtml(q, qkey) {
  return `
    <div class="test-q-block" data-qkey="${qkey}">
      <div class="field">
        <label>نص السؤال</label>
        <input type="text" class="tq-text" value="${escapeAttr(q.question)}" placeholder="اكتب نص السؤال">
      </div>
      <label>الاختيارات (حدد الدائرة بجانب الإجابة الصحيحة)</label>
      <div class="tq-options" data-options>
        ${q.options.map((opt, oi) => `
          <div class="tq-option-row">
            <input type="radio" name="correct-${qkey}" value="${oi}" ${oi === q.correctIndex ? 'checked' : ''}>
            <input type="text" class="tq-opt-text" value="${escapeAttr(opt)}" placeholder="اختيار">
            <button type="button" class="mini-btn-x" data-remove-option>✕</button>
          </div>
        `).join('')}
      </div>
      <div class="tq-block-actions">
        <button type="button" class="btn-secondary small-add" data-add-option>+ إضافة اختيار</button>
        <button type="button" class="btn-danger small-add" data-remove-question>حذف السؤال</button>
      </div>
    </div>
  `;
}

function wireTestQuestions(scopeEl) {
  scopeEl.querySelectorAll('.test-q-block').forEach(block => {
    const qkey = block.dataset.qkey;
    const optionsWrap = block.querySelector('[data-options]');

    const addOptBtn = block.querySelector('[data-add-option]');
    addOptBtn.onclick = () => {
      const idx = optionsWrap.children.length;
      const row = document.createElement('div');
      row.className = 'tq-option-row';
      row.innerHTML = `
        <input type="radio" name="correct-${qkey}" value="${idx}">
        <input type="text" class="tq-opt-text" placeholder="اختيار">
        <button type="button" class="mini-btn-x" data-remove-option>✕</button>
      `;
      optionsWrap.appendChild(row);
      wireOptionRemove(optionsWrap, qkey);
    };
    wireOptionRemove(optionsWrap, qkey);

    block.querySelector('[data-remove-question]').onclick = () => {
      block.remove();
    };
  });
}
function wireOptionRemove(optionsWrap, qkey) {
  optionsWrap.querySelectorAll('[data-remove-option]').forEach(btn => {
    btn.onclick = () => {
      if (optionsWrap.children.length <= 2) { alert('لازم يفضل اختيارين على الأقل'); return; }
      btn.closest('.tq-option-row').remove();
      optionsWrap.querySelectorAll('.tq-option-row').forEach((row, idx) => {
        row.querySelector('input[type="radio"]').value = idx;
      });
    };
  });
}

// ===================================================================
// Results page
// ===================================================================
async function renderResultsPage() {
  $page.innerHTML = `<div class="empty-state">جارِ تحميل النتائج...</div>`;
  const rows = await getResults();
  $page.innerHTML = `
    <h1 style="font-size:26px;font-weight:900;margin-bottom:20px">نتائجي</h1>
    ${rows.length === 0 ? '<div class="empty-state">لسه معملتش أي اختبار.</div>' : `
      <table class="results-table">
        <thead><tr><th>المادة</th><th>الدرس</th><th>النتيجة</th><th>التاريخ</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escapeHtml(r.subject_name)}</td>
              <td>${escapeHtml(r.lesson_title)}</td>
              <td class="score">${r.score} / ${r.total}</td>
              <td>${new Date(r.created_at).toLocaleDateString('ar-EG')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}
  `;
}

// ===================================================================
// Settings / backup page
// ===================================================================
function renderSettingsPage() {
  $page.innerHTML = `
    <h1 style="font-size:26px;font-weight:900;margin-bottom:20px">البيانات والنسخ الاحتياطي</h1>

    <div class="settings-block">
      <h3>حالة الاتصال بقاعدة البيانات</h3>
      <p>البيانات كلها متزامنة الآن عبر Supabase — أي تعديل بيظهر فورًا على كل الأجهزة اللي بتفتح نفس رابط الموقع.</p>
      ${currentUserEmail ? `<p>مسجّل الدخول بحساب: <strong>${escapeHtml(currentUserEmail)}</strong></p>
        <div class="settings-actions"><button class="btn-secondary" id="signOutBtn">تسجيل الخروج</button></div>` : ''}
    </div>

    <div class="settings-block">
      <h3>تنزيل نسخة احتياطية</h3>
      <p>هينزل عندك ملف واحد فيه كل السنوات والمواد والدروس، كنسخة احتياطية إضافية بجانب Supabase.</p>
      <div class="settings-actions">
        <button class="btn-primary" id="downloadBackupBtn">⬇ تنزيل نسخة احتياطية</button>
      </div>
    </div>

    <div class="settings-block">
      <h3>استعادة من نسخة احتياطية</h3>
      <p>اختر ملف نسخة احتياطية سبق تنزيله. هيتم استبدال كل البيانات الحالية على Supabase بمحتوى الملف (لازم تكون مسجّل دخول كأدمن).</p>
      <div class="settings-actions">
        <input type="file" id="restoreFileInput" accept="application/json">
      </div>
    </div>

    <div class="settings-block">
      <h3>مسح نتائج الاختبارات</h3>
      <p>بيمسح سجل النتائج بتاع "نتائجي" فقط، من غير ما يأثر على الدروس أو المواد.</p>
      <div class="settings-actions">
        <button class="btn-secondary" id="clearResultsBtn">مسح النتائج</button>
      </div>
    </div>

    ${currentUserEmail ? `
    <div class="settings-block">
      <h3>تغيير كلمة مرور الأدمن</h3>
      <p>هتتغير كلمة المرور بتاعة حسابك، وهتستخدمها في تسجيل الدخول من أي جهاز.</p>
      <div class="settings-actions">
        <button class="btn-secondary" id="changePwBtn">تغيير كلمة المرور</button>
      </div>
    </div>
    ` : ''}

    <div class="settings-block">
      <h3>استعادة البيانات الافتراضية</h3>
      <p>بيمسح كل التعديلات اللي عملتها ويرجّع البيانات الأصلية اللي جاية من ملفات المشروع (لازم تكون مسجّل دخول كأدمن). استخدمها بحذر.</p>
      <div class="settings-actions">
        <button class="btn-danger" id="resetDefaultsBtn">استعادة البيانات الافتراضية</button>
      </div>
    </div>
  `;

  document.getElementById('downloadBackupBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(APPDATA, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dafatri-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('restoreFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.years) throw new Error('invalid');
        if (confirm('هيتم استبدال كل البيانات الحالية على Supabase بمحتوى الملف. متأكد؟')) {
          APPDATA = parsed;
          saveData().then(() => {
            currentYearId = null; currentSubjectId = null;
            renderSidebar();
            renderWelcome();
            alert('تم استعادة البيانات بنجاح.');
          });
        }
      } catch (err) {
        alert('الملف ده مش نسخة احتياطية صالحة، أو إنك مش مسجّل دخول كأدمن.');
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('clearResultsBtn').addEventListener('click', async () => {
    if (confirm('متأكد من مسح كل نتائج الاختبارات؟')) { await clearResults(); alert('تم المسح.'); }
  });

  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      await signOutAdmin();
      renderSidebar();
      document.getElementById('adminModeToggle').checked = false;
      renderWelcome();
    });
  }

  const changePwBtn = document.getElementById('changePwBtn');
  if (changePwBtn) {
    changePwBtn.addEventListener('click', () => {
      openModal({
        title: 'تغيير كلمة مرور الأدمن',
        bodyHtml: `
          <div class="field"><label>كلمة المرور الجديدة</label><input type="password" id="fPwNew1" placeholder="6 أحرف على الأقل"></div>
          <div class="field"><label>تأكيد كلمة المرور الجديدة</label><input type="password" id="fPwNew2"></div>
        `,
        saveLabel: 'حفظ',
        onSave: async (body) => {
          const n1 = body.querySelector('#fPwNew1').value;
          const n2 = body.querySelector('#fPwNew2').value;
          if (n1.length < 6) { alert('كلمة المرور قصيرة جدًا (6 أحرف على الأقل)'); return false; }
          if (n1 !== n2) { alert('كلمتا المرور غير متطابقتين'); return false; }
          const { error } = await sb.auth.updateUser({ password: n1 });
          if (error) { alert('تعذّر تغيير كلمة المرور: ' + error.message); return false; }
          alert('تم تغيير كلمة المرور بنجاح.');
        }
      });
    });
  }

  document.getElementById('resetDefaultsBtn').addEventListener('click', async () => {
    if (confirm('هيتم مسح كل تعديلاتك واستعادة البيانات الأصلية على Supabase. متأكد؟')) {
      await seedFromDefaults();
      currentYearId = null; currentSubjectId = null;
      renderSidebar();
      renderWelcome();
      alert('تم استعادة البيانات الافتراضية.');
    }
  });
}

// ===================================================================
// Init
// ===================================================================
async function init() {
  if (!SUPABASE_CONFIGURED) {
    $page.innerHTML = `
      <div class="empty-state">
        <strong>لسه محتاج تربط المنصة بـ Supabase.</strong><br><br>
        افتح ملف <code>js/config.js</code> وحط رابط مشروعك ومفتاح الـ anon key بتاعك (اتبع الخطوات في README.md).
      </div>`;
    return;
  }

  const session = await getSession();
  if (session) {
    adminMode = true;
    currentUserEmail = session.user.email;
    document.getElementById('adminModeToggle').checked = true;
  }

  try {
    await loadAllData();
  } catch (err) {
    $page.innerHTML = `<div class="empty-state">تعذّر تحميل البيانات من Supabase. اتأكد إن الجداول والصلاحيات (RLS) متظبطة زي README.md. تفاصيل الخطأ: ${escapeHtml(err.message || '')}</div>`;
    console.error(err);
    return;
  }

  renderSidebar();
  renderWelcome();
}

init();
