import { session, loadStatus, loadContext } from '../session.js'
import { rpc, uploadImage } from '../api.js'
import {
  auth, createUserWithEmailAndPassword, deleteUser, signInWithEmailAndPassword, sendPasswordResetEmail,
  setRemember, signOut, firebaseMessage,
} from '../firebase.js'
import {
  esc, icon, field, passwordInput, showErrors, setBusy, EMAIL_RE, passwordProblems, options, BUSINESS_TYPES,
  TIMEZONES, imagePicker, bindImagePicker,
} from '../util.js'

function layout(app, inner, { wide = false, store = null, subtitle = '' } = {}) {
  const logo = store?.logo_url ? `<img src="${esc(store.logo_url)}" alt="">` : icon('bag')
  app.innerHTML = `<div class="auth"><div class="auth-inner ${wide ? 'wide' : ''}">
    <div class="auth-card">
      <div class="auth-hero"><div class="mark">${logo}</div><h1>${esc(store?.store_name || 'POS System')}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
      <div id="auth-body">${inner}</div>
      <p class="powered">${icon('flame')} Powered by Firebase &amp; Supabase</p>
    </div></div></div>`
  return app.querySelector('#auth-body')
}
const iconInput = (ic, id, type, ph, ac) => `<div class="with-icon">${icon(ic)}<input id="${id}" type="${type}" class="input" placeholder="${esc(ph)}" autocomplete="${ac}" aria-label="${esc(ph)}"></div>`
const iconPassword = (id, ph, ac) => `<div class="with-icon pw-wrap">${icon('lock')}<input id="${id}" type="password" class="input" placeholder="${esc(ph)}" autocomplete="${ac}" aria-label="${esc(ph)}">
  <button type="button" class="pw-toggle" data-toggle-pw="${id}" aria-label="Show password">${icon('eye')}</button></div>`
const steps = (n) => `<ol class="steps">${['Administrator', 'Store', 'Done'].map((l, i) =>
  `<li class="${i + 1 < n ? 'done' : i + 1 === n ? 'current' : ''}"><span class="n">${i + 1 < n ? '✓' : i + 1}</span>${l}${i < 2 ? '<span class="line"></span>' : ''}</li>`).join('')}</ol>`
const errorBox = (msg) => (msg ? `<p class="alert alert-error" role="alert">${esc(msg)}</p>` : '')

// ---------------------------------------------------------------- STEP 1
export function renderAdminStep(app, navigate) {
  const card = layout(app, `${steps(1)}
    <h2 style="font-size:18px">Welcome! Let's set up your POS.</h2><p class="sub">Create your administrator account to get started.</p>
    <form id="f" class="stack" novalidate>
      ${iconInput('mail', 'email', 'email', 'Email Address', 'email')}
      ${iconPassword('password', 'Password', 'new-password')}
      <p class="hint" style="margin-top:4px">At least 8 characters with uppercase, lowercase and a number.</p>
      ${iconPassword('confirm', 'Confirm Password', 'new-password')}
      <div id="err"></div>
      <button class="btn btn-primary btn-block btn-lg" type="submit">Create Administrator Account</button>
    </form>`)
  card.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault()
    const email = card.querySelector('#email').value.trim().toLowerCase()
    const pw = card.querySelector('#password').value
    const confirm = card.querySelector('#confirm').value
    const errs = {}
    if (!EMAIL_RE.test(email)) errs.email = 'Enter a valid email address.'
    const probs = passwordProblems(pw)
    if (probs.length) errs.password = `Password needs ${probs.join(', ')}.`
    if (!confirm) errs.confirm = 'Confirm your password.'
    else if (confirm !== pw) errs.confirm = 'Passwords do not match.'
    card.querySelector('#err').innerHTML = ''
    if (!showErrors(card, errs)) return
    const btn = card.querySelector('[type=submit]')
    setBusy(btn, true, 'Creating account…')
    session.busyAuth = true
    try {
      // Fast check (not a security control: the database claim is atomic).
      const status = await loadStatus()
      if (status.adminClaimed) { session.busyAuth = false; return navigate('login') }
      await setRemember(true)
      const { user } = await createUserWithEmailAndPassword(auth, email, pw)
      try {
        await rpc('claim_initial_admin_self', {})
      } catch (err) {
        await deleteUser(user).catch(() => signOut(auth)) // lost the race or failed: remove the account
        throw err
      }
      await loadStatus()
      await loadContext()
      await rpc('record_auth_event', { p_action: 'login' }).catch(() => {})
      session.busyAuth = false
      navigate('setup')
    } catch (err) {
      session.busyAuth = false
      setBusy(btn, false)
      if (err.code === 'SETUP_ALREADY_CLAIMED') { await loadStatus(); return navigate('login') }
      card.querySelector('#err').innerHTML = errorBox(err.code?.startsWith?.('auth/') ? firebaseMessage(err) : err.message)
    }
  }
}

// ---------------------------------------------------------------- STEP 2
export function renderStoreStep(app, navigate, logout) {
  const card = layout(app, `${steps(2)}
    <h2 style="font-size:18px">Set Up Your Store</h2><p class="sub">Tell us a little about your business.</p>
    <form id="f" class="stack" novalidate>
      ${field('Store Name', '<input id="store_name" class="input" maxlength="120">', { id: 'store_name', required: true })}
      ${field('Store Address', '<input id="store_address" class="input" maxlength="300">', { id: 'store_address' })}
      <div class="grid-2">
        ${field('Contact Number', '<input id="contact_number" type="tel" class="input" maxlength="40">', { id: 'contact_number' })}
        ${field('Business Email', '<input id="business_email" type="email" class="input">', { id: 'business_email' })}
      </div>
      ${field('Business Type', `<select id="business_type" class="input"><option value="">Select…</option>${options(BUSINESS_TYPES)}</select>`, { id: 'business_type' })}
      ${imagePicker('logo', 'Store Logo', 'PNG, JPEG or WebP, up to 2 MB.')}
      <fieldset><legend>Additional settings</legend><div class="grid-3">
        ${field('Currency', '<select class="input" disabled><option>Philippine Peso (₱)</option></select>')}
        ${field('Time Zone', `<select id="timezone" class="input">${options(TIMEZONES.map((t) => [t, t]), 'Asia/Manila')}</select>`, { id: 'timezone' })}
        ${field('Date Format', `<select id="date_format" class="input">${options([['DD/MM/YYYY', 'DD/MM/YYYY'], ['MM/DD/YYYY', 'MM/DD/YYYY'], ['YYYY-MM-DD', 'YYYY-MM-DD']], 'DD/MM/YYYY')}</select>`, { id: 'date_format' })}
      </div>
      ${field('Receipt Footer Message', '<textarea id="receipt_footer" class="input" maxlength="300">Thank you for your purchase!</textarea>', { id: 'receipt_footer', cls: 'mt' })}
      </fieldset>
      <div id="err"></div>
      <div class="row-wrap between">
        <p class="small muted">Signed in as ${esc(session.ctx?.user?.email)} · <button type="button" class="link-btn" id="out">Sign out</button></p>
        <button class="btn btn-primary" type="submit">Complete Store Setup</button>
      </div>
    </form>`, { wide: true })
  const logo = bindImagePicker(card, 'logo')
  card.querySelector('#out').onclick = logout
  card.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault()
    const v = (id) => card.querySelector(`#${id}`).value.trim()
    const errs = {}
    if (!v('store_name')) errs.store_name = 'Store name is required.'
    if (v('business_email') && !EMAIL_RE.test(v('business_email'))) errs.business_email = 'Enter a valid email address.'
    card.querySelector('#err').innerHTML = ''
    if (!showErrors(card, errs)) return
    const btn = card.querySelector('[type=submit]')
    setBusy(btn, true, 'Saving…')
    try {
      const logoUrl = logo.file ? await uploadImage('store-assets', `setup/${session.ctx.user.id}`, logo.file) : null
      const storeId = await rpc('complete_store_setup', { p_store: {
        store_name: v('store_name'), store_address: v('store_address'), contact_number: v('contact_number'),
        business_email: v('business_email'), business_type: v('business_type'), logo_url: logoUrl, currency: 'PHP',
        timezone: v('timezone'), date_format: v('date_format'), receipt_footer: v('receipt_footer') } })
      try { localStorage.setItem('pos.storeId', storeId) } catch { /* ignore */ }
      await loadContext()
      await loadStatus()
      navigate('welcome')
    } catch (err) {
      setBusy(btn, false)
      card.querySelector('#err').innerHTML = errorBox(err.message)
    }
  }
}

// ---------------------------------------------------------------- STEP 3
export function renderWelcome(app, navigate) {
  const s = session.ctx.store
  const card = layout(app, `${steps(3)}
    <div style="text-align:center">
      <div class="text-green" style="margin-bottom:8px">${icon('checkCircle', 'icon-lg')}</div>
      <h2 style="font-size:18px">Your store is ready!</h2>
      <p class="bold mt-sm">${esc(s.store_name)}</p>
      <p class="muted mt-sm">You can now manage your products, inventory, sales, and business operations.</p>
      <div class="alert alert-info mt small" style="text-align:left">
        <div class="row between"><span>Administrator</span><b>${esc(session.ctx.user.email)}</b></div>
        <div class="row between"><span>Currency</span><span>Philippine Peso (₱)</span></div>
        <div class="row between"><span>Time zone</span><span>${esc(s.timezone)}</span></div>
        <div class="row between"><span>Date format</span><span>${esc(s.date_format)}</span></div>
      </div>
      <button class="btn btn-primary btn-block mt" id="go">Go to Dashboard</button>
    </div>`, { store: s })
  card.querySelector('#go').onclick = () => navigate('dashboard')
}

// ----------------------------------------------------------------- LOGIN
export function renderLogin(app) {
  const card = layout(app, `<p class="sub" style="text-align:center;margin-top:-12px">Welcome back! Sign in to continue.</p>
    <form id="f" class="stack" novalidate>
      ${iconInput('mail', 'email', 'email', 'Email Address', 'username')}
      ${iconPassword('password', 'Password', 'current-password')}
      <div class="row between"><label class="check"><input type="checkbox" id="remember" checked> Remember me</label>
        <a href="#/forgot-password">Forgot password?</a></div>
      <div id="err">${errorBox(session.authMessage)}</div>
      <button class="btn btn-primary btn-block btn-lg" type="submit">Login</button>
      ${session.status?.setupCompleted ? '<p style="text-align:center" class="small">New business? <a href="#/register">Create a store account</a></p>' : ''}
    </form>`, { store: session.status?.store })
  card.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault()
    const email = card.querySelector('#email').value.trim()
    const pw = card.querySelector('#password').value
    const errs = {}
    if (!EMAIL_RE.test(email)) errs.email = 'Enter a valid email address.'
    if (!pw) errs.password = 'Enter your password.'
    card.querySelector('#err').innerHTML = ''
    session.authMessage = null
    if (!showErrors(card, errs)) return
    const btn = card.querySelector('[type=submit]')
    setBusy(btn, true, 'Signing in…')
    try {
      await setRemember(card.querySelector('#remember').checked)
      session.freshLogin = true
      await signInWithEmailAndPassword(auth, email, pw)
      // onAuthStateChanged (main.js) verifies the account with Supabase and routes.
    } catch (err) {
      setBusy(btn, false)
      card.querySelector('#err').innerHTML = errorBox(firebaseMessage(err))
    }
  }
}

export function renderForgot(app) {
  const card = layout(app, `<h2 style="font-size:18px">Reset your password</h2>
    <form id="f" class="stack mt" novalidate>
      <p class="muted">Enter your email address and we'll send you a link to reset your password.</p>
      ${field('Email Address', '<input id="email" type="email" class="input" autocomplete="email">', { id: 'email' })}
      <div id="err"></div>
      <button class="btn btn-primary btn-block" type="submit">Send reset link</button>
      <p style="text-align:center"><a href="#/login">Back to sign in</a></p>
    </form>`, { store: session.status?.store })
  card.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault()
    const email = card.querySelector('#email').value.trim()
    if (!showErrors(card, EMAIL_RE.test(email) ? {} : { email: 'Enter a valid email address.' })) return
    const btn = card.querySelector('[type=submit]')
    setBusy(btn, true)
    const done = () => {
      card.innerHTML = `<h2 style="font-size:18px">Check your email</h2><p class="muted mt-sm">If an account exists for <b>${esc(email)}</b>, a password reset link has been sent. Check your inbox and spam folder.</p><p class="mt"><a href="#/login">Back to sign in</a></p>`
    }
    try { await sendPasswordResetEmail(auth, email); done() } catch (err) {
      if (err?.code === 'auth/user-not-found') return done() // don't reveal whether an account exists
      setBusy(btn, false)
      card.querySelector('#err').innerHTML = errorBox(firebaseMessage(err))
    }
  }
}

// ------------------------------------------------------------ REGISTER
// Self-service sign-up after the first-run setup: a new account with its own
// store (the database keeps every store's data separate). If the person is
// already signed in to Firebase but has no store yet (an earlier sign-up was
// interrupted), only the store part is shown.
export function renderRegister(app, navigate, logout) {
  const finishing = Boolean(session.needsStore && auth.currentUser)
  const card = layout(app, `
    <h2 style="font-size:18px">${finishing ? 'Finish creating your store' : 'Create your store account'}</h2>
    <p class="sub">${finishing ? 'Your login is ready. Tell us about your store to continue.'
      : 'Start your own POS in a minute. Your products, sales and staff are private to your store.'}</p>
    <form id="f" class="stack" novalidate>
      <p class="section-label" style="margin-bottom:0">Your account</p>
      ${field('Your Name', '<input id="full_name" class="input" maxlength="120" autocomplete="name">', { id: 'full_name', required: true })}
      ${finishing ? `<p class="small muted">Signed in as <b>${esc(auth.currentUser.email)}</b> · <button type="button" class="link-btn" id="out">Use another account</button></p>` : `
      ${field('Email Address', '<input id="email" type="email" class="input" autocomplete="email">', { id: 'email', required: true })}
      <div class="grid-2">
        ${field('Password', passwordInput('password', 'new-password'), { id: 'password', required: true, hint: 'At least 8 characters with uppercase, lowercase and a number.' })}
        ${field('Confirm Password', passwordInput('confirm', 'new-password'), { id: 'confirm', required: true })}
      </div>`}
      <p class="section-label" style="margin:8px 0 0">Your store</p>
      ${field('Store Name', '<input id="store_name" class="input" maxlength="120">', { id: 'store_name', required: true })}
      <div class="grid-2">
        ${field('Business Type', `<select id="business_type" class="input"><option value="">Select…</option>${options(BUSINESS_TYPES)}</select>`, { id: 'business_type' })}
        ${field('Contact Number', '<input id="contact_number" type="tel" class="input" maxlength="40" autocomplete="tel">', { id: 'contact_number' })}
      </div>
      ${field('Store Address', '<input id="store_address" class="input" maxlength="300">', { id: 'store_address' })}
      ${field('Time Zone', `<select id="timezone" class="input">${options(TIMEZONES.map((t) => [t, t]), 'Asia/Manila')}</select>`, { id: 'timezone' })}
      <p class="hint">You can add your logo, tax and receipt settings later in Settings.</p>
      <div id="err"></div>
      <button class="btn btn-primary btn-block btn-lg" type="submit">${finishing ? 'Create My Store' : 'Create Account & Store'}</button>
      ${finishing ? '' : '<p style="text-align:center" class="small">Already have an account? <a href="#/login">Sign in</a></p>'}
    </form>`, { wide: true, subtitle: 'New store registration' })
  card.querySelector('#out')?.addEventListener('click', logout)
  card.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault()
    const v = (id) => card.querySelector(`#${id}`)?.value.trim() ?? ''
    const errs = {}
    if (!v('full_name')) errs.full_name = 'Your name is required.'
    if (!finishing) {
      if (!EMAIL_RE.test(v('email'))) errs.email = 'Enter a valid email address.'
      const pw = card.querySelector('#password').value
      const probs = passwordProblems(pw)
      if (probs.length) errs.password = `Password needs ${probs.join(', ')}.`
      const confirm = card.querySelector('#confirm').value
      if (!confirm) errs.confirm = 'Confirm your password.'
      else if (confirm !== pw) errs.confirm = 'Passwords do not match.'
    }
    if (!v('store_name')) errs.store_name = 'Store name is required.'
    card.querySelector('#err').innerHTML = ''
    if (!showErrors(card, errs)) return
    const btn = card.querySelector('[type=submit]')
    setBusy(btn, true, 'Creating your store…')
    session.busyAuth = true
    let created = null
    try {
      if (!finishing) {
        await setRemember(true)
        created = (await createUserWithEmailAndPassword(auth, v('email').toLowerCase(), card.querySelector('#password').value)).user
      }
      let storeId
      try {
        storeId = await rpc('register_store', { p_full_name: v('full_name'), p_store: {
          store_name: v('store_name'), business_type: v('business_type'), contact_number: v('contact_number'),
          store_address: v('store_address'), timezone: v('timezone') } })
      } catch (err) {
        if (created) await deleteUser(created).catch(() => signOut(auth)) // don't leave a login without a store
        throw err
      }
      try { localStorage.setItem('pos.storeId', storeId) } catch { /* ignore */ }
      session.needsStore = false
      await loadContext()
      await loadStatus()
      rpc('record_auth_event', { p_action: 'login', p_store_id: storeId }).catch(() => {})
      session.busyAuth = false
      navigate('welcome')
    } catch (err) {
      session.busyAuth = false
      setBusy(btn, false)
      const msg = err.code === 'auth/email-already-in-use'
        ? 'An account with this email already exists. Sign in instead — if you never finished creating your store, signing in lets you continue.'
        : err.code?.startsWith?.('auth/') ? firebaseMessage(err) : err.message
      card.querySelector('#err').innerHTML = errorBox(msg)
    }
  }
}

export function renderFatal(app, title, message, retry) {
  app.innerHTML = `<div class="auth"><div class="auth-inner"><div class="auth-card" style="text-align:center">
    <h1>${esc(title)}</h1><p class="muted mt-sm">${esc(message)}</p>${retry ? '<button class="btn btn-secondary mt" id="retry">Try again</button>' : ''}</div></div></div>`
  if (retry) app.querySelector('#retry').onclick = retry
}
