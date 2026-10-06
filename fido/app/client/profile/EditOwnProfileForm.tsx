'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { updateOwnClientProfile } from '@/app/actions/clients'

type ClientRow = {
  id: string
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  address: string | null
  website: string | null
  ice: string | null
  if_number: string | null
  rc_number: string | null
  cnss_number: string | null
}

type State = { error: string; success: boolean }
const initialState: State = { error: '', success: false }

export default function EditOwnProfileForm({ client }: { client: ClientRow }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    async (_prev: State, formData: FormData) => {
      const result = await updateOwnClientProfile(formData)
      if (result.success) {
        router.refresh()
        return { error: '', success: true }
      }
      return { error: result.error || 'Une erreur est survenue.', success: false }
    },
    initialState
  )

  return (
    <form action={action} className="client-form" data-testid="edit-own-form">
      <label className="upload-label" style={{ margin: 0 }}>
        <span className="muted">Nom de l’entreprise</span>
        <input
          className="search auth-input"
          name="company_name"
          defaultValue={client.company_name}
          required
          data-testid="own-company"
        />
      </label>

      <label className="upload-label" style={{ margin: 0 }}>
        <span className="muted">Nom du contact</span>
        <input
          className="search auth-input"
          name="contact_name"
          defaultValue={client.contact_name || ''}
          data-testid="own-contact"
        />
      </label>

      <div className="grid-2">
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">E-mail (lecture seule)</span>
          <input
            className="search auth-input"
            value={client.email || ''}
            disabled
            data-testid="own-email"
          />
        </label>
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">Téléphone</span>
          <input
            className="search auth-input"
            name="phone"
            defaultValue={client.phone || ''}
            placeholder="+212..."
            data-testid="own-phone"
          />
        </label>
      </div>

      <label className="upload-label" style={{ margin: 0 }}>
        <span className="muted">Adresse</span>
        <input
          className="search auth-input"
          name="address"
          defaultValue={client.address || ''}
          placeholder="Rue, ville, code postal"
          data-testid="own-address"
        />
      </label>

      <label className="upload-label" style={{ margin: 0 }}>
        <span className="muted">Site web</span>
        <input
          className="search auth-input"
          name="website"
          defaultValue={client.website || ''}
          placeholder="https://..."
          data-testid="own-website"
        />
      </label>

      <div
        className="card card-padded"
        style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 10 }}
      >
        <strong style={{ fontSize: 13 }}>Identifiants fiscaux</strong>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>
          Ces informations sont gérées par votre cabinet (ICE, IF, RC, CNSS). Pour toute
          correction, envoyez-leur un message depuis votre espace.
        </p>
        <div className="grid-2">
          <div>
            <div className="muted" style={{ fontSize: 11 }}>ICE</div>
            <div style={{ fontWeight: 600 }}>{client.ice || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>IF</div>
            <div style={{ fontWeight: 600 }}>{client.if_number || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>RC</div>
            <div style={{ fontWeight: 600 }}>{client.rc_number || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>CNSS</div>
            <div style={{ fontWeight: 600 }}>{client.cnss_number || '—'}</div>
          </div>
        </div>
      </div>

      {state.error && (
        <p className="auth-error" data-testid="own-error">{state.error}</p>
      )}
      {state.success && !state.error && (
        <p
          className="auth-notice"
          data-testid="own-success"
          style={{ color: 'var(--green-700, #15803d)' }}
        >
          ✅ Vos informations ont été mises à jour. Votre cabinet a été notifié.
        </p>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button
          className="primary auth-submit"
          disabled={pending}
          data-testid="own-submit"
          style={{ flex: 1 }}
        >
          {pending ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        <Link
          href="/client"
          className="btn-secondary"
          style={{ textAlign: 'center' }}
          data-testid="own-cancel"
        >
          Retour
        </Link>
      </div>
    </form>
  )
}
