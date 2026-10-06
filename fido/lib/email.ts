/**
 * Envoi d'e-mails transactionnels via le proxy Emergent (Resend managé).
 *
 * Garde-fous (portés depuis le playbook Emergent RESEND) — NE JAMAIS retirer :
 *   G1: `from_name` ne peut être qu'une marque interne (Fido / le cabinet).
 *   G2: pas de <form>/<input> ; jamais demander mot de passe/code/CVV/etc.
 *   G3: tout href/src doit être en HTTPS absolu, pas d'IP, pas de raccourcisseur.
 *   G4: pas d'open relay — l'appelant fournit un ID, jamais l'HTML ni le destinataire.
 *   G5: pas d'envoi de masse / marketing.
 *
 * Ce module s'utilise UNIQUEMENT côté serveur (server actions, routes API).
 */

const EMAIL_BASE_URL = 'https://integrations.emergentagent.com'
const SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'is.gd',
  'cutt.ly',
  'goo.gl',
  'rebrand.ly',
])

// Formulations qui « demandent des identifiants au destinataire » — tripwire, non exhaustive.
const CRED_ASK_PATTERNS = [
  'reply with your password',
  'reply with the code',
  'send your password',
  'cvv',
  'send us your password',
  'enter your password below',
  'confirm your card number',
  'your full card number',
  'seed phrase',
  'recovery phrase',
  'verify your card',
  'social security number',
  'confirm your bank details',
  'répondez avec votre mot de passe',
  'confirmez votre carte',
  'votre numéro de carte',
  'code de sécurité',
]

function isIpLiteral(host: string): boolean {
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true
  // IPv6 (brute, entouré ou non de [])
  if (/^\[?[0-9a-fA-F:]+\]?$/.test(host) && host.includes(':')) return true
  return false
}

function hostOk(host: string): boolean {
  if (!host || host.includes('xn--')) return false
  if (isIpLiteral(host)) return false
  for (const s of SHORTENERS) {
    if (host === s || host.endsWith('.' + s)) return false
  }
  return true
}

function sameSite(shown: string, real: string): boolean {
  return shown === real || real.endsWith('.' + shown) || shown.endsWith('.' + real)
}

function extractHrefSrc(html: string): Array<{ tag: string; attr: string; value: string }> {
  const out: Array<{ tag: string; attr: string; value: string }> = []
  const re = /<\s*(a|img|link|script|iframe|source)\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase()
    const attrs = m[0]
    for (const attrName of ['href', 'src']) {
      const attrRe = new RegExp(`${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
      const am = attrRe.exec(attrs)
      if (am) {
        const val = am[1] ?? am[2] ?? am[3] ?? ''
        out.push({ tag, attr: attrName, value: val })
      }
    }
  }
  return out
}

function extractAnchors(html: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = []
  const re = /<\s*a\b([^>]*)>([\s\S]*?)<\s*\/\s*a\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const attrs = m[1]
    const text = m[2].replace(/<[^>]+>/g, '').replace(/&#46;/g, '.')
    const hrefRe = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
    const hm = hrefRe.exec(attrs)
    if (hm) {
      const href = hm[1] ?? hm[2] ?? hm[3] ?? ''
      out.push({ href, text })
    }
  }
  return out
}

function assertSafeEmail(subject: string, html: string): void {
  // G2: pas de formulaire ni champ d'entrée
  if (/<\s*(form|input|textarea|select)\b/i.test(html)) {
    throw new Error('Email guardrail G2: no forms or input fields allowed')
  }
  const body = (subject + '\n' + html).toLowerCase()
  for (const p of CRED_ASK_PATTERNS) {
    if (body.includes(p)) {
      throw new Error(`Email guardrail G2: credential-ask phrasing detected (${p})`)
    }
  }

  // G3: hygiène des URLs
  for (const { value } of extractHrefSrc(html)) {
    const low = value.trim().toLowerCase()
    if (
      low.startsWith('mailto:') ||
      low.startsWith('tel:') ||
      low.startsWith('cid:') ||
      low.startsWith('#')
    ) {
      continue
    }
    if (!low.startsWith('https://')) {
      throw new Error(`Email guardrail G3: non-https link/asset: ${value}`)
    }
    let parsed: URL
    try {
      parsed = new URL(low)
    } catch {
      throw new Error(`Email guardrail G3: invalid URL: ${value}`)
    }
    if (parsed.username) {
      throw new Error(`Email guardrail G3: credential-in-URL: ${value}`)
    }
    if (!hostOk(parsed.hostname)) {
      throw new Error(`Email guardrail G3: forbidden host: ${value}`)
    }
  }

  // G3 bis: texte d'ancre ≠ vraie destination
  const hostRe = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})/gi
  for (const { href, text } of extractAnchors(html)) {
    let real: string
    try {
      real = new URL(href.trim().toLowerCase()).hostname
    } catch {
      continue
    }
    if (!real) continue
    let m: RegExpExecArray | null
    while ((m = hostRe.exec(text))) {
      const shown = m[1].toLowerCase()
      if (!sameSite(shown, real)) {
        throw new Error(`Email guardrail G3: anchor text ${shown} ≠ real host ${real}`)
      }
    }
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type SendEmailInput = {
  to: string
  subject: string
  html: string
  replyTo?: string
}

/**
 * Envoie un e-mail transactionnel. Essaie dans l'ordre :
 *   1. Resend direct (RESEND_API_KEY) — recommandé pour production
 *   2. Proxy Emergent (EMERGENT_EMAIL_KEY) — pour les apps hébergées sur Emergent
 *
 * Retourne l'ID Resend, ou lève une erreur si aucun canal n'est configuré.
 *
 * `html` DOIT provenir d'un template server-side ; jamais d'HTML user-fourni (G4).
 */
export async function sendEmail(input: SendEmailInput): Promise<string | null> {
  const fromName = process.env.EMAIL_FROM_NAME || 'Fido'
  assertSafeEmail(input.subject, input.html)

  // 1. Resend direct (production path)
  const resendKey = process.env.RESEND_API_KEY
  if (resendKey) {
    const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'onboarding@resend.dev'
    const payload: Record<string, unknown> = {
      from: `${fromName} <${fromAddress}>`,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }
    const replyTo = input.replyTo || process.env.EMAIL_REPLY_TO
    if (replyTo) payload.reply_to = replyTo

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Resend send failed (${res.status}): ${detail.slice(0, 200)}`)
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string }
    return data.id || null
  }

  // 2. Proxy Emergent (legacy / in-platform)
  const apiKey = process.env.EMERGENT_EMAIL_KEY
  if (apiKey) {
    const payload: Record<string, unknown> = {
      to: [input.to],
      subject: input.subject,
      html: input.html,
      from_name: fromName,
    }
    const replyTo = input.replyTo || process.env.EMAIL_REPLY_TO
    if (replyTo) payload.contact_email = replyTo

  const res = await fetch(`${EMAIL_BASE_URL}/api/v1/email/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Email-Key': apiKey,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Emergent email send failed (${res.status}): ${detail.slice(0, 200)}`)
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string }
    return data.id || null
  }

  throw new Error('No email provider configured (set RESEND_API_KEY or EMERGENT_EMAIL_KEY)')
}

/** Envoie best-effort — ne jette jamais, log et retourne un diag. */
export async function sendEmailSafe(
  input: SendEmailInput
): Promise<{ sent: boolean; id?: string | null; error?: string }> {
  try {
    const id = await sendEmail(input)
    return { sent: true, id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error('[email] sendEmailSafe error:', msg)
    return { sent: false, error: msg }
  }
}

/* -------------------------------------------------------------------------- */
/*                              Templates internes                             */
/* -------------------------------------------------------------------------- */

function baseLayout(bodyHtml: string, appName: string, footerNote: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111">
  <tr><td>
    <table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:28px;max-width:560px;margin:0 auto">
      <tr><td style="padding-bottom:16px;font-weight:700;font-size:20px;color:#0f172a">${escapeHtml(appName)}<span style="color:#2563eb">.</span></td></tr>
      <tr><td style="font-size:15px;line-height:1.55;color:#1e293b">${bodyHtml}</td></tr>
      <tr><td style="padding-top:24px;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;margin-top:16px">${escapeHtml(footerNote)}</td></tr>
    </table>
  </td></tr>
</table>`
}

export function inviteEmailTemplate(params: {
  cabinetName: string
  clientCompany: string
  inviteUrl: string // MUST be https on your own domain
  appName: string
}): { subject: string; html: string } {
  const subject = `Invitation à rejoindre l’espace ${params.cabinetName} sur ${params.appName}`
  const body = `
    <p>Bonjour,</p>
    <p>Le cabinet <strong>${escapeHtml(params.cabinetName)}</strong> vous invite à rejoindre l’espace de collaboration Fido pour <strong>${escapeHtml(params.clientCompany)}</strong>.</p>
    <p>Cliquez sur le bouton ci-dessous pour créer votre accès sécurisé (lien valable 7 jours) :</p>
    <p style="text-align:center;margin:24px 0">
      <a href="${params.inviteUrl}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Créer mon accès</a>
    </p>
    <p style="font-size:13px;color:#64748b">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br /><a href="${params.inviteUrl}">${params.inviteUrl}</a></p>
  `
  return {
    subject,
    html: baseLayout(
      body,
      params.appName,
      `Cet e-mail a été envoyé par ${params.appName}. Nous ne vous demanderons jamais votre mot de passe par e-mail.`
    ),
  }
}

export function documentReceivedTemplate(params: {
  clientCompany: string
  documentName: string
  appUrl: string
  appName: string
}): { subject: string; html: string } {
  const subject = `Nouveau document reçu — ${params.clientCompany}`
  const body = `
    <p>Bonjour,</p>
    <p>Votre client <strong>${escapeHtml(params.clientCompany)}</strong> vient de téléverser un document : <strong>${escapeHtml(params.documentName)}</strong>.</p>
    <p><a href="${params.appUrl}">Consulter dans Fido</a></p>
  `
  return {
    subject,
    html: baseLayout(
      body,
      params.appName,
      `Notification envoyée par ${params.appName}.`
    ),
  }
}

export function newMessageTemplate(params: {
  clientCompany: string
  messagePreview: string
  appUrl: string
  appName: string
}): { subject: string; html: string } {
  const subject = `Nouveau message — ${params.clientCompany}`
  const body = `
    <p>Bonjour,</p>
    <p><strong>${escapeHtml(params.clientCompany)}</strong> vient de vous envoyer un message dans Fido :</p>
    <blockquote style="border-left:3px solid #2563eb;padding:6px 12px;color:#334155;margin:12px 0">${escapeHtml(params.messagePreview)}</blockquote>
    <p><a href="${params.appUrl}">Répondre dans Fido</a></p>
  `
  return {
    subject,
    html: baseLayout(
      body,
      params.appName,
      `Notification envoyée par ${params.appName}.`
    ),
  }
}

const OBLIGATION_LABEL_FR: Record<string, string> = {
  tva_mensuel: 'Déclaration TVA mensuelle',
  tva_trimestriel: 'Déclaration TVA trimestrielle',
  is_acompte: 'Acompte IS',
  is_solde: 'Solde IS annuel',
  ir_professionnel: 'Déclaration IR professionnelle',
  cnss_mensuel: 'Déclaration CNSS mensuelle',
  taxe_professionnelle: 'Taxe professionnelle',
}

export function deadlineReminderTemplate(params: {
  recipientName: string
  clientCompany: string
  cabinetName: string
  obligation: string
  periodLabel: string
  dueDate: string // YYYY-MM-DD
  appUrl: string
  appName: string
  audience: 'client' | 'staff'
}): { subject: string; html: string } {
  const label = OBLIGATION_LABEL_FR[params.obligation] || params.obligation
  const formattedDate = new Date(params.dueDate + 'T00:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const subject =
    params.audience === 'client'
      ? `Rappel — ${label} à préparer avant le ${formattedDate}`
      : `Rappel J-7 : ${params.clientCompany} — ${label}`

  const bodyClient = `
    <p>Bonjour ${escapeHtml(params.recipientName)},</p>
    <p>Votre cabinet <strong>${escapeHtml(params.cabinetName)}</strong> vous rappelle que la <strong>${escapeHtml(label)}</strong> (${escapeHtml(params.periodLabel)}) est à préparer avant le <strong>${escapeHtml(formattedDate)}</strong>.</p>
    <p>Pensez à téléverser les documents nécessaires dans votre espace :</p>
    <p style="text-align:center;margin:20px 0">
      <a href="${params.appUrl}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Ouvrir mon espace ${escapeHtml(params.appName)}</a>
    </p>
    <p style="font-size:13px;color:#64748b">Ce rappel est envoyé automatiquement 7 jours avant la date limite.</p>
  `
  const bodyStaff = `
    <p>Bonjour,</p>
    <p>Rappel automatique J-7 : le client <strong>${escapeHtml(params.clientCompany)}</strong> a l'échéance <strong>${escapeHtml(label)}</strong> (${escapeHtml(params.periodLabel)}) fixée au <strong>${escapeHtml(formattedDate)}</strong>.</p>
    <p><a href="${params.appUrl}">Consulter l'échéance dans Fido</a></p>
  `
  return {
    subject,
    html: baseLayout(
      params.audience === 'client' ? bodyClient : bodyStaff,
      params.appName,
      `Ce rappel a été généré automatiquement par ${params.appName} pour ${escapeHtml(params.cabinetName)}.`
    ),
  }
}


export function staffInviteTemplate(params: {
  inviteeName: string
  cabinetName: string
  inviteUrl: string
  appName: string
}): { subject: string; html: string } {
  const subject = `Rejoindre ${params.cabinetName} sur ${params.appName}`
  const body = `
    <p>Bonjour ${escapeHtml(params.inviteeName)},</p>
    <p>Le cabinet <strong>${escapeHtml(params.cabinetName)}</strong> vous invite à rejoindre son espace de collaboration ${escapeHtml(params.appName)} en tant que <strong>collaborateur</strong>.</p>
    <p>Vous aurez accès aux dossiers clients, demandes documentaires, documents et messagerie du cabinet.</p>
    <p style="text-align:center;margin:24px 0">
      <a href="${params.inviteUrl}" style="display:inline-block;padding:12px 20px;background:#6c5ce7;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600">Activer mon compte</a>
    </p>
    <p style="font-size:13px;color:#64748b">Lien valable 7 jours. Si le bouton ne fonctionne pas, copiez ce lien :<br /><a href="${params.inviteUrl}">${params.inviteUrl}</a></p>
  `
  return {
    subject,
    html: baseLayout(
      body,
      params.appName,
      `Invitation envoyée par ${params.appName} pour le compte de ${escapeHtml(params.cabinetName)}. Nous ne vous demanderons jamais de mot de passe par e-mail.`
    ),
  }
}


export function documentRequestTemplate(params: {
  cabinetName: string
  clientCompany: string
  requestTitle: string
  description?: string | null
  dueDate?: string | null
  appUrl: string
  appName: string
}): { subject: string; html: string } {
  const dueStr = params.dueDate
    ? new Date(params.dueDate + 'T00:00:00Z').toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : null
  const subject = `Nouveau document demandé : ${params.requestTitle}`
  const descrBlock = params.description
    ? `<p style="color:#334155;background:#f1f5f9;padding:10px 12px;border-radius:8px;margin:12px 0">${escapeHtml(params.description)}</p>`
    : ''
  const body = `
    <p>Bonjour,</p>
    <p>Votre cabinet <strong>${escapeHtml(params.cabinetName)}</strong> vous demande un nouveau document pour <strong>${escapeHtml(params.clientCompany)}</strong>&nbsp;:</p>
    <p style="font-size:17px;font-weight:700;color:#0f172a;margin:14px 0">${escapeHtml(params.requestTitle)}</p>
    ${descrBlock}
    ${dueStr ? `<p>Échéance&nbsp;: <strong>${escapeHtml(dueStr)}</strong></p>` : ''}
    <p style="text-align:center;margin:24px 0">
      <a href="${params.appUrl}" style="display:inline-block;padding:12px 20px;background:#6c5ce7;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600">Téléverser le document</a>
    </p>
  `
  return {
    subject,
    html: baseLayout(
      body,
      params.appName,
      `Rappel envoyé automatiquement par ${params.appName} pour ${escapeHtml(params.cabinetName)}.`
    ),
  }
}



export function clientProfileUpdatedTemplate(params: {
  clientCompany: string
  cabinetName: string
  changes: Array<[string, string | null, string | null]>
  appUrl: string
  appName: string
}): { subject: string; html: string } {
  const subject = `Fiche client mise à jour — ${params.clientCompany}`
  const rows = params.changes
    .map(
      ([label, oldV, newV]) => `
        <tr>
          <td style="padding:6px 10px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0">${escapeHtml(label)}</td>
          <td style="padding:6px 10px;color:#94a3b8;font-size:13px;border-bottom:1px solid #e2e8f0;text-decoration:line-through">${escapeHtml(oldV || '—')}</td>
          <td style="padding:6px 10px;color:#0f172a;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0">${escapeHtml(newV || '—')}</td>
        </tr>`
    )
    .join('')
  const body = `
    <p>Bonjour,</p>
    <p>Le client <strong>${escapeHtml(params.clientCompany)}</strong> vient de mettre à jour sa fiche sur ${escapeHtml(params.appName)}.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:12px 0 20px">
      <thead>
        <tr>
          <th align="left" style="padding:6px 10px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Champ</th>
          <th align="left" style="padding:6px 10px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Avant</th>
          <th align="left" style="padding:6px 10px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Après</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="3" style="padding:10px;color:#64748b">Aucun changement détaillé.</td></tr>'}</tbody>
    </table>
    <p style="text-align:center;margin:20px 0">
      <a href="${params.appUrl}" style="display:inline-block;padding:12px 20px;background:#6c5ce7;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600">Ouvrir la fiche client</a>
    </p>
  `
  return {
    subject,
    html: baseLayout(
      body,
      params.appName,
      `Notification envoyée par ${params.appName} pour ${escapeHtml(params.cabinetName)}.`
    ),
  }
}

export function documentRejectedTemplate(params: {
  clientCompany: string
  cabinetName: string
  documentName: string
  reviewNote?: string | null
  appUrl: string
  appName: string
}): { subject: string; html: string } {
  const subject = `Document à corriger — ${params.documentName}`
  const noteBlock = params.reviewNote
    ? `<p style="color:#334155;background:#fef2f2;border-left:3px solid #dc2626;padding:10px 12px;border-radius:8px;margin:12px 0"><strong>Message de votre cabinet :</strong><br/>${escapeHtml(params.reviewNote)}</p>`
    : `<p style="color:#64748b;margin:12px 0">Votre cabinet n'a pas précisé la raison. Contactez-le pour plus de détails.</p>`
  const body = `
    <p>Bonjour,</p>
    <p>Votre cabinet <strong>${escapeHtml(params.cabinetName)}</strong> vous demande de corriger le document suivant pour <strong>${escapeHtml(params.clientCompany)}</strong>&nbsp;:</p>
    <p style="font-size:17px;font-weight:700;color:#0f172a;margin:14px 0">${escapeHtml(params.documentName)}</p>
    ${noteBlock}
    <p>Veuillez téléverser une version corrigée depuis votre espace&nbsp;:</p>
    <p style="text-align:center;margin:24px 0">
      <a href="${params.appUrl}" style="display:inline-block;padding:12px 20px;background:#6c5ce7;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600">Ouvrir mon espace ${escapeHtml(params.appName)}</a>
    </p>
  `
  return {
    subject,
    html: baseLayout(
      body,
      params.appName,
      `Notification envoyée par ${params.appName} pour ${escapeHtml(params.cabinetName)}.`
    ),
  }
}
